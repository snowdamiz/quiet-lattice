# Blind visual grade — P1.E08.T09
Generated: 2026-11-07T12:52:28.940252+00:00
Packet: /private/tmp/fauna-visual-packet-current-xmd3v6d9
Scratch: /private/tmp/fauna-blind-grade-6gHQDn
Grader: independent blind visual sub-agent (no prior grades/transcripts/repo histories)

## VERDICT
VERDICT: PASS
TASK: P1.E08.T09
SCORES: hierarchy 5, fit 5, motion 4, theme 5, correctness 5, spec 5, performance 4 (mean 4.71)
NOTES: none (PASS; no failing criteria)

## Packet verification
- SEAL.json sha256: fda375b96c63b402639386fc83dc684e57ed44c5ea6adeff8d3ee8068cef5922
- All 7 sealed packet files match SEAL.json byte sizes and sha256.
- INDEX.md sha256: 1e67e5d166ffb38ac9491bf4b245b6801f8a197e3558dee7745aacce0ea3a117 (matches brief 1e67e5d166ffb38ac9491bf4b245b6801f8a197e3558dee7745aacce0ea3a117)
- artifacts.json: sourceHead=0922f7fc3df310cbdd624d8fa5846b73a9cfe533, sourceTree=baa2cd37e8e767e73612161bca28fc425d87cde1
- Payload: 768 files / 418439146 bytes verified against artifacts.json absolutePath hashes (0 mismatches).
- Counts: still=60, sheet=6, frame=696, readout=6

## Scope limits (from scope.json / INDEX)
- Capture type: offline deterministic visual replay; renderedFrameStepSeconds=1/60.
- observedRealtime60fpsQualified=false; liveServerQualifiedByThisPacket=false.
- Readouts measure sampled HUD frame cost only; do not establish whole-scene / whole-game 60 fps or particle/draw-call budgets.
- Task grades replicated-fauna presentation + combat HUD/analysis presentation; not replacement creature mesh authoring.

## What was inspected (and why sufficient)
### Still images (60/60)
All 60 full-resolution stills were opened either directly or via CPU-scaled 640px inspection copies / montages derived only from originals:
- fauna-combat (day): 16x9/21x9 start, main, numbers, flash, analysis, kill, offscreen
- fauna-combat-night: same set
- fauna-hit-turn-{day,night}-{16x9,21x9}: 16x9/21x9 start, main, kill, offscreen each
Purpose: HUD hierarchy, damage numbers, flash, XP/loot toasts, analysis/codex banner, aspect survival, day/night contrast.

### Clip sheets (6/6)
All six clip-sheet.png originals inspected as navigation aids for clip-wide motion overview (not substitutes for stills/key frames).

### Ordered motion sequences (sampled, not all 696 frames)
Deterministic 1/60 simulation samples. Claim is NOT that every frame was individually viewed.

**fauna-combat day (204 frames):** frames 055,058,060,062,065,070,075,080,090,100,120,140,150,155,160,165,170,175,180,185,190,200,203
- Why: flash peak→decay (55→80), floating damage numbers mid-clip, XP/codex settle late, end state.
Edge-redness measurement confirms flash peak ~f055 (edge≈0.23) decaying to baseline by ~f080.

**fauna-combat-night (204 frames):** frames 055,058,060,062,065,070,080,100,150,160,180,200,203
- Why: same transitions under dark-sky readability; flash stronger contrast (edge≈0.24 at f055).

**fauna-hit-turn-day-16x9 (72 frames):** 000,004,008,016,018,019,020,021,030,040,041,054,055,071
- Why: consecutive around target leave-view (~19), mid-turn ship view, return, late hit (54).
Readout + local white-text density: numbers present early (0–8), cleared while offscreen (18–30), return with value at 54+.

**fauna-hit-turn-night-16x9 (72 frames):** 000,018,019,020,021,030,040,054,071
- Why: night counterpart of the offscreen/return transitions.

Hit-turn day/night 21x9 units reviewed via their stills + clip sheets (same scripted beat; 21x9 stills confirm aspect). Full 72-frame consecutive pass not repeated on every hit-turn unit after day-16x9 established the offscreen hide/show behavior.

### Supporting measurement (CPU-only, ≤128MiB scratch)
- Exclusive scratch: /private/tmp/fauna-blind-grade-6gHQDn (~61 MiB derived crops/montages/scaled copies; originals untouched)
- Red-vignette edge excess on flash stills vs numbers stills; frame series 50–80 day/night
- OCR spot-checks on kill/analysis stills; right-edge crops confirm +30 XP / +7 units at 16:9 and 21:9 day and night

## Supported visual findings
1. **Damage numbers:** World-anchored white/amber figures (e.g. stacks 9/17/22/14, singles 31, kill pair 26/19) readable day and night at 16:9 and 21:9; hide when target leaves view on hit-turn.
2. **Damage flash:** Red edge vignette present; night high contrast; day subtler but measurable and continuous decay over ~25 frames (~0.4 s at 1/60 sampling).
3. **XP/loot toasts:** Minimal right-edge toasts `+30 XP` and `+7 units` on kill stills both aspects/day-night; analysis path shows `+300 XP`.
4. **Analysis/codex:** Banner `NEW SPECIES ANALYZED` / `SKITTISH GANPHA BEAST` with Grazer · Skittish · ★☆☆☆☆ · Bond: with Big Game; bottom codex confirmation; analyze prompt when applicable. Survives 21:9.
5. **HUD language:** Minimal corner chrome, warm-white type, amber accents, danger-red flash, teal life-support, center location line — consistent with art-bible flight-deck HUD.
6. **Fallen creature:** Side-settled blue ganpha visible in flash/kill/analysis stills without floating/penetration tells in inspected frames.
7. **Performance (supported only):** combat readout mean 0.206 ms / worst 0.500 ms; night mean 0.226 / worst 0.400; none over 1 ms. Does **not** prove whole-scene 60 fps or VFX particle/draw-call budgets.

## Criterion notes
All criteria ≥4; mean 4.71. No REVISE notes.
Motion scored 4 (not 5): sampled motion reads authored (flash ease, number float, offscreen clear), but packet does not prove absence of jitter at observed realtime 60 fps.
Performance scored 4 (not 5): UI cost under 1 ms is evidenced; whole-render/VFX budget and realtime 60 fps are out of packet proof.

## Artifact inventory
See inventory.json (stills/sheets/readouts with sha256). Frame hashes live in artifacts.json (696 frames; verified en masse, not individually listed here).
