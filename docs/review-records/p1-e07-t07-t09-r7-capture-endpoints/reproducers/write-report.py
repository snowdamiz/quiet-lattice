from pathlib import Path
import json,hashlib,subprocess,re,shutil,datetime
s=Path(__file__).parent;r=Path('/Users/andreyyurlov/.t3/worktrees/space/t3-2a0b7521');report=r/'docs/review-records/p1-e07-t07-t09-r7-capture-endpoints'
def git(*a,inp=None):return subprocess.check_output(['git','--no-optional-locks',*a],cwd=r,input=inp).decode().strip()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert not report.exists();assert git('status','--porcelain')==''
source=git('rev-parse','HEAD');tree=git('rev-parse','HEAD^{tree}');base='c57896661481836571a80e50ab6bbd657dbffe43'
audit=json.loads((s/'protected-after.json').read_text());prior=r/'docs/review-records/p1-e07-t07-t09-visibility-fix'
report.mkdir();(report/'commands').mkdir();(report/'reproducers').mkdir()
for p in (s/'logs').iterdir():shutil.copyfile(p,report/'commands'/p.name)
for name in ['review-red.json','review-green.json','review-final.json','focused-first.json','timing-measure.json','focused-final.json','commands.jsonl','assertion-preservation.json','r7-assertion-preservation.json','qualified-observations.json','test-accounting.json','protected-before.json','protected-after.json']:
 shutil.copyfile(s/name,report/name)
for name in ['run.py','boundary.mjs','review.test.ts','review.config.mjs','cpu.config.mjs','types.mjs','lint.mjs','format.mjs','assertions.mjs','audit.py','audit-final.py','base-spec.ts.txt','new-tests.ts','write-report.py']:
 shutil.copyfile(s/name,report/'reproducers'/name)
(report/'source.patch').write_text(git('diff',base,source)+'\n')
commands=[json.loads(line) for line in (s/'commands.jsonl').read_text().splitlines()]
lines=[]
for x in commands:
 lines += [x['name'],json.dumps(x), 'LAST OUTPUT LINES:', '\n'.join((s/'logs'/(x['name']+'.log')).read_text().splitlines()[-20:])]
 result=s/(x['name']+'.json')
 if x['exit'] and result.exists():
  j=json.loads(result.read_text())
  for f in j.get('testResults',[]):
   for t in f['assertionResults']:
    if t['status']=='failed':lines += [t['fullName'], '\n'.join('\n'.join(t['failureMessages']).splitlines()[-20:])]
 lines.append('')
(report/'commands.txt').write_text('\n'.join(lines)+'\n')
manifest={'baseHead':base,'baseTree':audit['baseTree'],'sourceHead':source,'sourceTree':tree,'sourcePatchId':git('patch-id','--stable',inp=git('show','--pretty=format:',source).encode()).split()[0],
 'worktree':str(r),'branch':git('branch','--show-current'),'sourceFiles':audit['sourceFiles'],'changedSourceFiles':list(audit['sourceFiles']),
 'priorManifest':{'path':str(prior/'manifest.json'),'sha256':sha(prior/'manifest.json')},'r7Review':{'path':'/private/tmp/symbiotic-source-review-c5789666-gseoebo8','seal':audit['reviewSeal']},
 'protectedReceipt':'protected-after.json','protectedFilesUnchanged':audit['protectedFileCount'],'r7SealedFilesVerified':len(audit['r7ReviewSha256']),
 'integrationPatches':audit['patchPairs'],'protectedObjects':audit['objects'],'assertionReceipt':'r7-assertion-preservation.json','priorOriginalAssertions':122,'priorR7Assertions':174,'currentAssertions':194,
 'freshFocusedTests':130,'freshRetainedReviewControls':10,'reviewRed':{'pass':8,'fail':2},'newPermanentTests':12,'history':{'reusedUnchangedTestIdentities':345,'catalogTotal':475},
 'imageCap':8,'newRuntime':False,'newImages':0,'newClaimOrGrant':False,'conflictResolutions':[],
 'scope':'fixture + focused CPU tests + exclusive evidence only; no product/assets/harness changes',
 'pending':['independent R8 source review','parent fresh one-shot admission and native visible capture','independent pixels/art acceptance'],
 'finalDeliveryPinReceipt':str(s/'final-receipt.json')}
