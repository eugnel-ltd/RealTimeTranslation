# RTT legal delivery and evidence

The legal artifact baseline is complete. The application links generated [privacy](/legal/privacy/), [terms](/legal/terms/), [free-service](/legal/refunds/) and [data-use](/legal/data-use/) pages, built from reviewed product facts and shared templates. Current local page, privacy-answer and consent acceptance is recorded below. The [inventory](data-inventory.md) and [provider evidence](provider-evidence.md) retain the operational requirements for provider eligibility, account activation and release. Local artifact acceptance does not establish protected remote delivery.

RTT uses shared code from `eugnel-platform`, company facts from `eugnel-hq`, and the AI-SDLC delivery process. Do not copy a company record or legal renderer into this repository.

The shared templates have no solicitor review. On 18 October 2026, the owner authorised current versions without a solicitor for now. Disclose that status in the policy PR. See the [recorded decision](https://github.com/eugnel-ltd/eugnel-platform/blob/20cab4d756e1c5e71adc54734350d7f0b81f8ee5/docs/owner-decisions.md).

## Build the functional pages

Run `npm run legal:build` or `npm run build`. The legal step reads `product.yaml` and the generated canonical company snapshot, verifies its digest, and renders all required shared facts before writing pages. It adds the product's actual data-use notice instead of publishing generic sample consent controls. Output goes to ignored `client/public/legal/` and `client/public/company/`, then into the client build.

The snapshot's canonical source is `eugnel-hq/company/company.yaml`; its recorded commit and digest are in `legal/company-source.json`. Follow [the source update procedure](provider-evidence.md#build-inputs-and-facts-still-requiring-live-evidence). The snapshot records issued ICO registration when present; incomplete or unknown states still fail. No expected date promotes status.

Serve the built assets and check `/company/`, `/legal/privacy/`, `/legal/terms/`, `/legal/refunds/` and `/legal/data-use/`, including app navigation, contacts and HTML content types. The minimal app footer links only to `/company/`, which links to all four policies; check this navigation from both the app and account bootstrap. Keep the current Access boundary. A local route check is not a live deployment check.

## Reproduce the earlier private draft check

1. Read current `product.yaml`, the inventory and canonical `eugnel-hq/company/company.yaml`.
2. Record the commit of all three repositories. Check that each checkout contains the intended reviewed revision.
3. Check that shared templates match the actual product. RTT has no checkout. Account controls are implemented but disabled in the current private service; keep capability notices conditional and verify the actual mode before publishing.
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
6. Complete the legal baseline after the current facts, pages, channel privacy answers and actual consent controls pass independent acceptance. Record protected remote delivery in the release evidence. Account callbacks, migrations and maintenance remain account activation checks.

The bounded [shared-template correction](https://github.com/eugnel-ltd/eugnel-platform/pull/45) is merged. That change alone did not deliver RTT policies or consent controls; the subsequent RTT implementation and current acceptance below complete those artifacts. Provider project settings require their own evidence. Do not publish a generic consent sheet that promises switches the app lacks. Store answer sheets are not evidence of a store release.

## Completed legal artifacts: 18 October 2026

The baseline definition is AI-SDLC `modules/baseline.md`: policies, channel privacy answers and consent where required. Exact current source `470ed87e6a036387391f6fce60caaec582e97a42` passed a fresh build and real local Chromium acceptance with synthetic isolated browser data. No provider, microphone, credential, real user data or live service was used. The read-only account bootstrap fixture explicitly selected the existing owner mode, `{enabled:false}`; external requests, API writes and redirects were refused.

The browser verified nine acceptance checks: history saving defaults off without a positive choice; explicit opt-in persists across reload; two failed withdrawal saves keep Settings open, show the error and preserve durable bytes; successful retry persists withdrawal across reload; existing history and notes remain. All four actual built routes returned 200 HTML, linked to each other and the app, exposed the known contacts and contained no scripts. Privacy retained pending application C2062045 without an invented registration number; the free-service page made no paid-checkout claim.

| Built route | SHA-256 |
|---|---|
| `/legal/privacy/` | `519567c65bd997b19b1a76af5743bfccf8cab202b2849a7ba497fe551e366545` |
| `/legal/terms/` | `612891f27a4f50a7f57dfa5e8296d23860e823b576eb9c09bb964a94e3e470bb` |
| `/legal/refunds/` | `18c53edc8fb92cd5635a8eacf182cfeb6131b5d0c4fe40fe91a206a898d83443` |
| `/legal/data-use/` | `207a92e5b5a5276206de2bce6f363fcc0c59d2338c999624e4fda9e8edeb2358` |

The installed shared renderer also successfully rendered `store-privacy-answers.md` from the same manifest and canonical company snapshot into scratch output. Its eleven categories preserve current versus conditional processing, no tracking and the real deletion contact `hello@eugnel.com`. RTT currently declares only the web channel; there is no App Store or Play listing/form to submit. These are supported source answers for the current channel, not a store submission or new store claim. The generic consent sheet is not published; actual web controls and the data-use page describe the available choices.

Reproduce the artifact checks with `npm run build`, the existing legal/history regression suites, and a loopback server for `client/dist`. Use an isolated browser context and synthetic settings/history to exercise the sequence above. The shared CLI accepts `--manifest product.yaml --company legal/company.snapshot.yaml --out <scratch-directory>` at `node_modules/eugnel-platform/packages/legal/bin/render.mjs`; keep its generic sheets out of publishable assets. Preserve the original frozen tests. The baseline completion changes no policy, renderer, application, consent or visual behavior.

## Requests and retention evidence

Use the canonical privacy contact for data requests. [The inventory](data-inventory.md#existing-controls-and-limits) describes browser controls and their limits. Record whether a request concerns browser history, profile KV, support R2, the forward mailbox or a provider copy.

For server-held data, record the authorised operator action, affected stores and observed result through the existing support process. In customer mode distinguish the verified account's coordinated erasure from owner KV, support records, provider copies and backups. Pending retries are not completed erasure. Include relevant indexes and provider copies in the assessment. Do not promise automatic expiry or complete erasure where none exists.

A future retention schedule needs matching code or operational controls. A policy sentence alone does not add expiry to browser history, profiles or support records. Keep private content, credentials and the forward destination out of public evidence.

## Account notice acceptance

The [account inventory](data-inventory.md#conditional-account-processing) cites the audited shared source and RTT consumer. Rendered-page regressions cover conditional availability, provider notices, credential validity versus physical cleanup, retryable deletion and limited browser cache removal. Preserve the existing history opt-in, buffered-audio disclosure and all seven original legal/history test files.

Account activation still requires a separate protected preview and the reviewed release process: actual Access/Apple callbacks, provider setup, database migrations and two-account/device signup/signin/link/signout/delete/retry. Confirm sender previews, database jurisdiction/backup plan and bounded maintenance receipts. Record exact source, deployment/version and nonsecret results under the account acceptance work; `baseline.accounts` remains missing.

The release must verify the four protected remote routes and pre-sign-in links against its exact deployed build. Google-enabled UK use still requires direct evidence of the active Gemini project's billing eligibility; public terms or a working key do not establish it. The inventory's actual provider/resource/retention checks remain requirements where those services are used or enabled. Legal artifact completion does not attest to any of those settings, change Access, activate accounts, approve expenditure or waive the separate publishing gate. The product stays `building` until the full release requirements pass.
