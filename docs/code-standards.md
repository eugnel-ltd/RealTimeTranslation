# Code standards

Commands, repo-specific hard rules and repo-specific acceptance criteria. Changed by PR. The shared rules and the eight shared acceptance criteria live in the AI-SDLC skill (`SKILL.md` §4 and §5) and are not copied here. Lessons seen on three different days are promoted here. A rule that must always hold names the hook or check that enforces it.

## Commands

Each check is one command that exits non-zero on failure. Record what a healthy run looks like.

- Test: `npm test` (after `npm ci` and `npm --prefix client ci`). Healthy: every discovered test file passes, exit 0 (the count grows with regressions).
- Format: no automatic formatter is configured.
- Lint: `npm run lint`. Healthy: ESLint reports no errors or warnings, exit 0. Checks the client, Worker, shared code, tests and scripts using the installed client toolchain.
- Typecheck: `npm run typecheck`. Healthy: Worker, browser-aware tests, client and Vite configuration compile with no diagnostics, exit 0.
- Enforcement regression checks: `python3 -m unittest discover -s tests -p 'test_enforcement*.py'`. Healthy: all cases pass, including the executable upstream workflow-step, git-fetch and release-evidence tests. Requires Python with PyYAML, git, bash and jq; missing prerequisites fail the check.

The format-lint hook runs Format, then Lint, after each edit; `{file}` in either command stands for the edited file. A missing command switches that check off.
- Build: `npm run build`. Healthy: `verify-bundle: ok (… no secret patterns)`, exit 0.
- Deploy (production): `npm run build && npx wrangler deploy` (`DEPLOY.md`). Dry run first: `npm run deploy:dry`. Healthy: wrangler prints the deployed version id.
- Rollback: `npx wrangler rollback --name rtt`. Last rehearsed: never.
- Health check: `curl -sS --max-time 20 -o /dev/null -w '%{http_code}' https://rtt.eugnel.com/api/health`. Healthy: `302` or `403` (Cloudflare Access stops callers without a session), never `5xx`; with an Access session, `{"ok":true}`.
- Authenticated monitoring: `node scripts/uptime.mjs`. Healthy: exit 0 for the fixed RTT homepage and shared `/api/healthz`, using trusted-runner Access credentials; exit 2 is unconfigured, not a pass. The scheduled workflow stays disabled until `RTT_UPTIME_ENABLED=true` after deployment; live receipt/monitor evidence remains pending (`docs/observability.md`).

## Enforcement in this repo

- Local PR checks are installed in `.github/workflows/ai-sdlc-checks.yml` and the same-repository reusable workflow `ai-sdlc-checks-impl.yml`. This public repo does not call the private skill's reusable workflow. The caller handles PR target events and review-comment creation, edits and deletion; its existing `self-hosted`/`ai-sdlc` runner checks out `main`. Checkers come from `origin/main:.ai-sdlc/`; PR heads are fetched as data and never checked out or executed. Application tests remain in isolated cloud CI, not this self-hosted workflow.
- The local workflow preserves the shared job names and the `ai-sdlc/review-on-head` status context. A missing required base checker fails closed. The adoption must merge before the new workflow can gate a later PR; a local fixture pass is not live runner or GitHub status-write evidence.
- Because this repo is public, the review job passes the unchanged upstream parser only comments whose GitHub API author association is `OWNER`, `MEMBER` or `COLLABORATOR`. Outsider comments cannot approve or revoke the gate. A base/comment fetch or metadata parse failure attempts an error status rather than retaining success. Independent authorship remains a review responsibility; the same account may represent several agents.
- Adopted scripts and the workflow originate from AI-SDLC revision `b217812bca40c0b3d3ff1ba012ed8c4e33ee2636`; `.ai-sdlc/upstream.json` records hashes and the explicit trusted-checkout adaptations. Refresh these assets from upstream rather than editing the adopted scripts locally.
- Cloud CI is available through AI-SDLC `scripts/repo_ci.sh <clone-dir> eugnel-ltd/RealTimeTranslation <pr>` (ai-sdlc #192). Its RTT case runs root/client `npm ci`, `npm test` and `npm run build`.
- The cloud script also checks owner decisions, secrets and the manifest with adopted scripts read from the trusted base, and checks locked tests on `fix/*` branches. Its report starts with `CLOUD-CI: PASS|FAIL` and `Tested head: <sha>`; availability alone is not a passing report. Use the shared AI-SDLC `modules/enforcement.md` cloud fallback rules: a report applies to its exact head, and a PASS never overrides a completed red check.
- The current RTT cloud case omits `npm run typecheck`, `npm run lint` and the Python desktop regressions. PR evidence must also report those checks when relevant; desktop checks use `python3 -m unittest discover -s tests -p 'test_desktop*.py'`.
- Release enforcement remains `not yet green` in `docs/autonomy-ledger.md`. The shared module's Green on GitHub Free requirements still need evidence: checks on every PR, independent exact-head approval and green checks for merges, and release lanes running `release_evidence.sh` over the required reviewed/check-passing commit chain. No autonomy level changes with the availability of a cloud CI case.
- Live evidence is still pending: an authorised runner with the configured labels/tools, successful jobs on a fresh post-adoption PR, actual exact-head status writes, and a review edit/deletion that replaces success with failure or error. Read-only `head_checks.sh` and `release_evidence.sh` helpers are present for that evidence chain; no automatic merge or deployment lane is installed by this change. A web release guard must separately verify the required commit chain before the canonical Worker deployment command. Issue #5 remains open for these steps.
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
