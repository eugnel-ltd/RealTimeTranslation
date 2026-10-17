# Code standards

Commands, repo-specific hard rules and repo-specific acceptance criteria. Changed by PR. The shared rules and the eight shared acceptance criteria live in the AI-SDLC skill (`SKILL.md` §4 and §5) and are not copied here. Lessons seen on three different days are promoted here. A rule that must always hold names the hook or check that enforces it.

## Commands

Each check is one command that exits non-zero on failure. Record what a healthy run looks like.

- Test: `npm test` (after `npm ci` and `npm --prefix client ci`). Healthy: "Test Files 17 passed", exit 0.
- Format: `<command>`. Healthy: `<...>`
- Lint: `<command>`. Healthy: `<...>`

The format-lint hook runs Format, then Lint, after each edit; `{file}` in either command stands for the edited file. Leave the placeholder to switch it off.
- Build: `npm run build`. Healthy: `verify-bundle: ok (… no secret patterns)`, exit 0.
- Deploy (production): `npm run build && npx wrangler deploy` (`DEPLOY.md`). Dry run first: `npm run deploy:dry`. Healthy: wrangler prints the deployed version id.
- Rollback: `npx wrangler rollback --name rtt`. Last rehearsed: never.
- Health check: `curl -sS --max-time 20 -o /dev/null -w '%{http_code}' https://rtt.eugnel.com/api/health`. Healthy: `302` or `403` (Cloudflare Access stops callers without a session), never `5xx`; with an Access session, `{"ok":true}`.

## Enforcement in this repo

- AI-SDLC checks: pending (public repo; see `AGENTS.md`).
- Hooks: `.claude/hooks/guard-edits.sh`, `.claude/hooks/spend-gate.sh`, `.claude/hooks/plan-gate.sh`, `.claude/hooks/format-lint.sh`; spend patterns in `.claude/hooks/spend-patterns.txt`.
- Secret scan beyond the sample patterns: `scripts/verify-bundle.mjs` checks the client bundle for key patterns.

## Repo-specific hard rules

1. No provider key in the client: keys are Worker secrets; the browser gets short-lived tokens (`/api/speech-token`, `/api/gemini-token`). Enforced by: `scripts/verify-bundle.mjs` in `npm run build`.
2. Every `/api/*` route sits behind Cloudflare Access (`worker/src/access.ts`); `SKIP_ACCESS_CHECK` stays `false` in `wrangler.jsonc`. Enforced by: `tests/access.test.ts`.
3. Cloudflare cost guard (company rule): no new bindings, crons or paid Cloudflare products without a spend proposal. Enforced by: review only.

## Repo-specific acceptance criteria

1. A change to an `/api/*` route keeps the Access check in front of it.

## This machine

Runner and host facts an agent needs (paths, known hangs, wrappers). Keep them here, not in the rules.

- No runner-specific facts yet.
