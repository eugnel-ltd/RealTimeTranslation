# Plan: #5 guarded web release and automatic merge

- Intent: #5, continuing the merged local PR checks from #39.
- Spec: `docs/specs/5-web-release.md`.
- Task type and level: infra-pipeline at level 2; Stop: merge. Release level 3 acts only after genuine enforcement-green evidence and the independent baseline gate.
- Accepted by: root independent plan review of f020c33, 18 October 2026, before implementation.
- Vendor: research lane failure already recorded in #39; root authorised direct continuation without another vendor wait.

## Files that change

- `scripts/pr_evidence.py`: local trusted-comment adapter around unchanged adopted review, head-check and release-evidence helpers. Strict API shape/input validation, per-PR trusted comment files, no inherited comment override.
- `scripts/auto-merge.py`: same-repository/main, expenditure, latest exact-head approval with Stop:nothing, all required checks or trusted cloud fallback; pinned squash merge; explicit `web-release-check.yml` dispatch after any merge, including before reporting a later error.
- `scripts/web-release.py`: clean exact-main preflight, release level/enforcement gate, full first-parent green-ledger evidence walk, unchanged publishing-web baseline gate; explicit cloud apply builds/dry-runs/deploys the exact SHA, verifies authenticated health and rolls back failed health to the captured prior version.
- `.github/workflows/auto-merge.yml`: default-branch workflow_run, trusted comment event, schedule and dispatch entrypoints, existing self-hosted/ai-sdlc runner, no PR checkout/execution.
- `.github/workflows/web-release-check.yml`: default-branch push/dispatch evidence-only check, no install/app execution or Cloudflare credentials on self-hosted runner.
- `worker/src/observability.ts`: health version includes valid DEPLOYMENT_SHA so a release can verify the running merge; package version remains the fallback.
- `tests/observability.test.ts`: update the pre-existing configured-SHA health expectation to the intentional new identity contract; all other existing assertions remain.
- New `tests/test_release_enforcement.py`, `tests/health-release.test.ts`, `tests/test_release_recovery.py`: frozen first-red behavioural proofs; real git commit graphs and executed adapters/helpers with fake API/merge/deploy processes. Recovery tests independently inject transport failure after submission and after healthy deployment. Existing test files remain unchanged.
- `package.json`, `DEPLOY.md`, `docs/code-standards.md`: canonical guarded release/preflight commands and exact remaining live evidence. Existing fixture exemptions, adopted helper bytes, ledger and manifest are unchanged.
- This plan and spec: scope and any reviewed divergence.

## Order of work

1. Commit spec/plan and obtain independent root approval.
2. Commit meaningful failing regression cases first; run test typecheck before freezing TypeScript tests.
3. Implement trusted adapters, workflow wiring and guarded deployment path; preserve unchanged upstream helper hashes and all existing gates.
4. Run all release/enforcement cases, full app tests/typecheck/lint/build and desktop tests. Independently review the exact final head.
5. Root merges. Exercise the fresh live PR/status/merge/evidence route with authenticated GitHub APIs and isolated cloud CI. Only then can a separately reviewed evidence change mark enforcement green. Production apply still requires the unchanged manifest baseline check.

## Risks

- Public comment impersonation: use API author association before parsing; malformed/failing reads refuse.
- Stale review/check/main state: exact-head merge pin, fresh main fetch and exact commit check; evidence is re-read, with no success cache.
- Missing green transition, git failure or direct main push: refuse, never truncate the required chain.
- Publishing incomplete baseline: always execute manifest --publishing web, including first owner-only release; no implicit exclusions.
- Deployment failure: fail before mutating when rollback target or required capabilities are unavailable; captured prior single-version target supports explicit rollback after health failure. No claim of real recovery rehearsal until exercised.
- Runner availability: cloud CI is the authorised fallback for unfinished checks, never a substitute for a completed red result. No paid runner or untrusted app execution is introduced.

## Proof

- Old code: new command tests fail because the release/merge lanes do not exist; deployed health with a configured exact SHA still reports only package version.
- Behavioural fixtures: latest trusted revoke/outsider spoof/fetch failure, wrong head/fork/base/expenditure/stop, red completed check vs unfinished trusted cloud PASS, pinned merge and real dispatch target, apply not reached on refusal, dirty/wrong main/low level/not-green/missing transition, every green commit checked, missing/ambiguous PR or unreviewed transition, baseline missing, successful configured apply and health failure rollback.
- Commands: `python3 -m unittest discover -s tests -p 'test_*enforcement*.py'`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, desktop unittest discovery, existing adopted guard/provenance checks and `git diff --check`.
- Live evidence required under the shared cloud fallback: a fresh post-adoption PR/check invocation, trusted exact-head cloud report, independent exact-head approval, pinned merge/explicit dispatch and guard evidence. Queued/missing runner checks may use that cloud report, never completed red. Actual Mac status-write/revocation observation is useful separate evidence, not a prerequisite imposed beyond the shared contract; local executed regressions prove those failure paths. Actual production health/Sentry/metrics/log/rollback require configured existing Cloudflare/Access capability; disclose missing capability rather than fabricate a pass.

## Divergences

- 18 October 2026: use Python's importable `pr_evidence.py` filename for the shared adapter; behaviour and scope are unchanged.
- 18 October 2026: root approved a fixture-only rebaseline before the replacement first-red commit. The fake provider originally kept returning the newly deployed version after a successful rollback. Only that fake state transition changed; all cases/assertions are unchanged. Original red 2cbe9cf and implementation WIP ccd82a1 remain on `config/5-web-release-original-red`. The replacement branch starts at the accepted plan, repeats old-source red/typecheck, then reapplies the source separately. Production rollback receipt verification is retained.
- 18 October 2026: root approved a second mechanical fixture rebaseline for the independently discovered rollback-ownership P1. The CLI fake now persists real deploy tag/message arguments and returns version.id plus workers/tag and workers/message on the supported version-view read. Prior 1838074/4c36ed7 frozen tests and source7b8cd7e remain on `config/5-web-release-pre-ownership`; no behaviour case is removed. Replacement source is applied only after these provider fixtures are frozen and the real old behaviours reproduced.
- 18 October 2026: add a separate frozen recovery regression before fixing a newly exposed gap: a subprocess transport timeout raised before the existing nonzero-exit reconciliation path, and a health subprocess timeout could skip rollback. Both must preserve read-first/recovery behaviour.
- 18 October 2026: root approved strengthening the recovery fixture's expected provider-read budget from two to three, matching the new mandatory fresh ownership recheck. Original recovery/rollback assertions and cases remain; its command fake now supplies the real version annotation response. This adaptation is frozen before the ownership source repair.
- 18 October 2026: root approved updating the pre-existing configured-SHA health assertion in `tests/observability.test.ts` to `<package-version>+<sha>`. The new frozen health cases retain invalid/missing-SHA fallback proofs unchanged. Root also confirmed the shared cloud fallback can establish real merge/release evidence while Mac jobs are queued; live status-write observation is disclosed separately rather than made an extra gate.
