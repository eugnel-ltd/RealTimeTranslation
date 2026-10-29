# RTT data inventory

This is internal evidence for issue [#9](https://github.com/eugnel-ltd/RealTimeTranslation/issues/9), dated 18 October 2026. It supports the linked legal pages. [Provider evidence](provider-evidence.md) resolves the published terms and retention facts. Live delivery evidence remains separate; the legal baseline stays `missing` until acceptance is verified.

RTT is free. The current live service remains owner-only behind Cloudflare Access, with account mode disabled. Source now implements shared D1 identity, account controls and retryable deletion, but source integration does not activate them or announce public signup. There is no checkout or payment integration.

## Sources and company facts

The original speech/storage review used RTT commit `557988c0c490c9ae191eba642f11bd541df752aa`; the merged functional legal/history change is `7827d18f68dfe7b85564ff40eebcba7927f319c9`. The account audit uses RTT consumer `07413eb169df803bb7e2f23529f4211f566c1371` and shared identity `425534f56e20860d229c09b6bcd75d4d4a1b61cf`. Links below point to files in this repository or immutable shared source. A code path proves a possible flow, not activation or a live provider setting.

Company facts come from [eugnel-hq/company/company.yaml](https://github.com/eugnel-ltd/eugnel-hq/blob/3941a3527ef76a808587a3df85148b9a2b6724dd/company/company.yaml). Read the current canonical file for each draft. Do not create a second company record here.

On 18 October, that record gives `hello@eugnel.com` as the privacy contact. The canonical company snapshot now records ICO registration **ZC277339** (registered). Application reference C2062045 remains separate provenance in the HQ record; an expected date alone never establishes registration.

## Web data flows

Provider retention, legal role, location and transfer terms remain unverified unless stated below. An endpoint, region variable or short-lived token does not establish those facts. This inventory assigns no lawful basis.

| Data and purpose | Route and recipient | App retention and deletion | Source |
|---|---|---|---|
| Microphone audio for Azure speech and speech translation | Browser Speech SDK sends audio to Microsoft Azure. The Worker issues a token without receiving audio. | Stop releases the recognizer and microphone resources. No RTT audio-file storage was found. Provider retention is unverified. | [Azure client](../../client/src/services/azureSpeech.ts), [token route](../../worker/src/speech-token.ts) |
| Microphone audio for Gemini Live | Browser sends 16 kHz PCM over WebSocket to Google with an ephemeral token. Token failure uses a Cloudflare Worker proxy to Google. | Stream and socket state stay in memory. Stop closes them and clears interim buffers. No app audio persistence was found. | [Gemini client](../../client/src/services/geminiSpeech.ts), [token and proxy](../../worker/src/gemini.ts) |
| Transcript text and source/target languages for translation | Browser → Worker → Azure Translator when configured. Google Gemini handles the request without an Azure key, or after Azure failure. | Worker request/response processing. Final transcripts have separate browser history storage, described below. | [Translation route](../../worker/src/translate.ts) |
| Transcript windows and last answered question for question detection | Browser → Worker → TypeSafe Jev at `api.typesafe.ai/v1/systemone` when configured. Automatic mode can use Google Gemini when TypeSafe is unconfigured. Other failure paths can pause detection. | Bounded working windows are not a provider retention limit. No detector-result database was found. | [Detection route](../../worker/src/detect-question.ts), [TypeSafe adapter](../../worker/src/typesafe.ts) |
| Question, recent conversation, hints, prior question, language/template choices, optional context/notes and selected profile for AI answers | Browser → Worker → Google Gemini streaming API. The Worker loads the selected owner KV profile, or the verified account's product D1 profile in customer mode. | Current answer and up to 20 Q&A items stay in React memory. No Q&A persistence call was found. Transcript history is separate. | [App answer state and request](../../client/src/App.tsx), [answer route](../../worker/src/answer.ts) |
| Latest answer copied by the user | The Copy action sends current or latest answer text to the system clipboard. | RTT does not control clipboard history, sync or other apps that read it. | [App copy action](../../client/src/App.tsx) |
| Final transcript history: original/translated text, languages, IDs and timestamps | Browser `localStorage`, logical key `transcriptionHistory`; account mode captures a product/environment/origin/account prefix after server verification. No server history upload was found. | Only future final text is saved after an explicit positive choice. No app TTL or count cap. History permits session deletion. Browser site-data removal or eviction can also remove it. Deletion affects this browser's saved list, not provider copies. Old unassigned browser data is not adopted by an account. | [History storage](../../client/src/services/transcriptHistory.ts), [History control](../../client/src/components/History.tsx) |
| Preferences, optional personal context and extra notes | Browser `localStorage`, key `user_settings`. Context/notes can later enter answer requests. | Saved across reloads with no expiry. Clear the fields and save, or remove browser site data. Existing legacy `cvBackground` values can populate extra notes. No legacy-data deletion or migration is part of this preparation. | [Settings service](../../client/src/services/settings.ts), [settings fields](../../client/src/components/Settings.tsx) |
| Azure quota fallback month | Browser `localStorage`, key `rtt_azure_quota_fallback_month`. | A different month makes the marker inactive. Code does not automatically delete the old value. | [Fallback memory](../../client/src/services/fallbackMemory.ts) |
| Named candidate profile markdown, up to 200 KiB | Access-protected Worker → owner Cloudflare KV `PROFILES`, or separate product D1 when customer mode is enabled. Selected content also enters Google answer prompts. | Neither store has a TTL. Customer mode stores two fixed profile IDs per canonical account, bounds names to 256 UTF-8 bytes and fences/deletes only the captured account on a signed erasure. Owner KV remains separate. | [Profiles](../../worker/src/profiles.ts), [account boundary](../../worker/src/accounts.ts), [product profiles](../../worker/src/accountProfiles.ts), [answer route](../../worker/src/answer.ts) |
| Access identity, JWT assertion and network metadata | Cloudflare Access handles the outer boundary. The Worker checks JWTs against Access JWKS. Email or IP supplies the rate-limit key. | Repository source does not establish actual Access/log retention or exports. Customer databases remain disabled in the current private deployment. | [Access checks](../../worker/src/access.ts), [rate limits](../../worker/src/index.ts), [deployment guide](../../DEPLOY.md) |
| Operational request/error metadata | Cloudflare Workers logs are enabled with configured head sampling of 1. App logs include method/path and fixed error/status categories. | Cloudflare log retention and live settings remain unverified. Paths must not be assumed free of personal input. | [Worker configuration](../../wrangler.jsonc), [request logging](../../worker/src/index.ts), [log helpers](../../worker/src/http.ts) |
| Planned Sentry server diagnostics | With a valid DSN, the Worker sends a fixed failure message, allowed route/status/kind tags and release metadata. It passes no original request or error. | No app queue or backfill. Transport has a two-second deadline. Live project, DSN, region, retention and receipt remain unverified. | [Reporter](../../worker/src/observability.ts), [observability evidence](../observability.md) |
| Support emails | `rtt@eugnel.uk` → existing Cloudflare Email Worker → R2 and the unchanged private forward destination. | R2 stores message ID, envelope addresses, subject, text and received time, plus a day index. No R2 lifecycle or mailbox retention was established. Original mail forwarding can retain attachments at the destination. | [Support evidence](../support.md), shared source below |

The shared support-mail review uses AI-SDLC commit `b217812bca40c0b3d3ff1ba012ed8c4e33ee2636`: [forward/store handler](https://github.com/eugnel-ltd/ai-sdlc/blob/b217812bca40c0b3d3ff1ba012ed8c4e33ee2636/workers/support-mail/src/index.js), [record fields](https://github.com/eugnel-ltd/ai-sdlc/blob/b217812bca40c0b3d3ff1ba012ed8c4e33ee2636/workers/support-mail/src/record.js) and [configuration](https://github.com/eugnel-ltd/ai-sdlc/blob/b217812bca40c0b3d3ff1ba012ed8c4e33ee2636/workers/support-mail/wrangler.toml). Stored JSON excludes attachments. Code caps subject text at 500 characters. It caps body text at 64 Ki characters and adds a truncation marker when needed. These limits do not apply to the forwarded original.

## Conditional account processing

Only exact `ACCOUNTS_ENABLED=1` selects customer mode. Missing enabled configuration fails closed, without falling back to owner profiles. Access remains first on every API. The [server contract](../accounts-server.md) and [identity spec](../specs/8-identity.md) describe the captured product, environment and origin. The optional expected-account wire value is a consistency precondition against the verified cookie, never account-selection authority; canonical Unicode identifiers are preserved. It is not added to logs.

The source below is implemented, not a claim that its D1 bindings, providers, mail or callbacks are live.

| Data and recipient | Purpose and limits | Retention/control |
|---|---|---|
| Shared identity D1: canonical account ID, verified email, Google/Apple subject, linked methods and sign-in times | Requested email-code, `openid email` Google or Apple sign-in/linking. New account IDs are random; migrated canonical identifiers keep their existing form. No Google profile, mailbox or document scope. Apple may supply a relay address. | Remove current identity records only after coordinated deletion acknowledges provider and product work. Separate permanent security fences remain. |
| Hashed session and deletion tickets; OAuth state/proofs and keyed email/code hashes | Secure/HttpOnly host-only cookies: session Lax 30 days, flow None 10 minutes, deletion Lax 30 days. Email codes last 10 minutes with five wrong attempts. Signout clears all three cookies. | Validity is separate from physical row cleanup. OAuth starts opportunistically prune bounded expired proof/rate rows; signed maintenance prunes eligible sessions/tickets. |
| Encrypted Apple grants, staged/orphan exchanges, authorization times and signed-event receipts | Revoke grants on removal/deletion and safely handle signed provider notifications. An uncertain exchange remains a blocker until verified reconciliation. | A persistent subject-wide revocation barrier outlives a short ownership lease. Newer verified consent makes stale events harmless; unknown/tied authorization times do not authorize erasure. Guarded completion removes applicable authorization/barrier records; pending work remains. |
| Sign-in email address, code message and Cloudflare mail records | Fixed Cloudflare Email Sending REST operation; account-wide allocation and abuse limits. Accepted/queued is not mailbox delivery. | Keyed email/IP counters, reservations and gaps have explicit maintenance thresholds below. Provider message previews may retain the full message about seven days when enabled. Actual setting is unverified. |
| Turnstile browser/network signals and proof | When configured, browser → Cloudflare Turnstile, then server verification before email-code delivery. | Cloudflare is processor for site security and separate controller for bot-detection improvement. No invented RTT retention period. |
| Account-scoped local preferences, history and fallback marker | Mount only after server bootstrap; scope includes product/environment/origin/account. Cross-tab hints carry a random nonce and trigger server revalidation. | Preserve positive history choice and old data. Account changes stop stale work. Matching deletion completion clears only the captured account's three known keys in this browser. Reload without a captured scope or failed removal requires manual site-data cleanup. Other devices and legacy data remain separate. |

Shared evidence at `425534f56e20860d229c09b6bcd75d4d4a1b61cf`: [service and cookie handling](https://github.com/eugnel-ltd/eugnel-platform/blob/425534f56e20860d229c09b6bcd75d4d4a1b61cf/packages/auth/src/identity/service.js), [deletion and maintenance](https://github.com/eugnel-ltd/eugnel-platform/blob/425534f56e20860d229c09b6bcd75d4d4a1b61cf/packages/auth/src/identity/deletion.js), [mail quota](https://github.com/eugnel-ltd/eugnel-platform/blob/425534f56e20860d229c09b6bcd75d4d4a1b61cf/packages/auth/src/identity/quota.js), [proof flows](https://github.com/eugnel-ltd/eugnel-platform/blob/425534f56e20860d229c09b6bcd75d4d4a1b61cf/packages/auth/src/identity-proofs/flows.js) and [Worker/activation contract](https://github.com/eugnel-ltd/eugnel-platform/blob/425534f56e20860d229c09b6bcd75d4d4a1b61cf/workers/identity/README.md). RTT's [browser manager](../../client/src/services/accountBrowser.ts) and [account bootstrap](../../client/src/components/AccountBootstrap.tsx) implement the local boundary and deletion messages.

Public Apple notification ingress is separately default-off. When configured, only registered fixed paths accept bounded signed Apple JWS with fixed audience, rate limiting and signature/claim checks. Other service actions remain signed internal calls; product callbacks keep Access. No public callback hostname or Access exception is introduced by these docs.

### Cleanup thresholds, not physical-deletion deadlines

Signed `/v1/advance` invokes explicit maintenance; source installs no scheduler. Each invocation prunes at most 100 eligible rows per table. Live acceptance must observe maintenance and unresolved-job recovery.

| Record | Eligibility and retained limits |
|---|---|
| Session/deletion ticket | After its 30-day expiry, bounded maintenance can remove the row. |
| Proof/rate/replay | Original code/flow validity 10 minutes; opportunistic expired-proof cleanup on OAuth starts and rate windows older than 24 hours. Caller replay nonces last five minutes, with bounded cleanup after accepted calls. |
| Completed method tombstone | After 15 minutes, covering proof lifetime plus clock/transport margin, eligible for maintenance. Pending fences remain. |
| Completed Apple notification receipt | Created more than two hours ago and completed, eligible for maintenance. Pending receipts/barriers/grants remain until safe completion. |
| Completed deletion job and targets | Completed more than 90 days ago with no remaining ticket, eligible for maintenance. |
| Canonical identity/product security fence | Canonical account ID and timestamp, plus product job ID where needed, remain permanently to reject stale work. New IDs are random; existing canonical IDs are preserved and never recycled. |
| Mail accounting | Reservations older than 62 days and counter periods older than that cutoff's calendar month become eligible; this is not a strict 62-day maximum. Rolling gaps older than one hour are eligible. |

Actual D1 jurisdiction/plan, Time Travel recovery, exports, email preview settings and maintenance invocation remain operational facts to verify. A deletion receipt concerns current application records; it does not certify provider/backups or every device's storage.

## Existing controls and limits

- Stop Recording ends audio capture. It does not erase text already saved or sent to a provider.
- Clear Transcripts flushes pending final text to browser history, then clears the current transcript and answer display. It preserves saved history.
- History session deletion rewrites browser storage. It does not delete the current displayed transcript or copies at providers.
- Settings saves personal context and extra notes in the browser across reloads.
- Future transcript history starts off without a positive choice. Turning it off stops writes and pending retries; it does not erase old history. Enabling it does not add final results already completed while off. A later final result may include audio already in progress because provider buffering does not expose a trustworthy start time.
- The settings service has a reset method, but no reset UI caller was found. Do not promise a reset button.
- Storage writes can fail, for example when the browser blocks storage or reaches its limit. The [helper](../../client/src/services/browserStorage.ts) reports failure. Transcript code retains unsaved entries for a later attempt.
- Owner KV and support-mail requests need operator handling. Conditional Account controls support recent-proof deletion with retry/progress; no measured response SLA or blanket erasure promise exists.

An empty profile overwrite does not prove erasure from caches, backups or providers. Record the actual scope and outcome of any operator action.

The notes label now says “Notes saved in this browser and used with the selected profile…”. [Issue #37](https://github.com/eugnel-ltd/RealTimeTranslation/issues/37) corrected the earlier label. It did not change storage, legacy values or retention.

## Desktop scope

The independent [Python app](../../translator_app.py) saves three language choices in local `settings.json`. Azure SDK takes microphone audio with the operator's key and region. Transcript display stays in memory, and Clear History clears that widget.

The desktop app does not implement web localStorage history, Google answers or TypeSafe detection. A web policy draft must keep this scope clear.

## Publication and live evidence checks

1. Keep the canonical company snapshot aligned with HQ; render registered ICO **ZC277339** when present. Pending rendering is supported when registration is absent; an expected date alone never changes status.
2. Actual Google project billing eligibility. [Current provider evidence](provider-evidence.md) records the published UK Paid Services requirement and data-use terms; these do not prove the live project setting.
3. Microsoft resource configuration against the scoped public no-trace statements in [provider evidence](provider-evidence.md). Configured `uksouth` does not establish a complete location for every service and metadata item.
4. Any custom TypeSafe arrangement that differs from its published US hosting, purpose-based retention and UK transfer terms. The earlier documentary gaps are resolved in [provider evidence](provider-evidence.md).
5. Cloudflare Access, Workers, KV, rate-limit and log settings, locations and retention. Also establish R2 lifecycle and destination-mailbox retention without publishing its private address. Before customer activation verify identity/product/shared-quota D1 bindings and migrations, plan/jurisdiction/backup/export facts, email preview settings, actual callbacks and bounded maintenance/recovery receipts.
6. Sentry provisioning, region, retention and synthetic receipt. Treat it as planned until the live evidence in [observability](../observability.md) exists.
7. A supported UK GDPR lawful basis and linked-data status for each category. Microphone permission does not establish consent from every recorded person. Recording safeguards and audience claims need factual support.
8. Complete policy pages, an effective date and a tested delivery link. Support receipt/intake proof remains tracked in [#11](https://github.com/eugnel-ltd/RealTimeTranslation/issues/11).

These are evidence and implementation tasks. The owner authorises the current unreviewed-template approach without a solicitor for now. That decision does not establish missing provider facts.
