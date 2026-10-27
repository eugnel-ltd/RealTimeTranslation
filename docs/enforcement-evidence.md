# RTT enforcement evidence

The enforcement transition uses the owner's documented cloud CI fallback. Release remains at its existing level 3, with the separate publishing baseline and guarded production command. No task level, baseline value or owner decision changes here.

## Installed gates and real merge

Local trusted-base PR checks merged in [#39](https://github.com/eugnel-ltd/RealTimeTranslation/pull/39). They read PR commits as git data and use only trusted main checker code. Public review comments are filtered using GitHub API OWNER/MEMBER/COLLABORATOR metadata. The source does not execute PR app code on the persistent runner.

The guarded merge and web release lane merged in [#45](https://github.com/eugnel-ltd/RealTimeTranslation/pull/45):

| Fact | Actual record |
|---|---|
| Independently reviewed and tested head | `7bcbf089510ef4da87ec16e9b2db29ce34cd5e66` |
| Canonical cloud report | [CLOUD-CI: PASS](https://github.com/eugnel-ltd/RealTimeTranslation/pull/45#issuecomment-6248162652), GitHub MEMBER metadata, exact tested head |
| Independent review | [APPROVE](https://github.com/eugnel-ltd/RealTimeTranslation/pull/45#issuecomment-6248170295), GitHub MEMBER metadata, exact reviewed head, Stop:nothing and Expenditure:none |
| Pinned squash merge | `234ca259529e44250d2fe57bb9afd650ac695cfb`, merged 18 October 2026 at 09:20:22 UTC |
| Fresh local PR check invocation | [39114727200](https://github.com/eugnel-ltd/RealTimeTranslation/actions/runs/39114727200), pull_request_target, exact PR head |
| Local web evidence event after merge | [39114939668](https://github.com/eugnel-ltd/RealTimeTranslation/actions/runs/39114939668), push, exact merge SHA |

The two observed workflow invocations were queued. They prove that the installed local workflow files resolve and receive the actual events; they do not prove completed runner jobs or GitHub status writes. Managed runner inventory was unavailable, so no claim is made that the Mac is offline.

The unchanged upstream rule permits the trusted exact-head cloud PASS to cover missing or unfinished check runs. It never covers a completed red check, and a latest trusted cloud FAIL holds even otherwise green runs. The actual #45 API records contained two complete comments and one queued resolver check; no completed red check was hidden or substituted.

## Executed evidence and provenance

Before changing the ledger, the installed `pr_evidence.check_merge` adapter and unchanged adopted `release_evidence.sh`, `review_on_head.sh` and `head_checks.sh` were executed against fresh authenticated GitHub connector responses for #45. They exited 0:

```text
EVIDENCE OK 234ca259529e44250d2fe57bb9afd650ac695cfb: #45 head 7bcbf089510ef4da87ec16e9b2db29ce34cd5e66
```

This was offline parser execution on actual API snapshots captured from 18 October 2026 at 09:20:29 UTC onward, with git objects fetched from origin. Shell `gh api` access remained unavailable. No fake API, invented approval, synthetic online result or production snapshot override was used. The scratch adapter accepted only exact recorded GET endpoints, verified their SHA256 digests and refused writes or missing endpoints.

Source GET records:

- [PR #45](https://api.github.com/repos/eugnel-ltd/RealTimeTranslation/pulls/45).
- [Complete PR comments](https://api.github.com/repos/eugnel-ltd/RealTimeTranslation/issues/45/comments?per_page=100), fewer than one full page.
- [Merge-to-PR mapping](https://api.github.com/repos/eugnel-ltd/RealTimeTranslation/commits/234ca259529e44250d2fe57bb9afd650ac695cfb/pulls).
- [Exact-head check runs](https://api.github.com/repos/eugnel-ltd/RealTimeTranslation/commits/7bcbf089510ef4da87ec16e9b2db29ce34cd5e66/check-runs?per_page=100), total_count matched the returned count.

The captured endpoint/page/file digest manifest has SHA256 `153283a33b0206d02b08614de18093b36744d0c615389125fa3e56699bac3084`. The verifier retains the raw records, capture window and proof log in the task's scratch evidence. Current API comments/checks must be reread for a later release; this snapshot is not a cached approval.

The PR introducing the green ledger follows the same exact-head cloud CI, independent approval and pinned-merge rule. Its GitHub report and review carry its own head identity; embedding that SHA in its own files would change it. After merge, the verifier runs the installed `scripts/web-release.py <exact-main-sha> --evidence-only` over the complete first-parent green run, including the transition commit. A direct/unreviewed commit, missing or ambiguous merged-PR mapping, later trusted revocation, latest cloud FAIL, completed red check or git/API error stops the guard. The issue #5 closure records that actual full-walk result.

## Regression and security proof

At the approved #45 head, 361 app cases, 59 Python cases, typecheck, lint, build/bundle scan and adopted owner/secret/manifest/Cloudflare guards passed. The independent reviewer approved the final source and the version-attributed recovery fix. Frozen regressions exercise trusted versus outsider comments, review revocation, failed base/comment reads, missing evidence, every green commit including its transition, baseline refusal, and lost/concurrent deployment recovery.

Recovery validates actual version.id, a unique per-attempt `workers/tag` and exact source `workers/message`, then freshly checks active identity before rollback or a healthy claim. An intervening, unreadable or unattributed deployment is UNKNOWN and is never undone. Cloudflare offers no atomic compare-and-swap rollback; operators still coordinate the residual read/write interval. Real provider recovery rehearsal remains separately required before the first level-3 release.

The historical synthetic token marker in `tests/speech-token.test.ts` is unchanged from `0a248a0`. No fixture exemption or bypass was added. The unchanged upstream secret guard scans added PR lines; its pass does not claim a full historical scan.

Azure regeneration is recorded as a completed owner operation, independently read through GitHub API metadata: [fol2/MEMBER's 17 October 2026 23:49:12 UTC attestation](https://github.com/eugnel-ltd/ai-sdlc/issues/178#issuecomment-6243334539) says Azure Speech is F0 and its keys were regenerated by Grok Bot. The existing #5 relay dates the Worker secret update to 17 October at 23:41. No agent rotated keys or read credential values, and provider-portal revocation was not directly queried. The removed historical development TLS key is treated as public and is not a live production certificate.

## Production acceptance stays separate

`--evidence-only` never deploys or certifies a baseline. The normal preflight still runs unchanged `manifest_check.py product.yaml --publishing web`; any required missing baseline item refuses apply. No waiver, exclusion or baseline promotion was introduced by this transition.

The self-hosted workflows have no Cloudflare credentials and do not build/deploy or execute PR app code. Actual apply requires an isolated configured cloud session, exact current main, the full reviewed chain and the publishing baseline. A successful event dispatch or evidence walk is not deployed acceptance. Actual deployment identity, authenticated health, five-minute logs, recovery rehearsal, Sentry/monitor/support/identity acceptance remain in their separate product work; closing #5 claims none of them.

## Remediation of #64 (a2acf10)

#64 merged as `a2acf10e1f27de66d9efb9adda6e2fe97f6d1864` on 23 October 2026 and moved four workflows (`ai-sdlc-checks.yml`, `auto-merge.yml`, `uptime.yml`, `web-release-check.yml`) from the self-hosted runner to GitHub-hosted `ubuntu-latest`.
It also changed the auto-merge cron from every 30 minutes to every 2 hours, with James's approval in eugnel-ltd/ai-sdlc#483.
AI-SDLC `release_evidence.sh` holds the commit because no independent APPROVE names its final head `eb2d8a960bad36705389c97a36c2e880c8e7bbd4`.
Cloud CI on that head reported FAIL because `tests/uptime-workflow.test.ts` still expected `self-hosted`.
#66 (merge `91a105769d9361a59fdc93ef9cd48531a3a2359f`) fixed that test, and cloud CI reported PASS on its head `3d2eb80e1fe9e025adf02b22fc610b44508cd37a`.
This PR provides independent review of #64's change: reviewers read `git diff a2acf10^ a2acf10` and, if they accept it, include `Remediates: a2acf10e1f27de66d9efb9adda6e2fe97f6d1864` in their APPROVE.
AI-SDLC `scripts/release_remediation.sh` then accepts the held commit, as specified in AI-SDLC `modules/enforcement.md`.
