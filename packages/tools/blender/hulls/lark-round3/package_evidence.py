"""Package the completed CPU unit, retaining every failed command and exact asset hashes."""
import ast
import hashlib
import json
from pathlib import Path
import shlex
import subprocess

ROOT=Path(__file__).resolve().parents[5]
OUT=ROOT/'assets/renders/hulls/lark-round3-current'
TOOLS=ROOT/'packages/tools/blender/hulls/lark-round3'
PARENT='0c4396a9194a5f7c99352f630ea7e66514b61115'
RECOVERY='94d0ee14b0d285baf1ce17d7dfa29b0f096a1703'
def read(name):return json.loads((OUT/name).read_text())
def write(name,value):(OUT/name).write_text(json.dumps(value,indent=2)+'\n')
def record(path):
    data=path.read_bytes()
    return {'path':str(path.relative_to(ROOT)),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
audit=read('contract-audit.json')
assert git('branch','--show-current')=='task/P1-E12-T02-lark-r3'
assert git('rev-parse',RECOVERY+'^')==PARENT
assets=[]
for name in ('source','export'):
    actual=record(ROOT/audit[name]['path']);assert actual==audit[name]
    pointer=f'version https://git-lfs.github.com/spec/v1\noid sha256:{actual["sha256"]}\nsize {actual["bytes"]}\n'
    actual['git_lfs_pointer']=pointer
    actual['git_pointer_blob_oid']=hashlib.sha1(b'blob '+str(len(pointer.encode())).encode()+b'\0'+pointer.encode()).hexdigest()
    assets.append(actual)
for file in TOOLS.glob('*.py'):ast.parse(file.read_text(),filename=str(file))
protected=read('ownership-check.json')
for item in protected['protected_files']:
    actual=record(ROOT/item['path']);assert actual['sha256']==item['sha256']
    original=subprocess.check_output(['git','show',PARENT+':'+item['path']],cwd=ROOT)
    assert hashlib.sha256(original).hexdigest()==item['sha256']
allowed=['assets/blend/hulls/lark.blend','packages/client/public/models/hulls/lark.glb','packages/tools/blender/hulls/lark-round3/','assets/renders/hulls/lark-round3-current/']
changed=git('diff','--name-only',PARENT).splitlines()+git('ls-files','--others','--exclude-standard').splitlines()
assert all(any(p==a or a.endswith('/') and p.startswith(a) for a in allowed) for p in changed)
protected.update({'checked_against_parent':PARENT,'source_sha256':assets[0]['sha256'],'export_sha256':assets[1]['sha256'],'out_of_scope_changes':[]})
write('ownership-final-check.json',protected)
receipts=[]
for p in sorted(OUT.glob('20*.json')):
    if p.name.endswith('.watchdog.json'):continue
    r=json.loads(p.read_text());assert 'command' in r and 'exit_code' in r,p
    receipts.append({'receipt':str(p.relative_to(ROOT)),**r})
write('commands.json',receipts)
images=read('cpu-images-viewed.json')
assert all(p.name in {i['name'] for i in images if i['viewed']} for p in OUT.glob('*.png'))
for i in images:
    path=OUT/i['name']
    if path.exists():assert i['sha256']==record(path)['sha256']
external=[record(p) for p in OUT.glob('*.png')]
packed=audit['source_facts']['packed_images']
image_bytes=sum(p['bytes'] for p in external)+sum(p['packed_bytes'] for p in packed)
assert len(external)+len(packed)<=48 and image_bytes<=512*1024**2
preview_count=sum(sum(l.startswith('PREVIEW ') or l.startswith('TURNTABLE CELL') for l in (ROOT/r['log']).read_text(errors='replace').splitlines()) for r in receipts)
# The eight turntable cells are immediately removed; count the final sheet as well.
preview_count+=int((OUT/'turntable-sheet.png').exists())
assert preview_count<=48,preview_count
limits={'external_preview_images_retained':len(external),'packed_authoring_maps':len(packed),'combined_retained_image_count':len(external)+len(packed),'combined_retained_image_bytes':image_bytes,'preview_images_generated_including_deleted_attempts_and_temporary_turntable_cells':preview_count,'limits':'48 compact previews; 512 MiB retained images including source maps; no copied old review images or frame folders','max_recorded_tree_rss_kib':max(r.get('peak_tree_rss_kib') or 0 for r in receipts),'max_recorded_elapsed_seconds':max(r.get('elapsed_seconds') or 0 for r in receipts),'measurement_gap':'Interrupted first export lost final RSS/elapsed telemetry to supervisor EPERM; explicitly reconstructed receipt, no estimated values substituted.'}
limits['unqualified_attempts']=['20261107T061331076303Z-export: teardown lost final telemetry','20261107T061653807513Z-export-clean-source: user interruption lost supervisor telemetry','20261107T064353277769Z-export-node22-shorttmp: RSS calculation invalid and stock decode ran two codecs; see export-failure-analysis.json']
limits['qualified_final_runs']=[{'receipt':r['receipt'],'peak_tree_rss_kib':r['peak_tree_rss_kib'],'elapsed_seconds':r['elapsed_seconds'],'peak_codec_processes':r.get('peak_codec_processes'),'remaining_processes':r.get('cleanup',{}).get('remaining_members')} for r in receipts if r['exit_code']==0 and ('export-qualified-codec1' in r['receipt'] or 'final-contract' in r['receipt'])]
assert len(limits['qualified_final_runs'])==2
for run in limits['qualified_final_runs']:
    assert run['peak_codec_processes']<=1 and run['remaining_processes']==[]
    assert 0<run['peak_tree_rss_kib']<16000*1024 and run['elapsed_seconds']<1800
    receipt=next(r for r in receipts if r['receipt']==run['receipt'])
    assert receipt['before'][0]['sha256']==assets[0]['sha256']==receipt['after'][0]['sha256']
    assert receipt['after'][1]['sha256']==assets[1]['sha256']
write('resource-inventory.json',limits)
manifest={'parent':PARENT,'recovery_commit':RECOVERY,'branch':git('branch','--show-current'),'checkout':str(ROOT),'canonical_recovery':read('recovery.json'),'assets':assets,'source_texture_images':packed,'compressed_export_images':audit['compressed_images'],'livery_index':[{'index':i,**v} for i,v in enumerate(audit['liveries']['variants'])],'export_lods':audit['export_lods'],'tools':[record(p) for p in sorted(TOOLS.iterdir()) if p.suffix in ('.py','.mjs')],'cpu_preview_images':external,'resource_limits':limits,'evidence_files':[record(p) for p in sorted(OUT.rglob('*')) if p.is_file() and p.name not in ('asset-manifest.json','REPORT.md') and '.scratch' not in p.parts and p.name!='.lane.lock']}
write('asset-manifest.json',manifest)
lines=[
'TASK: P1.E12.T02 — Lark round3 CPU/source implementation unit',
'',
'STATUS: DONE (authorized CPU/source unit only; full four-hull task and visual acceptance remain with parent)',
'',
'SUMMARY: Recovered only the canonical Lark source/export in a separate commit, then revised the saved source while preserving its grown-shell silhouette. Added localized contact/leading/maintenance wear, LOD0-derived 4096 PBR atlases shared by every LOD, colocated damage scorch/deformation, a fitted seat/controls/ingress route, continuous boarding rails, and keyed hardpoint sockets. Rigid skins consolidate gear and cockpit assemblies while retaining semantic joints. The compressed GLB includes three indexed liveries, all three states and four LODs. Source and actual compressed-export validation passed. No engine, gameplay, frame-time, GPU or independent visual-grade claim is made.',
'',
'TASK (verbatim): P1.E12.T02(art)Lark,Swift,Kestrel,Mule · deps:E14.T02 · done:fourhullswithgear,canopy,cockpitinterior,hardpointmounts,damagestate,huskedvariant,threeliverieseach;Larkrebuildstoday\'sshipatnewbar · verify:validate;review.',
'',
f'PROVENANCE: app-created checkout `{ROOT}`; branch `task/P1-E12-T02-lark-r3`; clean starting parent `{PARENT}`; separate recovery commit `{RECOVERY}`. Content donor `75ea700462c17d63a69b570e2ca710c5eb1e055d`, equal canonical pointers at retained cleanup `d584a1d386a1a5cd76911b314a7f9c5293aa23a3`; last source `955d75c2588c02cf3b5cecddf6b850bd7e7647ce`. Both recovered bytes were SHA-256/size checked against already-local LFS objects before copying. No fetch or old-branch restoration. Exact canonical and revised pointer text/OIDs/sizes are in [asset-manifest.json](asset-manifest.json). The revision commit containing this report supplies the final Git tree provenance.',
'',
'FILES CHANGED:',
'',
'* `assets/blend/hulls/lark.blend`',
'* `packages/client/public/models/hulls/lark.glb`',
'* `packages/tools/blender/hulls/lark-round3/` — authoring, CPU lane supervisor, baking, previews, serialization adapter and audits.',
'* `assets/renders/hulls/lark-round3-current/` — only fresh worker evidence, receipts and this report.',
'',
'[ownership-final-check.json](ownership-final-check.json) verifies protected exporters/artlib/families/runtime/capture/docs against the parent. Other hulls, shared library and historical reviews are unchanged.',
'',
'ASSET MANIFEST:',
'',
'| Asset | SHA-256 / LFS object OID | Bytes | Git pointer blob |',
'|---|---|---:|---|',
]
for a in assets:lines.append(f'| `{a["path"]}` | `{a["sha256"]}` | {a["bytes"]} | `{a["git_pointer_blob_oid"]}` |')
lines+=['','| State | LOD0 | LOD1 | LOD2 | LOD3 | Draws LOD0/1/2/3 | Length m |','|---|---:|---:|---:|---:|---|---:|']
for v in audit['source_facts']['variants']:
    t=v['triangles'];d=v['draws_all_parts_visible'];lines.append(f'| {v["id"]} | {t["0"]} | {t["1"]} | {t["2"]} | {t["3"]} | {" / ".join(str(d[str(i)]) for i in range(4))} | {v["length_m"]:.4f} |')
lines+=['',f'All LOD3 counts are below 5% of their heroes. The saved reference is {audit["source_facts"]["reference_height_m"]:.4f} m. Hardpoint proximity, {audit["source_facts"]["collider_sample_count"]} collider samples, actual joint displacement, impact texels/deformation, source image hashes and compressed KTX2 inventories are in [contract-audit.json](contract-audit.json). Draw counts are asset primitives with all parts visible, not whole-frame measurements.','',
'VERIFY:',
'',
'Configured Blender lane: `-b -t 2`, CPU Cycles, thread environment 2, one Blender, 1800 s wall limit, 16000 MiB process-tree RSS limit, 16 MiB log limit and image bounds. Final export/audit serialize both encoding and decoding with one codec. Resumed commands use pinned Node22.23.3, fresh short private TMPDIRs and a separate bounded process-group watchdog. One failed resumed attempt exposed a stock two-decoder minimum and an aggregate-RSS shadowing bug; its RSS/codec qualification is explicitly invalidated in export-failure-analysis.json. Those controls are corrected and measured on final runs. Existing compression dependencies were read only; stock exporter/artlib source stayed unchanged. The source is saved before export and the exporter does not call authoring scripts. [commands.json](commands.json) holds exact argv/cwd/head/input hashes/exit/before-and-after assets. [resource-inventory.json](resource-inventory.json) records measured bounds and telemetry gaps.','',
'| Receipt | Exit | Termination / result |','|---|---:|---|']
for r in receipts:
    p=Path(r['receipt']);lines.append(f'| [{p.name}]({p.name}) | {r["exit_code"]} | {r.get("termination_reason") or ("completed" if r["exit_code"]==0 else "failed; see log tail below")} |')
lines+=['','Final source/export stock checks: PASS. Focused negative controls: '+', '.join(n['case']+' — '+n['result'] for n in audit['negative_controls'])+'.','',
'Additional checks: owned Python files parse; `git diff --check` and final allowed-path/LFS-pointer/clean-tree checks are recorded by the finishing shell commands. No tests or standard capture result is inferred from a CPU render.','',
'DECISIONS:',
'',
'* How to reduce draws without losing gear/control semantics → one rigid skin for three gear hinges, one for cockpit shell/stick/throttle per LOD → each vertex belongs to one joint; actual pose evaluation checks its part moves and other parts stay fixed. Canopy frame and glass remain separate.',
'* How to retain Thalune material character without global wear noise → localized surface fields at the leading rim, intake/maintenance lips and port ingress/contact zones → bake real LOD0 albedo/normal/AO/roughness/metallic to shared 4K atlases. Interior seating, consoles and switches use the same atlas.',
'* How to make the boarding route credible → exterior steep ladder plus bent upper rails and sill handholds → retain the open-canopy route and stow it with port gear. REF_Biped, Interact, BoardingFoot/BoardingSill and PilotSeat are source markers; collision and gameplay traversal are parent-engine review items.',
'* Three or five liveries → three distinct source-authored packed palettes (Thalune, Compact, Working), serialized as KHR_materials_variants with per-primitive mappings on all base-state LODs → no additional simultaneous draws. The adapter only serializes saved images/material mappings; it does not generate art during export.',
'* Exporter mesh-validation warnings → inspect before continuing → duplicate faces existed only in decimated LOD1–3. Saved removal preserves every vertex, surviving face material/UV, all LOD0 surfaces and every packed image. [mesh-data-repair.json](mesh-data-repair.json) binds pre/post source hashes and exact LOD0/map equivalence. Reused qualified eight-view previews precede this lower-LOD-only repair; no new images were captured after resumption. Final lower-LOD appearance remains a parent capture item.',
'* Failed diagnostic previews → retain receipts and selected failure images → pre-interruption removal of superseded worker previews is hash-inventoried; no old grader evidence was altered. All files/screenshots present at resumption are preserved. Transform-update, live-iterator visibility and rail topology issues were corrected before the qualified packet.',
'* Long tsx IPC path failure → reproduce with both Node versions and both path lengths → Node26 + 120-byte path fails EINVAL, Node26 + short path passes; Node22 passes both. Pin Node22.23.3 and a fresh short private TMPDIR, without changing shared exporter/meshopt code. See tsx-ipc-root-cause-probes.json and tsx-ipc-root-cause.json.',
'* Husk signals disappearing after compression → reproduce glTF-Transform default-value elision → normalize only four saved husk emission strengths so their effective RGB times strength peaks at 1e-4 (0.01 percent of unit radiance). Geometry/transforms/UVs and every packed map are hash-identical; base/damaged materials untouched. See signal-export-correction.json and signal-export-correction-v2.json, including actual-material serialization red/green. The retained husk view predates this tiny signal-floor correction and is not final engine proof.',
'',
'OUT OF SCOPE FOUND: P1.E12.T02 remains parent-owned for standard engine captures, all-state/all-LOD visual review, family consistency, independent grade, actual gear/canopy/control behavior and performance. Current Review does not expose a KHR_materials_variants selector; parent needs explicit embedded mapping selection for the livery capture matrix. Existing Ship runtime loading/integration is unchanged. No sibling source, historical grader packet, shared exporter/library, runtime capture code, browser/native/GPU service, grant, DB, PR, push or merge was touched.',
'',
'ARTIFACTS:',
'',
'* [asset-manifest.json](asset-manifest.json): canonical/revised Git pointers, asset bytes, source/KTX2 maps, livery indices, LOD mappings, tools and evidence hashes.',
'* [contract-audit.json](contract-audit.json), [audit-blend.json](audit-blend.json), [audit-glb.json](audit-glb.json): actual source/export positives and focused negative controls.',
'* [cpu-images-viewed.json](cpu-images-viewed.json): every preview, exact source/hash provenance, whether it was actually viewed, interpretation and superseded status.',
'* `qualified-*.png`: reused eight-view CPU work packet. The original exact source hash and final LOD0/map equivalence are explicit; this is not a standard GPU capture. Turntable, clearer socket underside and livery views remain in the parent capture inventory.',
'* [gpu-handoff-final-inventory.json](gpu-handoff-final-inventory.json): complete next parent-only GPU matrix including boarding, hardpoints, overlays, articulation, liveries, distance/LOD changes and paired timing runs.',
'',
'CPU IMAGES ACTUALLY VIEWED:',
'',
'| Image | Retained | Interpretation |','|---|---|---|']
for i in images:
    if i['viewed']:lines.append(f'| {"["+i["name"]+"]("+i["name"]+")" if i["retained"] else i["name"]} | {i["retained"]} | {i["interpretation"]} |')
lines+=['','FAILED / INTERRUPTED COMMANDS — exact argv and last 20 log lines:','']
for r in receipts:
    if r['exit_code']==0 and not r.get('termination_reason'):continue
    lines+=['`'+Path(r['receipt']).name+'`','',f'Command: `{shlex.join(r["command"])}`; exit `{r["exit_code"]}`; reason `{r.get("termination_reason")}`.','', '```text']
    lines+=(ROOT/r['log']).read_text(errors='replace').splitlines()[-20:]
    if r.get('supervisor_exception'):lines+=[r['supervisor_exception']]
    lines+=['```','']
if (OUT/'resumed-shell-failures.json').exists():
    for failure in read('resumed-shell-failures.json')['cases']:
        lines += [f'Command: `{failure["command"]}`; exit `{failure["exit_code"]}`.','', '```text',*failure['last_lines'][-20:],'```','',failure['resolution'],'']
lines += ['[tsx-ipc-root-cause-probes.json](tsx-ipc-root-cause-probes.json) records exact Node/tsx argv, versions, TMPDIRs, outputs and exits for the four transport probes. [export-failure-analysis.json](export-failure-analysis.json) records the emission serialization probe and the invalidated resource measurements.','']
(OUT/'REPORT.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'assets':assets,'limits':limits,'receipts':len(receipts),'report':str((OUT/'REPORT.md').relative_to(ROOT))},indent=2))
