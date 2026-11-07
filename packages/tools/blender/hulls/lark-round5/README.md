# Lark component round5 source checkpoint

Task: P1.E12.T02(art)Lark,Swift,Kestrel,Mule · deps:E14.T02 · done:four hulls with gear,canopy,cockpit interior,hardpoint mounts,damage state,husked variant,three liveries each;Lark rebuilds today's ship at new bar · verify:validate;review.

Scope: Lark only. Recovery is pinned separately in recovery.json. Round4 metadata and full-verdict SHA are in round4-metadata.json. No global review/progress/plan files edited. No GPU, browser, native capture, push, PR or merge.

Source edits: retain the 48-triangle LOD0 glazing in all lower LODs (previously 14/9/0–1 triangles); smooth glazing face shading; persist interpolated LOD0 shell corner normals onto LOD1/2, removing the previous live transfer modifier on those bodies. UV coordinates and shell geometry are unchanged. These edits address identified source defects, not a claim that the full visual findings are resolved.

The author source had no saved body custom normals. A live transfer modifier existed, so absence of saved normals alone does not prove the runtime breakup's root cause. The previous modifier's evaluated/exported behavior still needs investigation. Canopy frame fit and continuous geometry remain unproven.

Remaining work: actual canopy gap correction if confirmed; rectangular wear repaint; demonstrable 15–30% husk exposed frame plus restrained seam/glyph/rust hierarchy; cockpit display/control and seat joinery; posed scale/boarding references and clearance verification. capture-inventory.json lists the parent-owned runtime evidence. evidence_inventory.py inventories source positions and matrices; it is not a collision or ergonomic test. Performance qualification stays parent-owned.

Independent source review must precede runtime captures. This checkpoint is not a complete round5 candidate and does not invoke fifth-grade merge disposition.

CPU inspection: original closed_side plus r5-closed-canopy and r5-weld-closed-canopy were viewed. Welding reduced each glass mesh from 144 to 48 vertices, but conspicuous triangular highlights and frame gaps remain in the preview. No glazing visual fix is claimed. The static LOD2 breakup root cause is likewise not established by this checkpoint.
