"""Task-local lossless helper snapshots, bounded separately from receipt graphs."""
import hashlib
import json
import os
import stat
from pathlib import Path
import zlib

from boundary import MIB, canonical, deadline, exclusive_bytes, require, snapshot

SCHEMA = 'viewmodel-helper-snapshots/1'
BLOCK = MIB
EVENT_CAP = 2 * MIB
EXPANDED_CAP = 1024 * MIB
DISK_CAP = 8 * MIB
CAPTURE_DISK_CAP = 6 * MIB
INDEX_CAP = 256 * 1024
PART_CAP = BLOCK + 4096
DICTIONARY_BYTES = 16 * MIB
DICTIONARY_ENTRIES = 16384
MAX_PARTS = EXPANDED_CAP // BLOCK + 1


class Journal:
    """Each event is an immutable snapshot with its own raw graph identities.

    Segments are transport fragments, not independently complete events. Sequence,
    exact expanded byte counts and hashes bind their concatenation. No snapshots
    are dropped, sampled or reconstructed. Failed prefixes are never complete.
    """
    def __init__(self, directory, evidence):
        self.directory = canonical(directory, absent=True)
        self.evidence = evidence
        self.manifest = {'schema': SCHEMA, 'complete': False, 'events': 0, 'expandedBytes': 0,
                         'attemptedBytes': 0, 'logicalBytes': 0, 'parts': [], 'failures': []}
        evidence['helperJournal'] = self.manifest
        evidence['journalAllocation'] = {'path': str(directory), 'state': 'attempting'}
        self.directory.mkdir(mode=0o700)
        info = self.directory.stat()
        evidence['journalAllocation'].update(state='allocated', device=info.st_dev, inode=info.st_ino)
        self.stamp = [info.st_dev, info.st_ino]
        self.manifest['directoryIdentity'] = {'stamp': self.stamp, 'uid': info.st_uid}
        self.dictionary = {}; self.dictionary_bytes = 0
        self.buffer = bytearray()
        self.closed = False
        self.broken = False

    def append(self, event):
        require(not self.closed, 'Observation journal already closed')
        # These fields already contain raw() snapshots. Never graph-encode those
        # encodings again or combine their nodes into an unbounded global graph.
        data = json.dumps(event, allow_nan=False, separators=(',', ':')).encode()
        require(len(data) <= EVENT_CAP, 'Helper snapshot event ceiling')
        require(self.manifest['logicalBytes'] + len(data) <= EXPANDED_CAP, 'Helper snapshot logical ceiling')
        if self.broken:
            self.evidence.setdefault('unwrittenHelperEvents', []).append(event)
            return len(data)
        logical_size = len(data)
        order = b''
        if 'callSequence' in event:
            sequence = event['callSequence']
            require(type(sequence) is int and 0 <= sequence <= EXPANDED_CAP, 'Helper call order')
            order = b',"order":' + (b'true' if sequence == self.manifest['events'] else str(sequence).encode())
            data = json.dumps({k:v for k,v in event.items() if k != 'callSequence'}, allow_nan=False, separators=(',', ':')).encode()
        digest = hashlib.sha256(data).hexdigest()
        prefix = b''
        if digest not in self.dictionary:
            if len(self.dictionary) >= DICTIONARY_ENTRIES or self.dictionary_bytes + len(data) > DICTIONARY_BYTES:
                prefix = b'{"reset":true}\n'; self.dictionary = {}; self.dictionary_bytes = 0
            number = len(self.dictionary); self.dictionary[digest] = number
            self.dictionary_bytes += len(data)
            line = b'{"define":' + str(number).encode() + b',"event":' + data + order + b'}\n'
        else:
            line = b'{"use":' + str(self.dictionary[digest]).encode() + order + b'}\n'
        payload = prefix + line
        require(self.manifest['expandedBytes'] + len(payload) <= EXPANDED_CAP, 'Helper snapshot expansion ceiling')
        self.manifest['events'] += 1
        self.manifest['logicalBytes'] += logical_size
        self.manifest['expandedBytes'] += len(payload)
        self.buffer.extend(payload)
        while len(self.buffer) >= BLOCK:
            self.flush(BLOCK)
        return logical_size

    def fail(self, event, error):
        self.broken = True
        self.manifest['complete'] = False
        self.evidence.setdefault('unwrittenHelperEvents', []).append(event)
        self.evidence.setdefault('journalFailure', error)
        self.evidence.setdefault('unwrittenHelperBytes', bytes(self.buffer))

    def flush(self, amount=None):
        if not self.buffer or self.broken:
            return
        amount = len(self.buffer) if amount is None else amount
        plain = bytes(self.buffer[:amount])
        compressed = zlib.compress(plain, level=6)
        number = len(self.manifest['parts'])
        require(number < MAX_PARTS, 'Helper snapshot segment ceiling')
        name = f'{number:04d}.zlib'
        row = {'name': name, 'bytes': len(compressed), 'sha256': hashlib.sha256(compressed).hexdigest(),
               'expandedBytes': len(plain), 'expandedSha256': hashlib.sha256(plain).hexdigest(), 'written': False, 'dispatched': False}
        self.manifest['parts'].append(row)
        limit = DISK_CAP - INDEX_CAP if self.evidence.get('phase') == 'cleanup' else CAPTURE_DISK_CAP
        self.manifest['attemptedBytes'] += len(compressed)
        try:
            require(self.manifest['attemptedBytes'] <= limit, 'Helper snapshot disk admission ceiling')
            info = self.directory.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and [info.st_dev, info.st_ino] == self.stamp, 'Helper journal root changed')
            row['dispatched'] = True
            exclusive_bytes(self.directory / name, compressed, PART_CAP)
            row['written'] = True
            del self.buffer[:amount]
        except BaseException as error:
            self.broken = True
            self.manifest['failures'].append({'part': name, 'type': type(error).__name__, 'message': str(error)})
            # Original pending bytes, unknown fields and the error remain owned
            # in memory even if every durable sink is unavailable.
            self.evidence['unwrittenHelperBytes'] = bytes(self.buffer)
            self.evidence['journalFailure'] = error
            raise

    def finish(self):
        if self.closed:
            return
        try:
            self.flush()
            self.manifest['complete'] = not self.broken and not self.evidence.get('unwrittenHelperEvents')
            data = (json.dumps(self.manifest, allow_nan=False, separators=(',', ':')) + '\n').encode()
            require(len(data) <= INDEX_CAP, 'Helper snapshot index ceiling')
            attempted = self.manifest['attemptedBytes'] + len(data)
            self.evidence['journalIndexAttempt'] = {'bytes': len(data), 'totalAttemptedBytes': attempted, 'dispatched': False}
            require(attempted <= DISK_CAP, 'Helper snapshot final disk ceiling')
            self.evidence['journalIndexAttempt']['dispatched'] = True
            exclusive_bytes(self.directory / 'index.json', data, INDEX_CAP)
            self.evidence['journalIndex'] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
                                           'totalAttemptedBytes': attempted}
        except BaseException:
            self.manifest['complete'] = False
            raise
        finally:
            self.closed = True


