from pathlib import Path
import json,hashlib,datetime,sys,shutil
A=Path(__file__).resolve().parent
read=lambda p:json.loads(Path(p).read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(n,d):(A/n).write_text(json.dumps(d,indent=2)+'\n')
C=read(A/'audit-context.json');R=Path(C['run']);H=Path(C['harness']);P=Path(C['parent'])
sys.path.insert(0,str(H))
from integrity import directory_hashes,source_snapshot
s=read(A/'SUMMARY.json');a=read(A/'attachments.json');g=read(A/'achievements.json')
n=read(A/'network-font-proof.json');p=read(A/'provenance-proof.json');route=read(A/'route-cleanup-proof.json')
native=read(A/'console-native-owner-close-proof.json');release=read(A/'parent-release-proof.json')
ctx=read(R/'context.json');cmd=read(R/'command.json');env=read(R/'environment.json')
report=read(A/'test-report-summary.json');assert report['config']['maxFailures']==1
assert report['config']['version']=='1.64.1' and report['config']['webServer'] is None
assert report['config']['filteredProjects'][0]['use']['trace']=='off' and report['config']['filteredProjects'][0]['use']['video']=='off'
assert not report['standalonePngPaths'] and len(a)==10
assert not list((R/'results').rglob('*.zip')) and not list((R/'results').rglob('*.webm'))
originals=read(A/'originals-before.json');after={root:directory_hashes(root) for root in originals}
assert originals==after
save('originals-after.json',after)
save('preservation-final.json',{'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'roots':[{'path':root,'files':len(files),'unchanged':True} for root,files in originals.items()],
 'priorPacketRoots':14,'totalOriginalRoots':len(originals),'totalOriginalFiles':sum(map(len,originals.values())),
 'spentTicketAndClaimUnchanged':True,'screenshotCleanupPerformed':False})
assert source_snapshot(ctx['sourceRoot'])==read(R/'source-before.json')

art=['# Actual decoded attachments','',
 'Lossless base64 decoding from the original Playwright JSON. No rendering, synthesis, recompression or visual grading. PNG dimensions, chunk CRCs and compressed stream integrity were checked; decoded pixel streams were kept only in memory.',
 '',f"Source report: [{R/'playwright.json'}]({R/'playwright.json'})",
 f"Source SHA256: `{sha(R/'playwright.json')}`",'',
 '| Artifact | Dimensions | Decoded bytes | SHA256 |','|---|---:|---:|---|']
for x in a:
 dims='1280×720' if x['contentType']=='image/png' else '—'
 art.append(f"| [{x['name']}]({x['extractedPath']}) | {dims} | {x['bytes']} | `{x['sha256']}` |")
art.extend(['',f"PNG total: **{s['pngBytes']:,} bytes**. Gameplay JSON: **{s['gameplayJsonBytes']:,} bytes**. Server log: **{s['serverLogBytes']:,} bytes**. All ten attachments: **{s['allAttachmentBytes']:,} bytes**.",'',
 'The original parent observation mislabeled base64 character lengths as bytes. Its preserved original and corrected final observation are copied into this audit. Every corrected decoded count matches this independent extraction; release facts are unchanged.'])
(A/'ARTIFACTS.md').write_text('\n'.join(art)+'\n')
cp='PYTHONDONTWRITEBYTECODE=1 '+' '.join(release['dispatch']['argv'])
child=' '.join(cmd['command'])
body=f'''TASK: P1.E07.T07 / P1.E08.T09 companion focused live gameplay — R6 postrun C.2 audit
STATUS: PASS — one actual focused native test; read-only postrun audit complete
SUMMARY: Parent OS exit0. Exactly1 required test passed,0 failed/skipped/unexpected/flaky,
retry0/repeat1/worker1, no timeout. Test35.970s; Playwright report38.979659s; supervisor39.570s;
parent wrapper62.11264258302981s including preparation/admission/drain/cleanup. These are elapsed
durations for this functional QA run, not performance measurements or a budget-compliance benchmark.
The final source reaches live retirement. Eight actual1280x720 PNGs, gameplayJSON and serverlog
were losslessly extracted. No image was viewed, rendered, synthesized, edited or blindly graded.

EXACT PIN / INPUTS
Worktree {ctx['sourceRoot']}
HEAD {s['head']}
TREE {s['tree']}
SOURCE {s['sourceHead']}
SOURCE TREE {s['sourceTree']}
Actual independent R6 SOURCE_CPU PASS: {ctx['sourceReviewReceipt']}
Report SHA256 {ctx['sourceReviewReceiptSha256']}
Run {R}
Parent {P}
Bound harness {H}
Assigned ticket {release['dispatch']['ticketPath']}
Ticket SHA256 {release['ticketSha256']}
Spent ticketId {ctx['ticketId']}; singleUse journal exactly matches assigned ticket.
Spent claim {ctx['claim']}. Neither is reusable; no new claim, grant or ticket was made.
Parent slot {ctx['slotAssignment']}; assignment {ctx['assignedAt']}.

ACTUAL COMMANDS / FINITE LIMITS
Parent cwd {cmd['cwd']}
{cp}
Child (sandbox-exec wraps this with the retained live.sb):
{child}
Dedicated symbiotic-online.spec.ts only through symbiotic.config.ts; exactly1 matched and executed
test at line267; no annotations/skips/retries. Effective test timeout300000ms, global420000ms,
outer450s+20s owned drain, maxfailure1. Actual owned drain0.149s. Font DNS10s+5s drain,
acquisition70s+5s drain. Their producers exited0 in0.322s and0.825s, no timeout/survivors/errors.
Actual Playwright1.64.1 config has traceoff/videooff/webServernull, no global setup/teardown;
startOnline owns the server. Two manual gameplay contexts1280x720; one framework-created context
is also observed (3 context records total), not a third gameplay client. BaseURL localhost5190
in inherited config is not the actual app URL; pages used private Vite127.0.0.1:61448.
No trace ZIP/video/raw-frame capture found. Exact parent dispatch, complete effective Playwright
config, child command and environment are retained, not reconstructed claims.

LIVE GAMEPLAY / ASSERTION FACTS
Production gateway/dev characters were created; only the initial Symbiotic fragment was SQL-staged.
Stored skill replies show Bond unlocked but initially unbought, then bought, then ground slot0 Bond.
Both actual clients transported their owned ship, acquired input, and changed same entity from
landed to positive-HP foot mode in frame1262081916:7. Owner1 and observer2 are distinct.
The passed source sequence asserts pre-analysis cast refusal(reason target), analysis success and
post-analysis cast success. Analysis JSON independently retains target34/resultnew/eligible,
docile biped Lumbering Rhecor Walker. Cast answers themselves are not separate retained JSON fields.

Both retained bound observations independently have companion34/species0/owner1 in real snapshots,
drawn=true/instanced=true/submitted=true/offline=false, correct body/frame/species, instance-matrix
translation error<0.02, species-size scale, projected point in frustum, and actual pick34.
The onAfterRender callback is actual mesh draw-submission evidence; it is not a GPU pixel-quality grade.
The source asserts actual owner S movement>14m and follow distance<8m on both clients; those exact
owner-distance samples are not separately stored. Retained companion movement independently recomputes:
owner client wire28.020224411702163m/render29.67124140126245m, tick245->315;
observer wire21.415597636132176m/render25.659534160961943m, tick260->315.
Both satisfy>6m, newer snapshot and pick34 after follow.

Combat starts with enemy35 HP[1,1]. Both clients retain source34->target35 combat event amount22.32,
attack/leap/killedfalse, enemy HP0.7000000000000001; both target and companion have real drawn
instance submissions. Enemy remains alive/nondead; companion HP1. This is companion-attributed
health loss, not an enemy corpse or owner-only visual state.
Before release, observer independently picks companion34 and retains its living drawn instance.
Release tick380 has correct living foot observer2 HP1 and correct enemy35/species4 HP0.7 in frame.
Pre-disconnect owner PNG is captured before await page.close(runBeforeUnloadfalse); page.isClosed
is asserted and ownerPageClosed=true retained, before clock thaw.
Retired tick387 is newer than380: observer remains joined/entity2/foot/HP1; enemy35/species4 is
alive HP0.7/modeidle in the same frame. ownerGone=true; companionGone=true means all of snapshot,
remote map and fauna shown-instance membership absent. targetGone=true separately removes the
companion hit target; picked35 differs from companion34. These predicates are asserted again on
the retained snapshot after the wait. Surviving observer supplies the eighth disconnect PNG.
Fixture errors=[], test errors=[], top-level report errors=[]. Retirement was reached and retained.

OWNER DEPARTURE / REJOIN LIMIT
The real terminal owner page close was awaited and isClosed checked; later code uses observer only.
Retained server output has exactly4 dev-login events: createdtrue then createdfalse once per
character, corresponding to fixture auth and initial page bootstrap. No additional owner dev-login
or owner document reload/rejoin is observed. Two Vite connecting/connected pairs correspond to
initial two gameplay pages. This is a finite page-close/snapshot/log observation, not an independent
continuous CDP navigation or network history. It does not claim indefinite future absence.
The context3(observer) dev-document ERR_ABORTED occurs during final teardown after evidence;
it is preserved and does not represent owner rejoin. Owner context2 has no document abort here.

FONTS / PAGE CONSOLE / LOCAL ABORTS / NATIVE WARNINGS
All34 retained public CSS/font asset bodies total452765bytes, have HTTP200 and exact matching hashes.
Sixteen context-route font fulfillments across8 unique URLs (8 per gameplay context) match those
retained bytes;16 external response events report200,16 finished, no failed external font request,
no policy violation, no observation-limit record. CSS/font content was not blanked or substituted.
Acquisition occurred in the actual authorized parent run; this audit made no network requests.
Browser event observer reports pageerror0/console-error0; unfiltered fixture error collection empty.
Three exact local requestfailed events remain (full URL/error/frame/context/location in network proof):
10:33:44.931Z context2 GET http://127.0.0.1:61448/audio/music/music_planet_2.ogg net::ERR_ABORTED;
10:33:50.102Z context3 GET http://127.0.0.1:61448/audio/music/music_planet_1.ogg net::ERR_ABORTED;
10:34:10.544Z context3 GET http://127.0.0.1:61448/?dev=bond8b52839ce9 net::ERR_ABORTED.
No ERR_NAME_NOT_RESOLVED is observed. Earlier failed-run DNS explanations are not retroactively proved.
Native merged output retains8 CVDisplayLinkCreateWithCGDisplay failures(CVReturn-6670),1 daemon
parameter error(-50),5 Metal library-cache overflow warnings,2 render-pipeline-cache warnings,
and2 Three PCFSoftShadowMap deprecation messages. These are not filtered or relabeled as page errors.
Metal launch flags plus Metal backend warnings and actual render callbacks/pixels support actual
native Metal execution; no separate renderer-info extension/GPU counter/FPS measurement was captured.
Actual browser exitCode0/signalnull and temporary-directory cleanup are in native-producer-output.txt.

PROVENANCE / BEFORE-AFTER
All4376 tracked source file hashes equal frozen harness, run-before, source-after, cleanup-after
and this audit's current snapshot. Current HEAD/tree match and worktree is clean. Fixture/config/
assets/runtime/protected sources were not edited. All12422 recorded dependency content hashes
equal frozen-before, run-after and current; original generated-cache exclusions remain exclusions.
Node22.23.3 SHA25668f4d07ca49e0500cc135c7e0a445093e228e42e126ac22306d045f0a8c2636b.
Installed Playwright1.64.1 and Corepack/pnpm cached distributions are hash-unchanged; no package-manager
install ran in this audit. Runtime manifest and50-file harness seal plus81-file independent R6
review seal verify. Assigned/used-ticket files are legitimate added runtime records, preserved.
Actual Chromium headless-shell1248 prelaunch/after/current binary SHA256:
77d8278b1ac9d0687fad4e817ea83023ede09b1deef36e1864b49ba194ac9634.
Exact executable path/options/private profile in provenance-proof.json and raw launch output.
Fresh actual run disk receipts: font preflight free20178845696bytes; cleanup-before20140408832;
cleanup-after20161892352. Parent dispatch recorded20180910080. These are observed free bytes at
their respective times, not reclaimed-byte or current admission claims. Source/dependency cache
and binary proof is file-hash evidence, not new integration/CPU tests.

PRIVATE ROUTES / RAW CLAIM AND CLEANUP
SQL127.0.0.1:53055, database {ctx['database']}, userastra.
Redis127.0.0.1:53058/db8, marker {ctx['marker']}.
PG exact ID66c3a97097e4c8f6bd0b6e2547313cbb42aa4f57c34bf7ab58decf56ba15bdfb;
Redis exact IDd06423c2a793f91db1b355ebbf101363be7c16ad3f171152224602ee6a9897a4.
Initial/final docker inspect receipts show healthy/running and expected private127.0.0.1 bindings.
Thirty-six raw service control commands all exited0 with no stderr. Before claim, DB8 empty/no
application clients and fresh SQL name absent; atomic DBSIZE+SETNX marker result1, CREATE DATABASE,
then exact SQL/currentuser and Redis selectedDB/marker verification. No unknown existing fixture adopted.
Seventeen actual SQL StartupMessages all name only this fresh database/userastra;13 Redis SELECTs
all select8. Eleven per-process/thread preimport verifications precede the corresponding11 live
entry receipts. Four worker constructions inherit environment; child records preserve ownership.
Observed Node TCP destinations:53055,53058 and owned61423/61429/61430; no forbidden/default destination.
Two recorded Redis mutations affect only proven-owned astra:shard:main:world. No Redis0/7/FLUSH/sharedreset.
Route evidence is pre-import Node socket/protocol instrumentation plus native OS sandbox controls,
not an exhaustive kernel packet capture of every native socket. Nonloopback browser network was
denied; exact fonts were fulfilled from acquired bytes. Guard limitations are not hidden.

Supervision proves observed exit and empty remaining/registered/unknown sets, no producer or
cleanup errors. Native browser descendants outside the original group are tracked with PID+birth+
argv and ownership. Raw listeners-after-drain and listeners-before-drop receipts show no owned
identities/tmp references/listeners, before cleanup's fresh namespace removal. No PID/name-only kill
was issued by this audit. SQL private-client count0 before DROP; only fresh DB dropped. Atomic marker+
complete known keyset verification deletes exactly2 explicit owned keys (marker and world key).
Post-cleanup DB8 size0, markerabsent, no Redis8 appclients, SQL DBabsent, healthy samecontainers;
temporary profiles absent. Raw receipt command indices and full listener producer outputs are in
route-cleanup-proof.json. No private service was re-queried during this audit.

Fresh read-only OS observations corroborate all33 unique recorded PID/birth identities absent
(including font/preflight producers; parent separately checked18 run PIDs), no run-temp references,
empty owned tmp, no observed owned TCP listeners. Complete bounded lsof exit/stdout/stderr and
kernel birth/argv observations are retained. No resource recovery/cleanup was needed or performed.
Parent release at2026-11-07T10:35:11.310278+00:00 is supported by recorded cleanup and parent PID
observations; fresh audit absence agrees. GPU is released for this task; audit acquired no GPU slot.

ARTIFACTS / BYTE ACCOUNTING
All8 PNGs were inline bodies in playwright.json; no original standalone PNG paths existed.
They were base64-decoded exactly once into exclusive0700 audit attachments and byte-hashed.
PNG signature/IHDR dimensions, every chunk CRC, IEND boundary and decompression integrity pass.
Each1280x720;7284492PNG bytes;27719gameplayJSON bytes;1280serverlog bytes;
7313491total decoded bytes. Exact paths, dimensions and SHA256 for all10 are in ARTIFACTS.md
and attachments.json. No recompression, synthesized image, screenshot cleanup or pixel grade.
Initial parent metadata labeled base64 character counts as bytes. Preserved initial and corrected
final observations are both retained; all final decoded counts independently match. Release time,
cleanup and PID facts are unchanged. This was metadata correction, not altered capture content.

PRESERVATION / AUDIT OPERATIONS / LIMITS
All14 prior packet roots plus this run, bound harness, parent and R6 review:18 roots/5709 original
files are byte-identical before/after this audit. Spentticket/claim, earlier FAILs and first old
COULD NOT RUN remain unchanged. Originals-before/after and preservation-final record exact paths.
Only new scratch evidence files were written under {A}. Existing extraction/proof code was
adapted in this fresh audit for the new schema/result; no runtime/fixture/assertion/source edits.
Audit ran serial small Python hashing/base64/PNG checks, git reads, kernel process observations
and bounded local lsof only. No new native/browser/server/serviceclaim/network/test/harness/run,
retry, art/Blender job, broadCPU suite, screenshot cleanup, push/PR/merge or source change.
One read-only guessed stderr path was absent; actual producer stdout is merged and was located
and preserved. exploration-notes.txt records this, without inventing an unavailable log.
This PASS covers the exact focused live gameplay fixture on the pinned branch. It is not an art
blind grade, FPS/performance result, full-smoke/CI/merged-tree/release qualification or a merge grant.
Test assertions, source review and actual pixels are distinct evidence; pixels await any separate
independent visual inspection. No failure tail exists for this successful test; stdout-tail.txt
retains the actual ending and all native messages remain unfiltered.

EXACT ENVIRONMENT (recorded, not executed by this audit)
{json.dumps(env,indent=2)}

PROTECTED FILE HASHES (full4376 map retained separately)
{json.dumps(p['protectedHashes'],indent=2)}
'''
(A/'Appendix-C.2.txt').write_text(body)
shutil.copy2(A/'Appendix-C.2.txt',A/'REPORT.txt')
save('final-receipt.json',{'scope':'FOCUSED_LIVE_GAMEPLAY_POSTRUN_AUDIT','verdict':'PASS',
 'head':s['head'],'tree':s['tree'],'auditRoot':str(A),'report':str(A/'REPORT.txt'),
 'reportSha256':sha(A/'REPORT.txt'),'summarySha256':sha(A/'SUMMARY.json'),
 'artifactsSha256':sha(A/'ARTIFACTS.md'),'attachmentsManifestSha256':sha(A/'attachments.json'),
 'pngCount':8,'pngBytes':s['pngBytes'],'totalDecodedAttachmentBytes':s['allAttachmentBytes'],
 'parentOsExit':0,'testCount':1,'retry':0,'skipped':0,'timedOut':False,
 'gpuReleasedAt':s['gpuReleasedAt'],'privateServicesRequeried':False,
 'allOriginalsUnchanged':True,'noNewRun':True,'visualGrade':False})
files=sorted(p for p in A.rglob('*') if p.is_file() and p!=A/'SHA256SUMS')
entries=[(sha(p),str(p.relative_to(A))) for p in files]
(A/'SHA256SUMS').write_text(''.join(h+'  '+n+'\n' for h,n in entries))
assert all(sha(A/n)==h for h,n in entries)
print(json.dumps({'auditRoot':str(A),'sealFiles':len(entries),'sealSha256':sha(A/'SHA256SUMS'),
 'reportSha256':sha(A/'REPORT.txt'),'artifactsSha256':sha(A/'ARTIFACTS.md'),
 'summarySha256':sha(A/'SUMMARY.json'),'pngBytes':s['pngBytes'],'totalDecodedBytes':s['allAttachmentBytes'],
 'originalFilesUnchanged':sum(map(len,originals.values()))},indent=2))
