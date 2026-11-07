"""Task-local receipts: failed writes stay charged, and disk never says accepted."""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
from contract import METADATA_PER_PROCESS, MIB, require, snapshot

FAILURE_SUMMARY_RESERVE = 64 * 1024
PART_BYTES = 512 * 1024


def write_capture_record(sink, path, value):
    """Keep complete large terminal records in finite, exclusively created JSON parts."""
    data = (json.dumps(raw(value), sort_keys=True, indent=2, allow_nan=False) + '\n').encode()
    if len(data) <= MIB:
        return sink.write(path, value)
    data = json.dumps(raw(value), sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    require(len(data) <= METADATA_PER_PROCESS, 'Capture record exceeds total metadata allowance')
    parts = []
    path = Path(path)
    for index, offset in enumerate(range(0, len(data), PART_BYTES)):
        part = data[offset:offset + PART_BYTES]
        name = path.name + f'.part{index:04d}.json'
        payload = {'index': index, 'base64': base64.b64encode(part).decode('ascii')}
        sink.write(path.with_name(name), payload)
        encoded = (json.dumps(raw(payload), sort_keys=True, indent=2, allow_nan=False) + '\n').encode()
        parts.append({'name': name, 'bytes': len(encoded), 'sha256': hashlib.sha256(encoded).hexdigest()})
    sink.write(path, {'recordFormat': 'EFFECTS_CAPTURE_PARTS_V1', 'bytes': len(data),
                      'sha256': hashlib.sha256(data).hexdigest(), 'parts': parts})


def capture_snapshot(path):
    """Every part's hash, parse and index use one capped no-follow metadata snapshot."""
    outer = snapshot(path)
    value = outer['value']
    if value.get('recordFormat') != 'EFFECTS_CAPTURE_PARTS_V1':
        return outer
    require(type(value.get('bytes')) is int and 0 < value['bytes'] <= METADATA_PER_PROCESS, 'Capture record size')
    parts = value.get('parts')
    require(isinstance(parts, list) and 0 < len(parts) <= METADATA_PER_PROCESS // PART_BYTES, 'Capture part count')
    data, charged, observations = bytearray(), outer['bytes'], []
    for index, row in enumerate(parts):
        require(row['name'] == Path(path).name + f'.part{index:04d}.json', 'Capture part route')
        part = snapshot(Path(path).with_name(row['name']), MIB)
        observations.append(part)
        charged += part['bytes']
        require(charged <= METADATA_PER_PROCESS and part['sha256'] == row['sha256'] and part['bytes'] == row['bytes'], 'Capture part binding/cap')
        require(type(part['value']['index']) is int and part['value']['index'] == index, 'Capture part order')
        block = base64.b64decode(part['value']['base64'], validate=True)
        require(0 < len(block) <= PART_BYTES and (index == len(parts) - 1 or len(block) == PART_BYTES), 'Capture part payload size')
        data.extend(block)
        require(len(data) <= value['bytes'], 'Capture record grew')
    require(len(data) == value['bytes'] and hashlib.sha256(data).hexdigest() == value['sha256'], 'Capture record binding')
    def unique(pairs):
        result = {}
        for key, val in pairs:
            require(key not in result, 'Duplicate capture record key')
            result[key] = val
        return result
    decoded = json.loads(data, object_pairs_hook=unique, parse_constant=lambda _: require(False, 'Nonfinite capture record'))
    require(isinstance(decoded, dict), 'Capture record object required')
    return {**outer, 'value': decoded, 'parts': observations, 'envelope': value}


def raw(value):
    if isinstance(value, dict):
        return {str(k): raw(v) for k, v in value.items()}
    if isinstance(value, (tuple, list, set)):
        return [raw(v) for v in value]
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {'type': type(value).__name__, 'base64': base64.b64encode(value).decode('ascii')}
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, '__dict__'):
        return raw(vars(value))
    return value


def failure(error):
    fields = dict(vars(error))
    for name in ('errno', 'strerror', 'filename', 'filename2', 'characters_written', 'returncode', 'cmd', 'stdout', 'stderr', 'output'):
        if hasattr(error, name):
            fields[name] = getattr(error, name)
    if isinstance(error, subprocess.TimeoutExpired):
        fields.update(stdout=error.stdout, stderr=error.stderr)
    return {'type': type(error).__name__, 'message': str(error), 'args': raw(error.args), 'attributes': raw(fields)}


def ownership(job):
    """Available in-memory ownership, including future fields; no filesystem probes or release inference."""
    attributes = vars(job)
    required = ('out', 'scratch', 'target', 'root', 'coalition_id', 'known', 'registered', 'state')
    return {'attributes': raw(attributes), 'missing': [key for key in required if key not in attributes],
            'registrationAndRelease': 'UNPROVED_BY_THIS_ATTRIBUTE_SNAPSHOT'}


def reject_unconsumed(result, sink, stderr):
    """Admission refusal allocates no evidence/output/consumption; all failed sink facts stay in memory."""
    result.update(accepted=False, checksPassed=False, durable=False, publication='REFUSED_BEFORE_CONSUMPTION')
    try:
        data = (json.dumps(raw(result), sort_keys=True, allow_nan=False) + '\n').encode()
        require(len(data) <= MIB and sink.charged + len(data) <= METADATA_PER_PROCESS, 'Admission stderr metadata cap')
        sink.charged += len(data)
        stderr(data)
    except BaseException as error:
        result['errors'].append({'phase': 'admission-stderr-write', **failure(error)})
    return result


class Receipts:
    def __init__(self, writer=None):
        self.charged = 0
        self.attempts = []
        self.writer = writer or self.exclusive

    @staticmethod
    def exclusive(path, data):
        with Path(path).open('xb') as stream:
            stream.write(data)

    def write(self, path, value):
        data = (json.dumps(raw(value), sort_keys=True, indent=2, allow_nan=False) + '\n').encode()
        require(len(data) <= MIB and self.charged + len(data) <= METADATA_PER_PROCESS - FAILURE_SUMMARY_RESERVE, 'Controlled metadata cap')
        self.charged += len(data)
        attempt = {'path': str(path), 'bytes': len(data), 'completed': False}
        self.attempts.append(attempt)
        try:
            self.writer(path, data)
            attempt['completed'] = True
        except BaseException as error:
            attempt['failure'] = failure(error)
            raise


def publish(result, evidence, output, sink, stderr):
    """A completed final write precedes success; late close failures cannot leave success claims."""
    result.update(accepted=False, publication='AWAITING_PARENT_OS_EXIT_AND_HASHES', durable=False)
    result['metadataAttempts'] = sink.attempts.copy()
    try:
        write_capture_record(sink, evidence / 'result.json', result)
    except BaseException as error:
        result['errors'].append({'phase': 'final-result-write', **failure(error)})
        result['checksPassed'] = False
        result['publication'] = 'FAILED'
        try:
            write_capture_record(sink, output / 'failed-result.json', result)
            result['failurePacketWritten'] = True
        except BaseException as secondary:
            result['errors'].append({'phase': 'packet-fallback-write', **failure(secondary)})
            try:
                # Bounded stderr belongs to the caller's separately reserved metadata allowance.
                data = (json.dumps(raw(result), sort_keys=True, allow_nan=False) + '\n').encode()
                if len(data) > MIB or sink.charged + len(data) > METADATA_PER_PROCESS:
                    first = result['errors'][0] if result['errors'] else {}
                    # Complete observations remain in result and any completed exclusive parts.
                    # This is only a failure notification, never a substitute success receipt.
                    data = (json.dumps({'accepted': False, 'durable': False, 'publication': 'FAILED',
                            'primaryType': str(first.get('type', 'UNKNOWN'))[:256],
                            'primaryMessagePrefix': str(first.get('message', 'UNKNOWN'))[:2048],
                            'summaryOnly': True, 'completeFactsRetainedInMemory': True,
                            'errors': len(result['errors']), 'metadataChargedBytes': sink.charged,
                            'attemptedWrites': len(sink.attempts), 'resultPath': str(evidence / 'result.json')}) + '\n').encode()
                    require(len(data) <= FAILURE_SUMMARY_RESERVE, 'Failure summary reserve')
                require(len(data) <= MIB and sink.charged + len(data) <= METADATA_PER_PROCESS, 'stderr metadata cap')
                sink.charged += len(data)
                stderr(data)
            except BaseException as last:
                result['errors'].append({'phase': 'stderr-fallback-write', **failure(last)})
        result['metadataAttempts'] = sink.attempts.copy()
        return result
    result['durable'] = True  # Only this in-memory return knows close succeeded.
    result['accepted'] = result['checksPassed'] and not result['errors']
    return result
