# Plan: functional legal pages and optional history (#9)

Feature at level 2. Expenditure: none. Root approved the scope on 18 October 2026. No visual design, public signup or new provider.

## Sources and delivery

Use the shared renderer with the reviewed pending ICO change. The canonical HQ record stays the authority. Keep a generated public-facts snapshot with its source commit and digest for repeatable offline builds; never maintain it as a second authority. Product data facts stay in product.yaml. Public provider sources and dates go in docs/legal/provider-evidence.md.

Generate privacy, terms, refunds and data-use pages at /legal/privacy/, /legal/terms/, /legal/refunds/ and /legal/data-use/. Use static semantic HTML and escape all content. Support only the fixed headings, paragraphs and lists in the shared output, not raw HTML or arbitrary active links. Give fixed navigation links and known contacts. The build regenerates pages from reviewed source inputs and includes them in assets. Add yaml 2.8.3 directly for the build. Do not rely on another package to provide it. Pin the reviewed platform commit.

App links point to the pages. Keep the existing site Access boundary and every API Access check. Use the asset service to serve the pages. Add no Worker service or binding. No layout, colour, font, screenshot or icon changes. Root owns listing metadata on a separate branch.

Policy copy describes the current free, private adult professional product, provider processing and transfer terms, browser/profile/support retention and actual rights controls. State pending application C2062045, never a registration number. Correct the old Google warning. Current terms require Paid Services for UK API users. Its UK data-use rule also applies paid handling to unpaid quota. Do not guess or change the billing state. Describe Sentry as planned until it goes live. No solicitor prerequisite; disclose the owner's current unreviewed-template policy in PR.

## History consent

Root approved a positive choice before the app saves optional history. Add an explicit saveTranscriptHistory preference. Treat only true as a positive choice. Keep it off for old settings that lack this choice. Do not erase or migrate old history, notes or settings. Use a plain control with the existing styles. Say that it saves future final transcripts in this browser. If the user switches it off, stop future writes and keep old history.

Use a current ref to gate the queue and flush. A live session must honour withdrawal at once. Clear only the in-memory pending write queue on withdrawal. Do not later add final results already completed while off. Skip known interim results that span a choice change, using an in-memory generation. A future final result may include audio already in progress because the provider does not expose a trustworthy audio start time. Keep current transcript display, old durable history, user-saved notes and selected settings. When opted in, preserve immediate-stop, delayed-stop, retry, unload and Clear Transcripts flush behavior. The user still chooses any deletion of saved history.

Keep necessary Access/security and user-requested saved settings distinct. Add no fake analytics consent switch or tracking banner. Browser microphone permission stays real. Explain notice to participants and lawful recording. Browser permission does not cover other speakers.

## Files and tests

Own App.tsx, Settings.tsx, settings service/types, a small legal links component, legal generator/build command, product legal facts, generated canonical snapshot/pages and evidence docs. Coordinate with the API agent; account integration starts from the merged history work and later scopes its preference per account.

Commit this plan, then meaningful tests before source. Test default-off and invalid preference refusal; positive save and immediate withdrawal in a running session; no retroactive queue; preserve old storage and opted-in stop/retry/unload/clear paths. Preserve prior assertions. Tests for saved history must first choose that feature.

Test actual page generation and delivery. Check all four pages and their source facts. Cover pending ICO text, free access and no account-delete claim. Check provider links, data-use scope, hostile text, stable output and failure on missing facts. Prove linked built pages respond with HTML in a local server smoke. Record the live route check separately from local proof.

Run full tests, typecheck, lint, build, manifest, source links, writing and secret checks. Inspect the final diff and source snapshots. Root independently reviews the final head. Do not mark the baseline done or close #9 before acceptance passes. Finish code and content even if a specific live check lacks access.

## Vendor evidence

Earlier legal research/test lanes each exited 1 after 20 seconds. Root permits direct fallback. No new services, repeated long waits or paid calls.

## Storage failure detail

The browser can refuse a settings write while an older positive choice remains on disk. A changed history choice still applies in memory, but the settings dialog must report that it could not save it. It must explain the reload limit and site-data removal. A separate test proves that failure without altering the first frozen tests or erasing stored data.

## Reviewed contract clarification

Root approved this clarification on 18 October 2026: the positive choice controls future final results, not audio start time. Preserve the accepted mid-session next-final behavior. Do not force a restart or promise that no buffered speech predates the choice. The settings and data-use text must state this limit. Repeated failed saves must keep their visible error; a memory choice does not prove a durable write. New frozen tests cover both retry failure and known interim spans without changing the earlier five files.
