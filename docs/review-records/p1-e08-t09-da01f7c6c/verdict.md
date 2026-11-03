REVISE — P1.E08.T09

Frozen HEAD `da01f7c6c7e4e8c91e73bda643f4c6e2cd1547da` on `task/P1-E08-T09`; initial working tree clean. Fresh visual-only grade.

Mean **4.14/5**. PASS needs every criterion≥4 and mean ≥4.5.

| Criterion | Score |
|---|---:|
| Hierarchy / legibility | 4/5 |
| Fit with minimal HUD language | 5/5 |
| Motion | 4/5 |
| Theme / palette | 5/5 |
| Correctness across 16:9 / 21:9 | 3/5 |
| Visual spec match | 4/5 |
| Performance (provided HUD sample scope) | 4/5 |

Hierarchy / legibility — Damage values, amber critical value, E prompt, codex title/subline and reward toasts are readable in the supplied 1080p day/night stills. Number strokes/shadows and dark plates retain separation. Peripheral reward type is small and secondary. No observed unreadable new message; formal AA measurement is outside this review.

Fit with minimal HUD language — Sparse floating numbers, compact right reward stack, restrained bottom interaction plate and a single large discovery title preserve the dot-crosshair/navigation hierarchy without introducing a competing panel system.

Motion — Every saved frame was inspected through ordered focal sheets. Damage values rise and fade progressively; the sampled edge flash recedes from 055 to 080; a drawn creature rotates into its death state across the 119–130 neighborhood. No observed number jitter, clipping pop or discontinuous death teleport in the inspected progression. This score concerns recorded progression, not verified real-time 60fps; banner easing and offscreen turn timing are unqualified.

Theme / palette — Warm white labels, amber emphasis, dark translucent plates, teal reward rules and red danger vignette fit the art-bible flight-deck HUD palette in both lighting sets.

Correctness across 16:9 / 21:9 — REVISE: all four offscreen stills display the ordinary damage stack 9/23/17 near screen center while no hit creature is visible there. Day places it over the parked Starship; night places it over empty terrain/mushrooms. This makes the target association ambiguous. Keep creature damage feedback associated with a visible hit target, or suppress/expire it when no such association can be shown; retest a camera turn with numbers alive at both aspect ratios. These stills do not establish ownership, causal implementation or duration. Other supplied states show no banner/toast overlap or viewport clipping.

Visual spec match — A visible herd supplies drawn combat targets; white/amber hit values, danger flash, XP/units rewards and the species codex banner are present. The analysis banner includes body-plan role, temperament, one-of-five threat stars and Bond text, matching the visible analysis/combat presentation. Replicated authority and AI/spawn deletion are not visual claims.

Performance (provided HUD sample scope) — The frozen readouts report day mean 0.158 ms, p95 0.300 ms, worst 0.400 ms and night mean 0.225 ms, p95 0.400 ms, worst 0.500 ms over 204 frames each, with no sample over 1 ms. These satisfy the supplied HUD-sample budget. They do not qualify whole UI/render cost, current host/backend or real-time 60fps; no visual defect is inferred from those separate gaps.

Observed revision request

REVISE: all four offscreen stills display the ordinary damage stack 9/23/17 near screen center while no hit creature is visible there. Day places it over the parked Starship; night places it over empty terrain/mushrooms. This makes the target association ambiguous. Keep creature damage feedback associated with a visible hit target, or suppress/expire it when no such association can be shown; retest a camera turn with numbers alive at both aspect ratios. These stills do not establish ownership, causal implementation or duration. Other supplied states show no banner/toast overlap or viewport clipping.

Separate qualification gaps

- Neither supplied ordered sequence depicts the offscreen camera turn. The four offscreen stills establish ambiguous damage-number placement but not duration, ownership, or cause.
- Analysis banner timing is represented by stills, not established by the saved combat sequences.
- Provided readouts report HUD samples only and do not establish current host/backend, whole UI/rendering cost, real-time cadence or 60fps.
- Legibility and palette were visually inspected; this is not a formal WCAG contrast conformance audit.
- Visual artifacts cannot establish replicated authority, interpolation across clients/reference frames, AI/spawner deletion, dev-server behavior, headless client consistency or gate:removed. Those remain independent engineering/QA qualifications.

Evidence actually viewed

All 28 supplied stills and both original clip sheets were viewed in full with `view_image(detail=original)`. Every frame 000–203 in both original sequences was inspected through twelve CPU focal sheets (top-left crop (700,180,800,580), resized to 400×290). Frames 055, 080, 124, 203 in each sequence were also viewed in full at native size. The focal sheets do not show the complete screen. No playback or fresh runtime timing occurred. The sequences keep facing the herd and cannot establish duration/progression of the offscreen state.

Viewing record: `/tmp/fauna-visual-sol-20261102-da01f7c6c/viewing-record.json`
SHA-256: `15284b4c99c11a0e56ef390861d8579a4849527a00bc02895f4653ff6f74b35f`

Original manifest: `/tmp/fauna-visual-sol-20261102-da01f7c6c/original-artifact-manifest.json`
SHA-256: `73882cdd647f5053c462d0aca0f8e59341a4489e60691ad35e99e08e588080fc`

All 440 originals were rehashed after inspection: zero changes. No source edits or main-doc edits; no additional capture requested.