(report/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
future=(prior/'future-qa.txt').read_text().replace('VISIBILITY SOURCE CORRECTION','R7 CAPTURE ENDPOINT CORRECTION').replace('0d9ad38e5059014e9e71fa27874dae27358e504c',source).replace('c3833e73427174e8f9cf41ad3dad134c7cdcd669',tree).replace('/private/tmp/symbiotic-visibility-apply-8o_t2b8f/final-receipt.json',str(s/'final-receipt.json'))
future+='\nR7: both post-retirement endpoints must retain the exact living observer/selected enemy, shown/drawn target and complete owner/companion removal. No replacement, healing, hidden actors or screenshot retries. CPU characterization shows immediate effective freeze can frame both views, while added latency can reject. No timing threshold was relaxed; a future rejection is retained. The pending old-pin external harness package was not edited; its operator must rebind only after independent R8 PASS.\n'
(report/'future-qa.txt').write_text(future)
text=f'''TASK: P1.E07.T07 + P1.E08.T09 companion visibility R7 correction
STATUS: DONE — SOURCE/CPU correction committed; independent R8/native visible acceptance PENDING.
SUMMARY: F1's image interval now rejects a dead/missing/wrong living witness or selected enemy and any missing drawn target or surviving owner/companion representation at either endpoint. The original retirement proof still runs unchanged. Endpoint samples occur after overlay readiness; exact image and binding attachments are retained before assertions reject the interval. No screenshot retry, actor manipulation, new freeze or gameplay change. A1 is characterized with the exact live combat caller, simultaneous actual Player walk and real hostile simulation, binary snapshot decoding and encoded combat events; existing geometry guards continue to reject delayed views.

EXACT PINS:
Base HEAD {base}
Base tree {audit['baseTree']}
Source HEAD {source}
Source tree {tree}
Source patch-id {manifest['sourcePatchId']}
Worktree {r}
Branch {manifest['branch']}
Delivery HEAD/tree are in {s}/final-receipt.json, generated after the report-only commit. This avoids an impossible self-referential committed SHA. Source hashes and objects are in manifest.json; finalizer verifies the descendant changes only this exclusive report directory.

FILES CHANGED:
packages/tools/src/smoke/symbiotic-online.spec.ts — capture endpoints additionally bind joined state, actual remote existence, Fauna shown membership, target membership and real picker result; after attachment, assert exact live observer and selected enemy wire identity/kind/species/frame/mode/HP, newer tick, target shown/drawn, and owner/companion absence from every recorded representation at both endpoints.
packages/tools/src/smoke/symbiotic-visibility.test.ts — 8 permanent real producer/caller interval controls and 4 exact concurrent combat caller timing cases. Reuses the existing scene/input/render-math ports. No browser or rasterizer runs.
docs/review-records/p1-e07-t07-t09-r7-capture-endpoints/* — exclusive report/evidence. No orchestration docs, existing report, asset, capture framework or external pending harness package changed. No conflicts.

F1 REAL RED/GREEN:
The final R7 review.test.ts was copied byte-for-byte into exclusive scratch and executed against the clean base before edits. Real Zone/FaunaSim spawned and bonded the original actors; natural companion combat produced positive attributed events and reduced living enemy HP. Zone.leave removed the owner/companion; actual SnapshotClient decoding and RemoteEntities/Fauna playback consumed removal after the normal delay. The exact trailing caller from `const retired =` through errors validation then captured inert labelled bytes.
RED: 8 PASS / 2 FAIL, exit1. Controlled real ZoneCombat damage during overlay readiness or inside screenshot made the selected enemy dead. The old caller accepted both; required-rejection tests failed `expected undefined to be defined`. Living and camera-change controls behaved as expected. This is not a claim that the lethal event occurred in a native run.
GREEN: unchanged reviewer file 10/10 PASS, exit0, both immediately after the fix and on final source. Both death schedules now reject positive-HP assertions; unchanged living case succeeds and actual mouse/camera drift is refused. Exact byte/binding attachments remain present.
Permanent controls add living observer death and actual Fauna draw-list retirement before/during capture. All8 pass, checking the actual assertion cause (HP=0, drawn=false, or camera=false), both attachments and recorded original retirement/capture evidence. Screenshot bytes are explicitly inert CPU bytes, NOT PNG/pixel evidence despite exercising the live attachment MIME port.

A1 ACTUAL CALLER TIMING CHARACTERIZATION:
Uses the exact source block from combat thaw through effective freeze, the actual walkTo/Player/Input, real Zone.step/FaunaSim/ZoneCombat, real binary SnapshotClient and parsed encoded server events on both local transports. The owner takes11 movement ticks while the full zone runs. Both clients' event+living damaged HP predicates must pass before freeze request; snapshot delivery precedes combat event delivery. No stationary hostile or manually seeded HP/event substitutes this characterization. Actor placement is the bounded late-follow CPU starting arrangement; it is not the entire preceding native journey.
50ms deterministic CPU polling; artificial freeze-response latencies0/0.2/0.5/1s. First real companion damage at simulated1001.90; owner predicate qualifies then observer at1001.95. Effective event-to-freeze delays are0.05/0.25/0.55/1.05s. Owner/observer framing results respectively PASS/PASS, PASS/REJECT, REJECT/REJECT, REJECT/REJECT. At0.25s observer projected full-body gap4.4049px fails the unchanged >8px guard; at0.55s gaps -1.2575/-20.3832px and at1.05s -4.2350/-22.7792px also reject. Enemy travel by freeze is0.0640/0.7865/1.2324/1.2758m. This is a nonblocking timing advisory with correctly failing-closed guards, NOT a new product finding or native latency budget. Preserve failure if native timing misses its window.
Limits: local transports/scheduler and procedural CPU geometry; player's actual physics pose enters the test Zone through its raw patch port, not a socket/admission claim. Existing movement-authority regression tests remain present. Native browser scheduling, UI acceptance, native loaded models/deformation, occluders and actual pixels remain unproved. No framing threshold, camera tolerance, actor position or health was modified in the live fixture by this correction.

VERIFY (exact argv/cwd/env, exits, durations, failure last20 in commands.jsonl/txt and commands/):
Direct Node22.23.3; max2 Vitest threads, serial files; no install. Pre-import boundary denies child spawning and TCP/TLS/listen/UDP/fetch, confines writes to {s}. Every supervisor has120s outer bound +5s TERM +5s KILL drain. No timeout occurred.
- review-red:10 total,8PASS/2expectedFAIL, exit1 before edit.
- review-green and review-final:10/10PASS, exit0 each; reviewer file unchanged.
- focused-final:130/130PASS,4files,0skips/retries, exit0 (55private +39visibility +7lifetime +29Net). All118 prior fresh identities preserved,12 new. Further345 historical test identities' source hashes verified unchanged, NOT rerun; catalog475, not475 fresh. No full-suite repetition.
- tools TypeScript noEmit:0diagnostics, exit0. Scoped ESLint0errors/0warnings, exit0. Prettier check exit0. git diff --check exit0.
- static Playwright --list only:1 required test/1file, exit0; no hooks/browser/service executed. Existing full-smoke exclusion unchanged. Eight-image cap unchanged: Bond owner/observer2; active-follow owner/observer2; combat owner/observer2; matched observer pre/postdisconnect2. Bindings8, bounded follow samples3. Zero fresh PNGs.
- Assertion scanner:122/122 original and174/174 R7-base expect calls preserved;194 current. Four original critical blocks token-identical. All19 helper functions other than captureView token-identical, including sameCaptureView, framing, capture, input, walks and active-follow. Original retirement wait/read/HP/identity/target/pick and terminal close remain intact; matched camera/projection equalities unchanged.
- Preservation audit:21,680 protected nonedited files unchanged vs initial inventory;5 reviewed/integrated stable patch-ID pairs equal;55 reviewed product paths and20 protected Git objects unchanged. Byte/LFS-pointer payload proofs inherited through unchanged initial audit, then actual bytes rehashed without filters/hydration. Includes272 older report files plus52 previous visibility-report files,5,643 original packet files,31 frozen scratch files and12,422 dependency files, plus protected source/assets. R7's644 sealed members plus SHA256SUMS/SEAL.json (646 files) freshly verified against original seal. Original report SHA691e4b43d9a6dfe3a6bf4efec811a69f1a54a418556cbaa2815d0be7491db92b unchanged. Both scratch and old evidence retained.
- Source commit is clean and only2files. Commits use per-command core.hooksPath=/dev/null to avoid Git-LFS hooks under no-hydration constraints; no hooks/config/install changed. All required CPU/static checks ran explicitly.

RETAINED INTERMEDIATE FAILURES:
focused-first had128PASS/2FAIL: the newly authored timing control assumed hostile travel >0.1m at immediate freeze (actual0.064m) and copied the reviewer's simplified0.2s expected PASS/PASS. timing-measure had3PASS/1FAIL with126 intentionally filtered tests (not required runtime skips). The exact caller adds an observer polling step and records0.25s event-to-freeze, correctly rejecting observer framing. Final characterization asserts the observed fail-closed outcomes, and checks nonzero actual hostile movement rather than inventing an arbitrary minimum. These were CPU expectation corrections, not production geometry-threshold changes. All initial results/logs and initial appended test source remain retained. No failure hidden or retry of native execution performed.

DECISIONS:
Add sampled-state assertions after attachments, leaving the older successful retirement proof and matching camera controls unchanged. Do not freeze/heal/replace actors to mask endpoint death. Keep both endpoint failures explicit. Preserve original source and native evidence; CPU attachment bytes are never claimed as visible acceptance.

OUT OF SCOPE FOUND:
No product/asset defect established. Fresh independent R8 review and actual native visible capture remain parent-owned. da532383 functional PASS and standard39PASS/3skip/42test native QA are historical preserved evidence, not rerun or visibility acceptance for this source. FullT09 art grade remains separate. No GPU/browser/native/server process/DB/service/network/install/claim/grant, cleanup, screenshot deletion, push/PR/main/merge occurred. Pending old-pin external harness was not edited.

ARTIFACTS / FUTURE:
manifest.json, protected-before/after.json, source.patch, test-accounting.json, assertion receipts, qualified-observations.json, exact reviewer reproducer/config and CPU ports, raw outputs and commands/exits; SHA256SUMS seals report members. Scratch remains under256MiB, no files deleted; final receipt records exact measured size and completed process receipts. future-qa.txt is an updated bounded recipe ONLY: privatePG53055 fresh astra_symbiotic_smoke namespace, freshly atomically claimed Redis8 on53058, new canonical/private/tmp output/profile, qualified parent guard,1worker/0retries,420s global/450s supervisor+20s termination, verified owned cleanup. No consumed ticket/claim is reused; independent R8 PASS + fresh parent admission required before any execution.
'''
(report/'Appendix-C.2.txt').write_text(text)
files=sorted(p for p in report.rglob('*') if p.is_file())
(report/'SHA256SUMS').write_text(''.join(f'{sha(p)}  {p.relative_to(report)}\n' for p in files))
print(json.dumps({'report':str(report),'files':len(files)+1,'source':source,'tree':tree,'seal':sha(report/'SHA256SUMS')}))