def validate(directory, manifest, *, consume=None):
    """Authenticate, bounded-decompress and parse the same bytes, after release.

    consume receives one raw event snapshot at a time; it does not reinterpret
    unknown fields or flatten per-event alias/cycle namespaces.
    """
    directory = canonical(directory)
    require(type(manifest) is dict and manifest.get('schema') == SCHEMA and manifest.get('complete') is True,
            'Incomplete helper snapshot journal')
    for key, cap in (('events', EXPANDED_CAP), ('logicalBytes', EXPANDED_CAP), ('expandedBytes', EXPANDED_CAP), ('attemptedBytes', DISK_CAP)):
        require(type(manifest.get(key)) is int and 0 <= manifest[key] <= cap, 'Helper snapshot counter')
    require(manifest.get('failures') == [], 'Helper snapshot failures')
    info = directory.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and manifest.get('directoryIdentity') == {'stamp': [info.st_dev, info.st_ino], 'uid': info.st_uid}, 'Helper journal directory identity changed')
    parts = manifest.get('parts')
    require(type(parts) is list and len(parts) <= MAX_PARTS, 'Helper snapshot parts')
    expected = {f'{i:04d}.zlib' for i in range(len(parts))} | {'index.json'}
    require(directory.is_dir() and {p.name for p in directory.iterdir()} == expected, 'Helper snapshot inventory differs')
    index, _ = snapshot(directory / 'index.json', INDEX_CAP)
    require(index == (json.dumps(manifest, allow_nan=False, separators=(',', ':')) + '\n').encode(), 'Helper snapshot index differs')
    pending = bytearray(); total = 0; stored = len(index); events = 0; logical = 0
    dictionary = []; dictionary_bytes = 0
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate helper snapshot key')
            result[key] = value
        return result
    def invalid(_):
        raise ValueError('Nonfinite helper snapshot JSON')
    with deadline(45):
        for i, row in enumerate(parts):
            require(type(row) is dict and row.get('name') == f'{i:04d}.zlib' and row.get('written') is True, 'Helper snapshot part identity')
            size = row.get('expandedBytes')
            require(type(size) is int and 0 < size <= BLOCK, 'Helper snapshot expanded bound')
            require(type(row.get('bytes')) is int and 0 < row['bytes'] <= PART_CAP, 'Helper snapshot stored bound')
            data, _ = snapshot(directory / row['name'], row['bytes'], row['sha256'])
            require(len(data) == row['bytes'], 'Helper snapshot stored length')
            stored += len(data); require(stored <= DISK_CAP, 'Helper snapshot total stored ceiling')
            decoder = zlib.decompressobj()
            plain = decoder.decompress(data, size + 1)
            require(len(plain) == size and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,
                    'Incomplete or overlong helper snapshot stream')
            require(hashlib.sha256(plain).hexdigest() == row['expandedSha256'], 'Helper snapshot expanded hash')
            total += len(plain); require(total <= EXPANDED_CAP, 'Helper snapshot total expansion ceiling')
            pending.extend(plain)
            while (end := pending.find(b'\n')) >= 0:
                require(end + 1 <= EVENT_CAP + 64, 'Helper snapshot record ceiling')
                line = bytes(pending[:end]); del pending[:end + 1]
                value = json.loads(line, object_pairs_hook=pairs, parse_constant=invalid)
                require(type(value) is dict, 'Helper snapshot record')
                has_order = 'order' in value
                order = value.pop('order', None)
                if has_order:
                    require(order is True or type(order) is int and 0 <= order <= EXPANDED_CAP, 'Helper call order')
                    order = events if order is True else order
                if set(value) == {'reset'} and value['reset'] is True:
                    require(not has_order, 'Reset cannot carry call order')
                    dictionary = []; dictionary_bytes = 0; continue
                if set(value) == {'define', 'event'}:
                    require(type(value['define']) is int and value['define'] == len(dictionary) and type(value['event']) is dict, 'Helper snapshot definition')
                    event_bytes = json.dumps(value['event'], allow_nan=False, separators=(',', ':')).encode()
                    require(len(event_bytes) <= EVENT_CAP, 'Helper snapshot event ceiling')
                    dictionary_bytes += len(event_bytes)
                    require(len(dictionary) < DICTIONARY_ENTRIES and dictionary_bytes <= DICTIONARY_BYTES, 'Helper snapshot dictionary ceiling')
                    dictionary.append(event_bytes)
                else:
                    require(set(value) == {'use'} and type(value['use']) is int and 0 <= value['use'] < len(dictionary), 'Helper snapshot reference')
                    event_bytes = dictionary[value['use']]
                if has_order:
                    event_value = json.loads(event_bytes)
                    require('callSequence' not in event_value, 'Duplicate helper call order')
                    event_value['callSequence'] = order
                    event_bytes = json.dumps(event_value, allow_nan=False, separators=(',', ':')).encode()
                logical += len(event_bytes); require(logical <= EXPANDED_CAP, 'Helper snapshot logical ceiling')
                if consume is not None: consume(json.loads(event_bytes))
                events += 1
            require(len(pending) <= EVENT_CAP + 64, 'Helper snapshot pending ceiling')
    require(not pending and total == manifest['expandedBytes'] and events == manifest['events'] and logical == manifest['logicalBytes'], 'Helper snapshot totals differ')
    after = directory.lstat()
    require((after.st_dev, after.st_ino, after.st_uid) == (info.st_dev, info.st_ino, info.st_uid), 'Helper journal root replaced during read')
    require(stored - len(index) == manifest['attemptedBytes'], 'Helper snapshot attempted bytes differ')
    return {'valid': True, 'events': events, 'expandedBytes': total, 'logicalBytes': logical, 'storedBytes': stored}
