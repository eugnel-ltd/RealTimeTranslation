# Guard the Worker release path

Issue #5 needs an executable merge and release chain. Local PR checks alone do not prevent an unreviewed main commit from being deployed. The public repository must never execute PR code on its self-hosted runner.

The merge adapter reads PRs, check runs and GitHub-authenticated comment metadata as data. It uses the unchanged adopted review/check parsers. Only trusted comments can approve or revoke a review. A squash merge is pinned to the reviewed head, and explicitly dispatches a local default-branch release-check workflow because a merge using `github.token` does not emit a normal push workflow. Missing/unfinished checks may use the trusted exact-head cloud CI report; a completed red check or latest cloud FAIL always holds.

The web release command defaults to preflight. It requires a clean checkout at current origin/main, a level-3 release ledger whose enforcement line actually reads green, and passing evidence for every first-parent commit in the uninterrupted green-ledger run, including the transition commit. It reads each commit's ledger and fails closed on git/API errors. It supplies trusted comment bodies to unchanged `release_evidence.sh` separately for each merge. It always runs the unchanged manifest publishing-web gate; it creates no waiver and promotes no ledger.

Only an explicit apply in an isolated cloud session can build or deploy. Before deployment it requires configured Cloudflare and Access capabilities, runs the dry deployment, captures the previous active single-version deployment, then deploys with the exact reviewed merge SHA in `DEPLOYMENT_SHA`. Authenticated health must verify that SHA. Failed deployment/health is a failure, with an explicit rollback to the captured previous version after a new deployment. The release report carries safe deployment/version identifiers; it never includes credentials or provider bodies. The operator separately records the five-minute log check and incident/release metadata before claiming release completion.

Recovery attributes an active version using its exact version id, unique attempt tag and source-SHA message from Cloudflare before mutation. A fresh identity read immediately before rollback/health claims stops on an intervening deployment. An unowned/unreadable deployment remains UNKNOWN. Cloudflare does not supply atomic compare-and-swap rollback; operators coordinate the residual read/write interval.

The self-hosted release-check workflow performs GitHub/git evidence checks only. It has no Cloudflare credentials and runs no app tests, dependency installation or deployment. Baseline acceptance and post-deploy operational acceptance are separate facts: evidence can establish enforcement without pretending an incomplete production baseline is ready.

No visual changes, provider-key rotation, paid Actions, new Cloudflare products, synthetic fixture changes or automatic baseline/status promotion are in scope.
