# Plan: account policy facts and notices (#9, #8)

- Intent: RTT #9 legal delivery; coordinates RTT #8 accounts before activation.
- Spec: the approved shared identity spec `docs/specs/rtt-8-identity.md` in the platform source and the final RTT account implementation. This slice changes no auth behavior.
- Task type and level: config/docs at level2. No expenditure, new service, deployment or visual work.
- Accepted by: root independent review of commit `be1ca90` on18October2026. No owner or solicitor gate. Audit the stable shared and RTT heads before freezing content tests or changing source.

## Files that change

- `product.yaml`: extend legal data/provider facts for available account sign-in, security cookies, customer profiles, email delivery, Turnstile and bounded deletion. Keep the actual deployment private, building and customer accounts disabled until live activation proves otherwise. Do not claim an active account database just because code exists.
- `legal/data-use.md`: preserve local-history consent and provider buffering copy. Explain account controls only when available; distinguish cookie/proof validity from physical record cleanup; describe retryable deletion and retained minimal security records. Use plain user-facing language, not internal SQL/transport details.
- `scripts/generate-legal.mjs`: add fixed official identity/Turnstile/provider notice links using the existing safe renderer. No new policy framework, renderer grammar, raw HTML or custom active links.
- `docs/legal/data-inventory.md`, `docs/legal/provider-evidence.md` and `docs/legal/README.md`: separate implemented-but-disabled source capability from the current owner-only live mode. Record actual stable source revisions, live checks and remaining configuration facts.
- `docs/observability.md`: replace its obsolete literal shared dependency pin with a reference to the immutable reviewed package/lock revision. Leave the historical plan10 pin unchanged. No telemetry/runtime change.
- `tests/account-legal-pages.test.ts`: new rendered-page regressions. Preserve all existing tests and the original frozen history/legal files.
- `docs/plans/9-account-policy.md`: update accepted review and final source evidence before implementation.

## Order of work

1. Reuse the earlier bounded failed legal vendor lanes and approved direct fallback in plan9-functional. Research current primary provider notices with available official-page reads; no provider call, key retrieval or real mail send.
2. Record the stable shared identity and RTT consumer heads. Read their actual sign-in scopes, cookie attributes, data tables, cleanup/deletion paths, browser controls and disabled/active configuration. Integrate the merged account source before final proof.
3. Obtain root plan acceptance. Add first-red rendered-page cases before content/link changes. Confirm failures name missing truthful disclosures, not absent dependencies or broken fixtures. Run type/lint and trusted secret checks before freezing; keep old test artifacts untouched.
4. Update the listed source/config/docs only. Prefer conditional factual copy for sign-in controls that may be disabled. Keep free/private Access, pending ICO C2062045, canonical HQ snapshot authority and existing received-final-result history contract.
5. Run rendered-page and existing legal/history tests, full tests, typecheck, lint, build, manifest, frozen-file, writing and secret checks. Inspect all four generated pages and fixed links. Root independently reviews the exact final head; no publication claim from local proof.
6. Use the live acceptance packet with the final reviewed release build after normal authorised deployment. Keep legal/account baselines missing until their real acceptance checks pass. Current missing runtime/network capabilities are an actual execution limit, not an extra owner approval gate.

## Evidence and factual boundaries

The source audit and official URLs are staged in the session packet `live-acceptance/legal/account-policy-facts.md`. Final repository docs must use durable source references and public links, not that workspace path.

- Identity cookies: verify the actual30-day session,10-minute flow and30-day deletion-ticket validity. State validity separately from record storage; an expired credential is not proof its database row was deleted.
- Proof/session/nonce cleanup can be opportunistic. Report actual final cleanup. Do not invent a deletion deadline for retained fences, receipts, mail quota/rate rows or unresolved encrypted Apple grants.
- Google sign-in uses the general Google privacy notice and actual openid/email scopes, separately from Gemini content terms. Apple can provide a relay address and has independent security processing. No mailbox/document access is claimed.
- Cloudflare Turnstile is a processor for website security signals and a separate controller for bot-detection improvement under its current addendum. Add its notice; do not claim every provider acts only on instructions or never improves its service.
- Cloudflare Email Sending preview can retain full sent messages for about7days when enabled; new sending domains default on. D1 Time Travel is always on with a published30-day Workers Paid/7-day Free window. Verify actual sender setting, resource plan/jurisdiction and exports before making a deployment-specific promise.
- Preserve Access before every API and across policy routes. Apple callback acceptance needs actual Access cookie/policy facts; source code or published cookie defaults alone is not live proof.
- The owner permits current templates without solicitor review for now. Disclose that status in review/evidence, not an internal prologue on product policy pages. ICO registration stays null until actual issuance.

## Regression and verification contract

New cases must render the real policy inputs and generator. They fail on old content because account/identity/Turnstile notices, validity-versus-retention limits and truthful deletion boundaries are absent. Assert conditional availability and no false active-database claim for disabled mode, direct identity provider notices, preserved free/private/pending-ICO output, no advertising/tracker consent invention, and no unsupported guaranteed total erasure. Existing hostile-markup, stable-output, missing-data and history assertions remain unchanged.

Use actual local dependencies in this worktree. Healthy proof: all relevant and full tests pass; Worker/tests/client typecheck and lint pass; build regenerates four safe HTML pages and bundle scan passes; manifest remains building. A rendered page is not a real signup, deletion, provider billing or protected live-route result. Review and live evidence stay attributed to the exact head/build that produced them.

## Divergences

- None. Pending stable source/configuration facts will be recorded before first-red tests and source edits, with root acceptance if scope changes.
