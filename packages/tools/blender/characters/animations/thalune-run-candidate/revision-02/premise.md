Premise tested: the terminal proof/result.json path remains writable when earlier writes in the same proof namespace fail, so saving there is enough to deliver registered in-memory evidence.

The exact R2 combined-adverse.py disproves this on 4c92a6f6fe11dc687b80b45ada324f23f61c0f8a: four proof-fallback cases escape with TERMINAL_PROOF_WRITE_FAILURE before the available independent packet sink is attempted. The original error/raw audits remain only on an internal handle.

Correction contract: each terminal sink is attempted at most once under its existing bound; one sink failure cannot skip the other. The dispatcher returns complete memory evidence with separate delivery errors/qualification. The CLI emits it, falling back from stdout to stderr once; if both streams fail it raises a structured exception carrying the result. No new job, service, storage allowance, retry loop, or runtime authorization.
