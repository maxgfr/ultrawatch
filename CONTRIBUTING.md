# Contributing to ultrawatch

## Architecture in one minute

A **thin deterministic CLI** (`src/*.ts`, bundled with the vendored webindex engine into a single zero-dep `scripts/ultrawatch.mjs`) plus a **markdown playbook** (`skills/ultrawatch/SKILL.md` + `references/`). The engine reads videos — yt-dlp, subtitles, local whisper, frames — and keeps them as runs; ultrawatch drives it and checks answers; the AI, driven by the playbook, reads, reasons and writes. The bundle ships committed, so `npx skills add` installs a working skill with no dependencies.

- `src/cli.ts` — the commands (`fetch`, `search`, `frames`, `list`, `check`, `doctor`), delegating to the engine.
- `src/check.ts` — the citation gate: every claim cites a `[V# mm:ss]` that lands on something said or shown.
- `src/engine.ts` — the only door to the vendored engine (`src/vendor/`), configured as ultrawatch.

## Prerequisites

- Dev toolchain: Node ≥ 20.19 (vitest 4), pnpm.
- Shipped bundle: Node ≥ 18 (guaranteed by the `runtime-node-floor` CI job).
- For real runs: yt-dlp; ffmpeg and uv for frames and whisper.

## Code changes — TDD first

1. Write or update a vitest test in `tests/` that fails.
2. Make it pass in `src/`.
3. `pnpm run build` rebuilds `scripts/ultrawatch.mjs` and mirrors it into `skills/ultrawatch/scripts/`.
4. `pnpm run check:build` — the committed bundle is reproducible, no engine export is re-declared, the skill installs whole, the pin is sound.
5. `pnpm run eval` — the offline evals over four frozen real videos must stay green.

Commit `src/`, `scripts/ultrawatch.mjs` and `skills/ultrawatch/scripts/ultrawatch.mjs` together — `check:build` fails if they drift. Engine updates follow [ENGINE-MAINTENANCE.md](ENGINE-MAINTENANCE.md).

## Playbook changes

Editing `SKILL.md` or `references/*.md` needs no rebuild, but keep the description ≤ 1000 characters and every reference linked (`verify:bundle` enforces both), and document no flag the CLI does not accept.

## Commits & releases

Conventional Commits drive [semantic-release](https://github.com/semantic-release/semantic-release): `fix:` → patch, `feat:` → minor, `feat!:`/`BREAKING CHANGE:` → major. A push to `main` runs the gate (typecheck / lint / test / `check:build` / evals) and, if green, cuts a GitHub Release and bumps the version across `package.json`, `src/version.ts` and `SKILL.md` in lockstep.

MIT © maxgfr
