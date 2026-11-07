## P1.E04.T06 — First independent visual grade (2026-11-03 UTC)

Verbatim grader report:

# VERDICT: REVISE

Task: **P1.E04.T06 — Remote pilot markers polish**. This is the first explicit fresh artifact-only verdict, following the accepted supplement.

| Criterion | Score /5 | Assessment |
| --- | ---: | --- |
| Hierarchy / legibility |4| Near names read clearly at1080p; sparse naming and dark halos keep pilot text subordinate to flight information across sky, surface and bay views. Full #E9E7E2 core pixels were observed in a near label. No exhaustive pixelwise4.5:1 proof was obtained. |
| Fit with HUD language |5| Thin keyed diamonds, restrained names/ranges, dot crosshair and arc gauges are coherent and stay out of the way in both aspect ratios. |
| Motion |3| Authored fading is eased, attached to its diamond and approximately150ms on the deterministic animation clock. **Failing qualification:** the required jitter-free60fps runtime motion is not demonstrated. Screenshots advance deterministic1/60s steps at about6 wall-clock fps; measured rAF-gap medians are33.4–66.6ms. These artifacts cannot establish observed60fps motion or identify the cause of delivery gaps. |
| Theme / palette |5| Warm-white pilot text and teal keyed diamonds fit the existing palette and remain identifiable in dark sky and busy surface/bay views. No unrelated environment or hull-asset quality was graded. |
| Correctness |4| Inspected product views show no new label overlap, clipping or cutoff at16:9 or21:9. Supplied clip receipts have at most nine nonzero named labels including fades, supporting the sampled views; no exhaustive OCR or source-invariant proof was performed. |
| Spec match |4| Visual evidence covers near/range-only marker hierarchy, moving fades, crowded labels, near-hull crossing, beyond-reach suppression, boost-at-edge detection, and full/half/35% capacity poses at both aspects. Exact source stat binding and alarm audio/cadence are outside what these rasters prove. |
| Performance |2| **Failing qualification:** total UI cost under1ms is not established. Five actual HUD-script trial medians are0.6–0.8ms, but they exclude deferred browser work; their p95 values are2.3–4.8ms. The separate conservative profiled union has median3.2515ms and attribution/overhead limits. wholeUiCostMs remainsnull and assessment INCONCLUSIVE. Neither scoped result qualifies the whole-UI budget. |

**Mean:27/7 =3.86/5.** PASS requires every criterion≥4 and mean≥4.5; both gates fail.

The visible polish is coherent, and no additional cosmetic defect is asserted. REVISE is required for the motion/runtime and whole-UI performance qualifications above; the measured script median must not be represented as a total UI budget pass. No further supplemental capture request is made in this verdict.

Artifact roots:

- `/Users/andreyyurlov/.codex/worktrees/p1-e16-t09-count-rollover/space/assets/renders/ui/P1-E04-T06-capture01` — all24 required stills, seven sheets,71 unique original motion frames inspected.
- `/Users/andreyyurlov/.codex/worktrees/p1-e16-t09-count-rollover/space/assets/renders/ui/P1-E04-T06-supplement01` —21:9 original still, sheet,11 original frames, scoped readout/validation and raw trial/receipt metadata inspected.

Exact image/frame paths, verified bindings, scope of timing recomputation and honest inspection limits: `/tmp/p1-e04-t06-visual1-sol-final/VIEWING-RECORD.md`. Prior record preserved at `/tmp/p1-e04-t06-visual1-sol/HOLD.md` and included verbatim in the combined viewing record.

Images support visual state and authored animation judgments. They do not independently prove exact source alpha values, exhaustive WCAG-AA pixel contrast, nearest-eight selection under every input, fading-box reservation under every overlap, ship.stats source binding, fractional35% alarm behavior, alarm audio/cadence, live online multiplayer or target-device performance. The supplied diagnostic sensor overlays were treated as instrumentation, not product clutter.
