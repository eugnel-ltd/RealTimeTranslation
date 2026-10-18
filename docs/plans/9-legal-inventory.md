# Plan: #9 legal data inventory and draft runbook

- Intent: Refs #9. This preparation does not close the legal baseline issue.
- Spec: None. This is a bounded documentation change.
- Task type and level: `docs` at level 2. Parent owns review, PR and merge.
- Accepted by: orchestrator, for loop B in the source-backed legal preparation plan, 18 October 2026.
- Revenue impact: record current data flows so later policies can match the free web product.
- Expenditure: none.

## Files that change

- `docs/legal/data-inventory.md`: source-backed web data flows, retention controls, desktop scope and gaps.
- `docs/legal/README.md`: private draft steps that use the shared renderer and canonical HQ facts.
- `readme.md`: one link to the legal preparation documents.
- This plan records scope and proof before the documentation change.

## Order of work

1. Read current source and the canonical HQ company record. Record the source revisions.
2. Write the inventory without claims about unknown provider contracts, regions, retention or lawful bases.
3. Align notes retention with the parallel notes fix before the final commit.
4. Run the existing legal CLI in scratch with the real manifest and company record.
5. Check the actual failure, absent output, links, wording, unchanged manifest and diff.
6. Commit the docs for independent review. Do not publish pages or deploy.

The research vendor lane timed out after 20 seconds and exited 1. No vendor was ready.
The parent authorises direct fallback from that recorded attempt. No repeat wait is needed.

## Risks

- A source path proves a possible data flow, not the live provider tier or contract.
- A desired retention period is not a current deletion control. Mark unknowns explicitly.
- A source endpoint or region variable does not prove all processing stays in that region.
- Clear Transcripts preserves saved history. Support forwarding can retain original attachments.
- The notes fix changes persistence separately. Confirm its final behaviour before the docs commit.
- Do not copy a second canonical company record, invent a ZB number, or mark the legal baseline ready.
- The shared templates need separate correction. A successful render alone cannot establish truthful policies.

## Proof

- No runtime, configuration, dependency, policy publication or baseline-state change.
- No regression test: the change adds evidence and draft instructions only.
- Existing renderer uses current `product.yaml` and HQ `company/company.yaml` in scratch.
- Record its non-zero exit and missing fields. Check no policy files exist after failure.
- Check relative links, source references, writing score, secret patterns and `git diff --check`.
- Compare `product.yaml` and all runtime paths against the base revision.
- Parent performs independent review against the exact final head.

## Divergences

- None.
