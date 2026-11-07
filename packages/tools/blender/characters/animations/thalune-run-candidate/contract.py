"""Exact proposed Thalune run unit. Constructing a plan cannot start a job."""
from assertion_guard import require_assertions
require_assertions(__debug__)
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[5]
SCHEMA = 't02-lossless-rgb-primary/v1'
FRAMES = 189
VIDEO_BYTES = 8 * 1024**2 + 160 * 1024 * FRAMES
IMAGE_BYTES = 12 * 1024**2
OBSERVATION_BYTES = 256 * 1024
METADATA_BYTES = 386 * OBSERVATION_BYTES + 3 * 64 * 1024**2 + 2 * 16 * 1024**2 + 24 * 1024**2
FILE_COUNT = 512
RECORD_BYTES = 128 * 1024
CAPTURE_IDS = ['motion-thalune-run-lod0', 'motion-thalune-run-lod2', 'stills-thalune-run']
VALIDATOR_IDS = ['validate-thalune-run-lod0', 'validate-thalune-run-lod2']
VIDEOS = {f'captures/{name}/primary.mp4' for name in CAPTURE_IDS[:2]}
STILLS = {f'captures/{CAPTURE_IDS[2]}/images/{i:04}.png' for i in range(8)}

def stages():
    result = []
    for lod, name in zip([0, 2], CAPTURE_IDS):
        work = []
        for i in range(FRAMES):
            # 15 lead-in + three 48-frame loops + 30 final-pose frames.
            time = 0 if i < 15 else (i - 15) % 48 / 60 if i < 159 else .8
            work.append(dict(id=f'{name}/run_forward/{i:04}', people='thalune', clip='run_forward',
                             frame=i, sequenceTime=i/60, time=time, light='noon-lush', lod=lod,
                             wire=False, reel='run_forward', ordinal=i))
        result.append(dict(id=name, kind='motion', people='thalune', lod=lod, work=work))
    work = []
    for lod in [0, 2]:
        for light, wire in [('noon-lush', False), ('night-exotic', False), ('open-space', False), ('noon-lush', True)]:
            i = len(work)
            work.append(dict(id=f'{CAPTURE_IDS[2]}/{i:04}', people='thalune', clip='run_forward',
                             frame=i, sequenceTime=None, time=.4, light=light, lod=lod,
                             wire=wire, reel=None, ordinal=i))
    result.append(dict(id=CAPTURE_IDS[2], kind='stills', people='thalune', work=work))
    return result

def jobs():
    return [dict(id=s['id'], kind=s['kind'], capture=s['id']) for s in stages()] + [
        dict(id=name, kind='validator', capture=capture)
        for name, capture in zip(VALIDATOR_IDS, CAPTURE_IDS)]

def paths(packet, proof, job):
    return dict(capture=str(Path(packet)/'captures'/job['capture']),
                inspection=str(Path(packet)/'inspections'/job['id']),
                raw=str(Path(proof)/'jobs'/job['id']/'native'),
                receipt=str(Path(proof)/'jobs'/job['id']/'receipt.json'))

def verify_structure(ready):
    assert ready['purpose'] == 'THALUNE_RUN_2X189_8_STILLS_SOURCE_CANDIDATE'
    assert json.dumps(ready['stages'],sort_keys=True) == json.dumps(stages(),sort_keys=True) and ready['jobs'] == jobs(), 'Exact ordered work inventory refused'
    assert ready['primaryArtifactSchema'] == SCHEMA and ready['viewport'] == [1920, 1080]
    assert ready['captureSeconds'] == 600 and ready['cleanupSeconds'] == 60
    assert ready['limits'] == dict(maxImageBytes=IMAGE_BYTES, maxObservationBytes=OBSERVATION_BYTES,
                                  maxAncillaryStageBytes=64*1024**2, maxArchiveStageBytes=1024**3)
    assert ready['rgbPrimary']['maxFrames'] == FRAMES and ready['rgbPrimary']['maxVideoBytes'] == VIDEO_BYTES
    assert ready['packetBudget'] == dict(metadataBytes=METADATA_BYTES, fileCount=FILE_COUNT,
                                        perReelBytes=VIDEO_BYTES, stillBytes=IMAGE_BYTES,
                                        reservedFailureBytes=RECORD_BYTES, reservedTerminalBytes=RECORD_BYTES,
                                        atomicTemporaryBytesCounted=True)
    assert ready['clipDurations'] == {'run_forward': .8}
    return [w for stage in ready['stages'] for w in stage['work']]
