# Code standards

Commands, repo-specific hard rules and repo-specific acceptance criteria. Changed by PR. The shared rules and the eight shared acceptance criteria live in the AI-SDLC skill (`SKILL.md` §4 and §5) and are not copied here. Lessons seen on three different days are promoted here. A rule that must always hold names the hook or check that enforces it.

## Commands

Each check is one command that exits non-zero on failure. Record what a healthy run looks like.

- Test: `npm test` (after `npm ci` and `npm --prefix client ci`). Healthy: every discovered test file passes, exit 0 (the count grows with regressions).
- Format: no automatic formatter is configured.
- Lint: `npm run lint`. Healthy: ESLint reports no errors or warnings, exit 0. Checks the client, Worker, shared code, tests and scripts using the installed client toolchain.
- Typecheck: `npm run typecheck`. Healthy: Worker, browser-aware tests, client and Vite configuration compile with no diagnostics, exit 0.
- Enforcement regression checks: `python3 -m unittest discover -s tests -p 'test_enforcement*.py'`. Healthy: all cases pass, including the executable upstream release-evidence test. Requires Python with PyYAML, git, bash and jq; missing prerequisites fail the check.

The format-lint hook runs Format, then Lint, after each edit; `{file}` in either command stands for the edited file. A missing command switches that check off.
- Build: `npm run build`. Healthy: `verify-bundle: ok (… no secret patterns)`, exit 0.
- Release preflight: `npm run release -- <exact-main-sha>`. Healthy: exact-main reviewed green-chain evidence and `manifest_check.py product.yaml --publishing web` both pass, exit 0; no provider mutation. A missing baseline or not-green ledger is a hold.
- Deploy (production, isolated cloud only): `npm run release -- <exact-main-sha> --apply` (`DEPLOY.md`). The guard repeats preflight, builds and dry-runs before deploying with `DEPLOYMENT_SHA`. Healthy: authenticated health verifies the exact running SHA and reports the Cloudflare deployment/version identifiers. Complete the five-minute error-log check before recording a release. Do not run the underlying unguarded Wrangler deploy command as the production release lane.
- Rollback: `npx wrangler rollback --name rtt`. Last rehearsed: never.
- Release health: authenticated homepage 200 and `/api/healthz` with version `<package-version>+<exact-main-sha>`, checked by the guarded release command. An unauthenticated 302/403 proves Access enforcement only; it is not application health.
- Authenticated monitoring: `node scripts/uptime.mjs`. Healthy: exit 0 for the fixed RTT homepage and shared `/api/healthz`, using trusted-runner Access credentials; exit 2 is unconfigured, not a pass. The scheduled workflow stays disabled until `RTT_UPTIME_ENABLED=true` after deployment; live receipt/monitor evidence remains pending (`docs/observability.md`).

## Enforcement in this repo

- PR checks run from `.github/workflows/ai-sdlc-checks.yml`, a thin caller of the public loader `eugnel-ltd/ai-sdlc-loader/.github/workflows/checks.yml@v3` (ai-sdlc #731). The loader fetches the signed gate bundle through OIDC with no PAT. It runs every job on GitHub-hosted runners for this public repo. PR heads are read as data and never executed. The `.ai-sdlc/` scripts remain only for `scripts/pr_evidence.py`, `scripts/auto-merge.py` and `scripts/web-release.py`. Application tests stay in isolated cloud CI.
- The loader keeps the shared job names and the `ai-sdlc/review-on-head` status context. Its review gate trusts a reviewer by live write access to this repo (ai-sdlc #783), so outsider comments cannot approve or revoke.
- The `.ai-sdlc/` scripts and `tests/ai-sdlc-upstream/test_release_evidence.sh` originate from AI-SDLC revision `b217812bca40c0b3d3ff1ba012ed8c4e33ee2636`, recorded with hashes in `.ai-sdlc/upstream.json`. Refresh them from upstream rather than editing them locally.
- Cloud CI is available through AI-SDLC `scripts/repo_ci.sh <clone-dir> eugnel-ltd/RealTimeTranslation <pr>` (ai-sdlc #192). Its RTT case runs root/client `npm ci`, `npm test` and `npm run build`.
- The cloud script also checks owner decisions, secrets and the manifest with adopted scripts read from the trusted base, and checks locked tests on `fix/*` branches. Its report starts with `CLOUD-CI: PASS|FAIL` and `Tested head: <sha>`; availability alone is not a passing report. Use the shared AI-SDLC `modules/enforcement.md` cloud fallback rules: a report applies to its exact head, and a PASS never overrides a completed red check.
- The current RTT cloud case omits `npm run typecheck`, `npm run lint` and the Python desktop regressions. PR evidence must also report those checks when relevant; desktop checks use `python3 -m unittest discover -s tests -p 'test_desktop*.py'`.
- `scripts/auto-merge.py` applies the upstream merge rule using the unchanged adopted parsers, trusted API comment metadata and fixed required contexts (the five local non-review check names plus `test`). It refuses forks, a base other than main, undeclared expenditure, a latest trusted review without exact-head APPROVE/Stop:nothing/matching expenditure, and completed red checks. A trusted exact-head cloud PASS may cover missing/unfinished checks. Squash merge is pinned with `--match-head-commit`; any successful merge explicitly dispatches the local deploy-free `web-release-check.yml`, including when a later PR read fails. `auto-merge.yml` is default-branch API-only orchestration on the existing self-hosted/ai-sdlc runner.
- `scripts/web-release.py` walks every first-parent commit whose ledger is green, including the transition commit, and calls unchanged `release_evidence.sh` with separately fetched trusted review comments for each merge. No cache can hide later revocation. Closed merged-PR mapping must be unique, target main and match the merge SHA. The full release path also requires clean exact current-main checkout, release level 3 and the unchanged publishing-web baseline gate. `--evidence-only` omits publishing/deployment and explicitly does not establish baseline or deployment acceptance.
- The automatic self-hosted workflow never installs dependencies, builds or executes PR app code, holds Cloudflare secrets or deploys. Actual apply runs in isolated cloud and refuses `GITHUB_ACTIONS=true`; dependency installation uses the reviewed lockfiles in that cloud environment. It requires existing Cloudflare/Access capabilities, records the previous single-version deployment, performs exact-SHA health and verifies the captured version after rollback. A lost deployment response is reconciled with provider state before choosing a rollback; unreadable state is UNKNOWN.
- Enforcement is `green since 2026-10-18` in `docs/autonomy-ledger.md`, using the actual exact-head cloud PASS, independent approval and pinned merge recorded in `docs/enforcement-evidence.md`. Local PR check invocation39114727200 and merged web-evidence push invocation39114939668 were observed for #45; queued/missing runner checks use the shared cloud fallback, never completed red. Actual Mac status-write/revocation observation is disclosed separately, not made an extra prerequisite. The green transition itself follows canonical exact-head CI/review/merge, and the issue #5 closure records the full installed guard walk including that transition. No task level or publishing baseline changes with this status.
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
