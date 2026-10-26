# Decisions

Where [DESIGN.md](DESIGN.md) or [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) left a question open, the choice made and why.
Format: task id, question → choice → why.

- **P1.E01.T01** Package names? → workspace packages are `@astra/{shared,client,server,tools}` as the plan writes them; the
  root package keeps the game's current title, `next-horizon`. → The plan names `@astra/shared`; the README's title stays.
- **P1.E01.T01** Where do the plan's `tools/…` and `public/models/` paths live? → `tools/…` means `packages/tools/…`;
  `public/` moved with the client, so exported models go to `packages/client/public/models/`. → The task moves `public/`
  into `packages/client`; one tools package keeps scripts and their dependencies together.
- **P1.E01.T01** Port 5173 can be held by another dev server on the machine. → Vite reads `PORT` and defaults to 5173;
  `.claude/launch.json` sets `autoPort`. → The demo is still served at 5173 when the port is free.
- **P1.E01.T01** The demo's videos (`docs/*.mp4`, 73 MB) → tracked with Git LFS beside `*.blend`. → Keeps clones small.
- **P1.E01.T02** TypeScript version → pinned to 6.0.x. → typescript-eslint 8.72 supports TypeScript below 6.1; 7.x is the
  newest release but cannot be linted yet.
- **P1.E01.T02** How is `@astra/shared` consumed? → its `exports` point at the TypeScript source; Vite, vitest and tsx compile
  it in place, and `tsc` only type-checks. → No build step to keep in sync; the server runs under tsx.
- **P1.E01.T02** Prettier on the demo → enforced on new code and configs; the demo's JavaScript is listed in
  `.prettierignore` until each file is migrated (0.6: "migrates file by file when touched"). → Reformatting 23k lines at
  any width would bury every later diff.
- **P1.E01.T04** Host ports for local Postgres and Redis → 55432 and 56379 (overridable in `.env`). → 5432 and 6379 are
  commonly taken by other local services.
