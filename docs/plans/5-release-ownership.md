# Plan: #5 attribute the release before recovery

- Intent: #5; fix the independent P1 finding on 7b8cd7e.
- Task type and level: infra-pipeline, level 2, Stop: merge.
- Accepted by: desktop independent plan review of 4f2a6fa, 18 October 2026, before the source change. The same new ownership test bytes were retained at replacement commit 4791c61.

## Bounded change

Only `scripts/web-release.py`, its plan/spec/docs, replacement fake-provider metadata fixtures, and new `tests/test_release_ownership.py` change. Root approved the mechanical fixture rebaseline; old histories/frozen files remain on a separate preserved branch and every existing assertion/case remains.

Wrangler's installed CLI help confirms `deploy --tag/--message` and `versions view <version-id> --name rtt --json`. Each real submission receives a unique `rtt-<uuid>` version tag and exact `RTT source <sha>` message. Read the active version's actual `annotations[workers/tag]` and `annotations[workers/message]`; both must match this attempt before a changed active deployment can be attributed. Missing/unreadable/different metadata is UNKNOWN, with no mutation. The source SHA alone cannot establish attempt ownership.

After successful deployment, store its proved active deployment/version identity. Before any rollback, freshly read active identity and require it still equals this owned deployment/version; otherwise stop UNKNOWN rather than undo an intervening release. Re-read identity before claiming HEALTH_VERIFIED too. Rollback still verifies that the captured prior version is active afterward. There is no claim that Cloudflare offers an atomic compare-and-swap rollback; this bounds the existing provider contract without pretending to control other operators.

## Proof and order

1. Preserve 7b8cd7e and its frozen tests on a separate branch. Rebuild replacement history from accepted plan with fixture-only support for actual version annotations before freezing its first-red tests; no assertion changes.
2. Run the new ownership tests on actual faulty 7b8cd7e code: failed/no-write submission with unrelated active change, same-source different attempt, intervening release before failed-health rollback, and intervening release before success claim all fail for the concrete unsafe action/claim. Freeze these tests before implementing ownership.
3. Implement the bounded source fix only after independent plan approval; retain every newly frozen byte.
4. Run all release/enforcement/recovery/ownership cases, app tests, types, lint and build; independent reviewer re-reviews only the fix diff. Actual Cloudflare attribution/rollback still needs secure live capability and protected-target rehearsal, disclosed separately.

## Rebaseline evidence

Replacement first-red CLI/health fixtures are frozen at c76bb36; recovery fixtures at 7b6a236. The only existing assertion adaptation is the root-approved read budget of three instead of two, strengthening the required fresh ownership observation; recovery/rollback outcomes are unchanged. Ownership tests 4791c61 are byte-identical to 4f2a6fa and reproduce three unsafe rollback paths plus the false healthy claim on actual faulty source (3 errors, 1 failure), not an invalid fixture response. Prior original/red histories remain on the two preserved branches named in the main plan.
