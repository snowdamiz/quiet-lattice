#### 0.10.2 The rubric
The grader scores every criterion 1–5. **PASS requires every criterion at 4 or above and a mean of 4.5 or above.** Anything else is REVISE with one note per failing criterion naming what to change, concretely enough that the worker can act without asking.

*Models and environments (art tasks, city and station builds, ships, creatures)*
| Criterion | 5 means |
|---|---|
| Design language | unmistakably Thalune/Ixari/Ulgani/Compact/Reaches/Cartographer/Hollow per the art bible; nothing generic sci-fi |
| Silhouette and read | identifiable at LOD2 from 100 m; a hull's role or a creature's temperament is legible from its shape |
| Proportion and scale | correct against the 1.85 m biped and 1 m grid; doors, pads, seats fit the bodies |
| Materials | PBR responds correctly under all three lighting cases; hand-painted wear where things wear; no visible tiling, no uniform noise as detail, no blown-out metals (the demo's known failure) |
| Surface detail | detail density matches the asset's class and reads at its intended distance; no baked-looking gradients where geometry is expected |
| Topology and LODs | clean shading, no pinching or n-gon artifacts in the wireframe pass; LOD swaps don't pop at their distances |
| Consistency | matches siblings in its family (the other hulls of the yard, the other buildings of the kit) |
| Fitness for play | colliders match the visual; interact points reachable; animation reads at gameplay speed; hardpoints and bays align |
| No placeholder tell | nothing that reads as blockout, primitive or procedural stand-in |
| Performance | within DESIGN 19.2 budgets; the review scene holds 60 fps |

*UI, HUD, VFX, cutscenes*
| Criterion | 5 means |
|---|---|
| Hierarchy and legibility | the eye lands on the right thing first; text readable at 1080p; contrast meets WCAG AA |
| Fit with the HUD language | minimal, out of the way, consistent with the dot crosshair, arc gauges and fading location line |
| Motion | eases, timing and camera moves feel authored; no pops, no linear tweens, no jitter at 60 fps |
| Theme and palette | uses the people's or faction's palette and the glyph alphabet where lore is shown; dark-sky readability |
| Correctness | no overlap, clipping, cut-off text or wrong state; survives 16:9 and 21:9 |
| Spec match | shows what DESIGN.md describes for that screen or beat |
| Performance | VFX within the particle and draw-call budget; UI costs under 1 ms |

#### 0.10.3 What the grader receives
The grader is a fresh subagent with no access to the worker's transcript. It receives only: the task block and its DESIGN.md references; the art bible; the rubric; and the artifacts: for models, the turntable sheet, the material close-up sheet, the three lighting-case captures at LOD0 and LOD2, the wireframe pass, and the `validate.py` report; for UI/VFX/cutscenes, screenshots at 16:9 and 21:9 and a short captured clip (frames at 60 fps from the smoke harness) of the motion; for in-engine scenes, the review-scene captures and the perf readout. It may request one additional angle or capture, once.

#### 0.10.4 The verdict
```
VERDICT: PASS | REVISE
TASK: P1.E12.T02
SCORES: design 5, silhouette 4, proportion 5, materials 3, detail 4, topology 5, consistency 4, fitness 5, placeholder 5, performance 5 (mean 4.5)
NOTES (REVISE only, one per failing criterion):
- materials: the Kestrel's Hull plates read as a flat grey; add directional wear along the leading edges and panel-line grime consistent with the Lark; roughness map currently uniform 0.5.
ARTIFACTS: assets/renders/kestrel_turntable.png, ...
```
The verdict is appended to `docs/VISUAL-REVIEW.md` by the orchestrator with the artifact paths, so the whole history of an asset's grading is auditable. A human may spot-check any PASS and reopen it; the grader is the visual gate. Apply the owner's fifth-grade disposition in 0.1 separately per component after four visual REVISE rounds, preserving the actual verdict and filing open notes as follow-up tasks. This does not waive code review or merged verification.

