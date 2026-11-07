"""Task-local receipts: failed writes stay charged, and disk never says accepted."""
import base64
import json
from pathlib import Path
import subprocess
from contract import METADATA_PER_PROCESS, MIB, require


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
        require(len(data) <= MIB and self.charged + len(data) <= METADATA_PER_PROCESS, 'Controlled metadata cap')
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
        sink.write(evidence / 'result.json', result)
    except BaseException as error:
        result['errors'].append({'phase': 'final-result-write', **failure(error)})
        result['checksPassed'] = False
        result['publication'] = 'FAILED'
        try:
            sink.write(output / 'failed-result.json', result)
            result['failurePacketWritten'] = True
        except BaseException as secondary:
            result['errors'].append({'phase': 'packet-fallback-write', **failure(secondary)})
            try:
                # Bounded stderr belongs to the caller's separately reserved metadata allowance.
                data = (json.dumps(raw(result), sort_keys=True, allow_nan=False) + '\n').encode()
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
