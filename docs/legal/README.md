# RTT legal preparation

The application now links generated [privacy](/legal/privacy/), [terms](/legal/terms/), [free-service](/legal/refunds/) and [data-use](/legal/data-use/) pages. The build creates them from reviewed product facts and shared templates. The [inventory](data-inventory.md) and [provider evidence](provider-evidence.md) record their scope for [#9](https://github.com/eugnel-ltd/RealTimeTranslation/issues/9). Source integration is separate from live delivery proof; the baseline stays missing until acceptance is verified.

RTT uses shared code from `eugnel-platform`, company facts from `eugnel-hq`, and the AI-SDLC delivery process. Do not copy a company record or legal renderer into this repository.

The shared templates have no solicitor review. On 18 October 2026, the owner authorised current versions without a solicitor for now. Disclose that status in the policy PR. See the [recorded decision](https://github.com/eugnel-ltd/eugnel-platform/blob/20cab4d756e1c5e71adc54734350d7f0b81f8ee5/docs/owner-decisions.md).

## Build the functional pages

Run `npm run legal:build` or `npm run build`. The legal step reads `product.yaml` and the generated canonical company snapshot, verifies its digest, and renders all required shared facts before writing pages. It adds the product's actual data-use notice instead of publishing generic sample consent controls. Output goes to ignored `client/public/legal/`, then into the client build.

The snapshot's canonical source is `eugnel-hq/company/company.yaml`; its recorded commit and digest are in `legal/company-source.json`. Follow [the source update procedure](provider-evidence.md#build-inputs-and-facts-still-requiring-live-evidence). The current explicit pending ICO application can render as pending, never as registration. Incomplete or unknown states still fail. No expected date promotes status.

Serve the built assets and check `/legal/privacy/`, `/legal/terms/`, `/legal/refunds/` and `/legal/data-use/`, including app navigation, contacts and HTML content types. Keep the current Access boundary. A local route check is not a live deployment check.

## Reproduce the earlier private draft check

1. Read current `product.yaml`, the inventory and canonical `eugnel-hq/company/company.yaml`.
2. Record the commit of all three repositories. Check that each checkout contains the intended reviewed revision.
3. Check that shared templates match the actual product. RTT has no checkout, customer account or account-delete route.
4. Use the shared checkout's installed, locked dependencies. If dependencies are missing, follow its package setup instructions.
5. Set paths to the reviewed checkouts. Create a fresh scratch directory outside assets for publication.

```sh
RTT_ROOT=/path/to/RealTimeTranslation
PLATFORM_ROOT=/path/to/eugnel-platform
HQ_ROOT=/path/to/eugnel-hq
DRAFT_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/rtt-legal.XXXXXX")

node "$PLATFORM_ROOT/packages/legal/bin/render.mjs" \
  --manifest "$RTT_ROOT/product.yaml" \
  --company "$HQ_ROOT/company/company.yaml" \
  --out "$DRAFT_ROOT/pages"
```

Record the renderer's actual exit code and diagnostics. Exit 1 means a read or render error, including missing fields. Exit 2 means bad arguments. Neither is a successful draft. Check that no page files exist after failure.

Keep output outside the client public directory, build assets and any deployment path. Do not replace a missing fact with a guess to obtain exit 0.

## Historical offline check

On 18 October 2026, the existing CLI used these source revisions:

| Input | Revision |
|---|---|
| RTT manifest | `557988c0c490c9ae191eba642f11bd541df752aa` |
| HQ company facts | `3941a3527ef76a808587a3df85148b9a2b6724dd` |
| Shared renderer/templates | `20cab4d756e1c5e71adc54734350d7f0b81f8ee5` |

The shared legal directory had no diff against fetched platform main `bed1507ee7d0dd96edad2d52416be40804136e4b`. The CLI exited 1 and created no output directory:

```text
privacy-policy.md: missing company.ico_registration, legal.data (a non-empty list)
store-privacy-answers.md: missing legal.data (a non-empty list)
```

This historical result predates explicit pending-ICO support and the current data inventory in the manifest. The known privacy email is no longer a missing field. The ICO number remains null. `legal.data` needs supported category, purpose, lawful basis, retention and linked-data facts. The partial row for Sentry does not describe all providers.

These diagnostics do not list every publication gap. The renderer checks required fields, not whether statements match the product or provider contracts.

## Verify the current pages and delivery

1. Resolve inventory gaps with source, configuration or current contract evidence. Do not send private content to providers to test their terms.
2. Add only complete, verified data and provider entries through a separate reviewed manifest change. Do not add fake rows or a fictional registration number.
3. Check free-product payment clauses, account deletion claims, processor roles, international transfers, consent controls and channel scope in every generated page.
4. Set an effective date when the policy set is ready. Re-run the CLI with current canonical facts.
5. Obtain independent review of the exact source and output. Confirm policy links against the actual product through the authorised release process.
6. Keep issue #9 and the legal baseline open until the required facts, pages and delivery checks are complete.

The bounded [shared-template correction](https://github.com/eugnel-ltd/eugnel-platform/pull/45) is merged. It does not complete RTT policies or the legal baseline. It does not establish RTT's provider terms or implement consent controls. Do not publish a consent sheet that promises switches the app lacks. Store answer sheets are not evidence of a store release.

## Requests and retention evidence

Use the canonical privacy contact for data requests. [The inventory](data-inventory.md#existing-controls-and-limits) describes browser controls and their limits. Record whether a request concerns browser history, profile KV, support R2, the forward mailbox or a provider copy.

For server-held data, record the authorised operator action, affected stores and observed result through the existing support process. Include relevant indexes and provider copies in the assessment. Do not claim an account-delete endpoint, automatic expiry or complete erasure where none exists.

A future retention schedule needs matching code or operational controls. A policy sentence alone does not add expiry to browser history, profiles or support records. Keep private content, credentials and the forward destination out of public evidence.
