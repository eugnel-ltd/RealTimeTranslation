# Plan: functional legal pages and optional history (#9)

Feature at level 2. Expenditure: none. Root approved the scope on 18 October 2026. No visual design, public signup or new provider.

## Sources and delivery

Use the corrected shared legal renderer, including reviewed explicit pending ICO support. The canonical HQ record stays the authority. Keep a generated public-facts snapshot with its source commit and digest for repeatable offline builds; never maintain it as a second authority. Product data facts stay in product.yaml. Public provider sources and dates go in docs/legal/provider-evidence.md.

Generate privacy, terms, refunds and data-use pages at /legal/privacy/, /legal/terms/, /legal/refunds/ and /legal/data-use/. Use static semantic HTML and escape all content. Support only the fixed headings, paragraphs and lists in the shared output, not raw HTML or arbitrary active links. Give fixed navigation links and known contacts. The build regenerates pages from reviewed source inputs and includes them in assets. Add yaml 2.8.3 as an explicit build dependency rather than rely on a transitive package. Pin the reviewed platform commit.

App links point to the pages. Keep the existing site Access boundary and every API Access check. Existing assets serve the pages; no new Worker service or binding. No layout, colour, font, screenshot or icon changes. Listing metadata belongs to root on a separate branch.

Policy copy describes the current free, private adult professional product, provider processing and transfer terms, browser/profile/support retention and actual rights controls. State pending application C2062045, never a registration number. Correct the old generic Google free-tier warning using current terms: UK API users require Paid Services, and UK data handling follows the applicable paid-data terms. Billing status is a real configuration fact, not guessed or changed. Planned Sentry is labelled planned until live. No solicitor prerequisite; disclose the owner's current unreviewed-template policy in PR.

## History consent

Root separately approved positive opt-in for optional automatic history. Add an explicit saveTranscriptHistory preference. It is off unless exactly true, including existing settings without this new choice. Do not erase or migrate old history, notes or settings. A plain control uses existing styles and accurate copy: save future final transcripts in this browser; switching off stops future writes and does not remove old history.

Gate both the retry queue and flush with a current ref so a live session honours withdrawal immediately. Clear only the in-memory pending write queue on withdrawal. Do not enqueue text recorded while off for later retroactive saving. Keep current transcript display, old durable history, user-saved notes and selected settings. When opted in, preserve immediate-stop, delayed-stop, retry, unload and Clear Transcripts flush behavior. History deletion remains explicit.

Keep necessary Access/security and user-requested saved settings distinct. Add no fake analytics consent switch or tracking banner. Browser microphone permission stays real. Data-use text explains participant notice and lawful recording; it is not a claim that browser permission covers other speakers.

## Files and tests

Own App.tsx, Settings.tsx, settings service/types, a small legal links component, legal generator/build command, product legal facts, generated canonical snapshot/pages and evidence docs. Coordinate with the API agent; account integration starts from the merged history work and later scopes its preference per account.

Commit this plan, then meaningful tests before source. Test default-off and invalid preference refusal; positive save and immediate withdrawal in a running session; no retroactive queue; preserve old storage and opted-in stop/retry/unload/clear paths. Existing regressions retain their assertions and explicitly opt in where they test the saved-history contract.

Tests also exercise actual page generation and direct delivery: four pages, source facts, pending ICO/no fake ZB, free/no-account claims, provider links and data-use scope, escaped hostile text, deterministic generation and failure on missing facts. Prove linked built pages respond with HTML in a local server smoke. Record the live route check separately from local proof.

Run full tests, typecheck, lint, build, manifest, source links, writing and secret checks. Inspect the final diff and source snapshots. Root independently reviews the final head. Do not declare the legal baseline done or close #9 until concrete acceptance is met; finish code/content despite an identified live credential or Google billing blocker.

## Vendor evidence

Earlier legal research/test lanes each exited 1 after 20 seconds. Direct fallback is authorised. No new services, repeated long waits or paid calls.
