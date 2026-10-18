# RTT data inventory

This is internal evidence for issue [#9](https://github.com/eugnel-ltd/RealTimeTranslation/issues/9), dated 18 October 2026. It prepares a later policy draft. The legal baseline remains `missing`.

RTT is free. Cloudflare Access limits use to the owner. RTT has no customer signup, account-delete route, checkout or payment integration. Shared D1 identity is an approved direction, not a deployed RTT feature.

## Sources and company facts

The source review uses RTT commit `557988c0c490c9ae191eba642f11bd541df752aa`. Links below point to files in this repository. A code path proves a possible flow. It does not prove which provider configuration is live.

Company facts come from [eugnel-hq/company/company.yaml](https://github.com/eugnel-ltd/eugnel-hq/blob/3941a3527ef76a808587a3df85148b9a2b6724dd/company/company.yaml). Read the current canonical file for each draft. Do not create a second company record here.

On 18 October, that record gives `hello@eugnel.com` as the privacy contact. ICO registration is null and pending, with application reference C2062045. The expected date, 19 October, does not establish registration.

## Web data flows

Provider retention, legal role, location and transfer terms remain unverified unless stated below. An endpoint, region variable or short-lived token does not establish those facts. This inventory assigns no lawful basis.

| Data and purpose | Route and recipient | App retention and deletion | Source |
|---|---|---|---|
| Microphone audio for Azure speech and speech translation | Browser Speech SDK sends audio to Microsoft Azure. The Worker issues a token without receiving audio. | Stop releases the recognizer and microphone resources. No RTT audio-file storage was found. Provider retention is unverified. | [Azure client](../../client/src/services/azureSpeech.ts), [token route](../../worker/src/speech-token.ts) |
| Microphone audio for Gemini Live | Browser sends 16 kHz PCM over WebSocket to Google with an ephemeral token. Token failure uses a Cloudflare Worker proxy to Google. | Stream and socket state stay in memory. Stop closes them and clears interim buffers. No app audio persistence was found. | [Gemini client](../../client/src/services/geminiSpeech.ts), [token and proxy](../../worker/src/gemini.ts) |
| Transcript text and source/target languages for translation | Browser → Worker → Azure Translator when configured. Google Gemini handles the request without an Azure key, or after Azure failure. | Worker request/response processing. Final transcripts have separate browser history storage, described below. | [Translation route](../../worker/src/translate.ts) |
| Transcript windows and last answered question for question detection | Browser → Worker → TypeSafe Jev at `api.typesafe.ai/v1/systemone` when configured. Automatic mode can use Google Gemini when TypeSafe is unconfigured. Other failure paths can pause detection. | Bounded working windows are not a provider retention limit. No detector-result database was found. | [Detection route](../../worker/src/detect-question.ts), [TypeSafe adapter](../../worker/src/typesafe.ts) |
| Question, recent conversation, hints, prior question, language/template choices, optional context/notes and selected profile for AI answers | Browser → Worker → Google Gemini streaming API. The Worker adds the selected profile from KV. | Current answer and up to 20 Q&A items stay in React memory. No Q&A persistence call was found. Transcript history is separate. | [App answer state and request](../../client/src/App.tsx), [answer route](../../worker/src/answer.ts) |
| Latest answer copied by the user | The Copy action sends current or latest answer text to the system clipboard. | RTT does not control clipboard history, sync or other apps that read it. | [App copy action](../../client/src/App.tsx) |
| Final transcript history: original/translated text, languages, IDs and timestamps | Browser `localStorage`, key `transcriptionHistory`. No server history upload was found. | No app TTL or count cap. History permits session deletion. Browser site-data removal or eviction can also remove it. Deletion affects this browser's saved list, not provider copies. | [History storage](../../client/src/services/transcriptHistory.ts), [History control](../../client/src/components/History.tsx) |
| Preferences, optional personal context and extra notes | Browser `localStorage`, key `user_settings`. Context/notes can later enter answer requests. | Saved across reloads with no expiry. Clear the fields and save, or remove browser site data. Existing legacy `cvBackground` values can populate extra notes. No legacy-data deletion or migration is part of this preparation. | [Settings service](../../client/src/services/settings.ts), [settings fields](../../client/src/components/Settings.tsx) |
| Azure quota fallback month | Browser `localStorage`, key `rtt_azure_quota_fallback_month`. | A different month makes the marker inactive. Code does not automatically delete the old value. | [Fallback memory](../../client/src/services/fallbackMemory.ts) |
| Named candidate profile markdown, up to 200 KiB | Access-protected Worker → Cloudflare KV `PROFILES`. Selected content also enters Google answer prompts. | PUT overwrites the fixed profile key. No TTL or DELETE route exists. There is no per-customer account isolation. | [Profiles](../../worker/src/profiles.ts), [KV binding](../../wrangler.jsonc), [answer route](../../worker/src/answer.ts) |
| Access identity, JWT assertion and network metadata | Cloudflare Access handles access. The Worker checks JWTs against Access JWKS. Email or IP supplies the rate-limit key. The deployment guide names Google login. | Repository source does not establish Access/session/log or rate-limit retention. No RTT customer-account database exists. | [Access checks](../../worker/src/access.ts), [rate limits](../../worker/src/index.ts), [deployment guide](../../DEPLOY.md) |
| Operational request/error metadata | Cloudflare Workers logs are enabled with configured head sampling of 1. App logs include method/path and fixed error/status categories. | Cloudflare log retention and live settings remain unverified. Paths must not be assumed free of personal input. | [Worker configuration](../../wrangler.jsonc), [request logging](../../worker/src/index.ts), [log helpers](../../worker/src/http.ts) |
| Planned Sentry server diagnostics | With a valid DSN, the Worker sends a fixed failure message, allowed route/status/kind tags and release metadata. It passes no original request or error. | No app queue or backfill. Transport has a two-second deadline. Live project, DSN, region, retention and receipt remain unverified. | [Reporter](../../worker/src/observability.ts), [observability evidence](../observability.md) |
| Support emails | `rtt@eugnel.uk` → existing Cloudflare Email Worker → R2 and the unchanged private forward destination. | R2 stores message ID, envelope addresses, subject, text and received time, plus a day index. No R2 lifecycle or mailbox retention was established. Original mail forwarding can retain attachments at the destination. | [Support evidence](../support.md), shared source below |

The shared support-mail review uses AI-SDLC commit `b217812bca40c0b3d3ff1ba012ed8c4e33ee2636`: [forward/store handler](https://github.com/eugnel-ltd/ai-sdlc/blob/b217812bca40c0b3d3ff1ba012ed8c4e33ee2636/workers/support-mail/src/index.js), [record fields](https://github.com/eugnel-ltd/ai-sdlc/blob/b217812bca40c0b3d3ff1ba012ed8c4e33ee2636/workers/support-mail/src/record.js) and [configuration](https://github.com/eugnel-ltd/ai-sdlc/blob/b217812bca40c0b3d3ff1ba012ed8c4e33ee2636/workers/support-mail/wrangler.toml). Stored JSON excludes attachments. Code caps subject text at 500 characters. It caps body text at 64 Ki characters and adds a truncation marker when needed. These limits do not apply to the forwarded original.

## Existing controls and limits

- Stop Recording ends audio capture. It does not erase text already saved or sent to a provider.
- Clear Transcripts flushes pending final text to browser history, then clears the current transcript and answer display. It preserves saved history.
- History session deletion rewrites browser storage. It does not delete the current displayed transcript or copies at providers.
- Settings saves personal context and extra notes in the browser across reloads.
- The settings service has a reset method, but no reset UI caller was found. Do not promise a reset button.
- Storage writes can fail, for example when the browser blocks storage or reaches its limit. The [helper](../../client/src/services/browserStorage.ts) reports failure. Transcript code retains unsaved entries for a later attempt.
- KV profile and support-mail requests need operator handling. No customer deletion UI or measured request SLA exists in this implementation.

An empty profile overwrite does not prove erasure from caches, backups or providers. Record the actual scope and outcome of any operator action.

The notes label now says “Notes saved in this browser and used with the selected profile…”. [Issue #37](https://github.com/eugnel-ltd/RealTimeTranslation/issues/37) corrected the earlier label. It did not change storage, legacy values or retention.

## Desktop scope

The independent [Python app](../../translator_app.py) saves three language choices in local `settings.json`. Azure SDK takes microphone audio with the operator's key and region. Transcript display stays in memory, and Clear History clears that widget.

The desktop app does not implement web localStorage history, Google answers or TypeSafe detection. A web policy draft must keep this scope clear.

## Facts still needed for complete policies

1. Actual ICO registration evidence. Keep the number null while pending. A date alone never changes status.
2. Current Google project tier and applicable Gemini API/Live terms, including improvement use, legal role, locations, retention and deletion. [DEPLOY.md](../../DEPLOY.md) currently warns that the free tier uses content to improve Google products. That statement is not a fresh check of the live billing account.
3. Microsoft Speech/Translator resource and contract evidence for retention, deletion and transfers. Configured `uksouth` and the global Translator endpoint do not establish a complete processing location.
4. TypeSafe service entity, terms, role, locations, retention, deletion and transfer arrangements.
5. Cloudflare Access, Workers, KV, rate-limit and log settings, locations and retention. Also establish R2 lifecycle and destination-mailbox retention without publishing its private address.
6. Sentry provisioning, region, retention and synthetic receipt. Treat it as planned until the live evidence in [observability](../observability.md) exists.
7. A supported UK GDPR lawful basis and linked-data status for each category. Microphone permission does not establish consent from every recorded person. Recording safeguards and audience claims need factual support.
8. Complete policy pages, an effective date and a tested delivery link. Support receipt/intake proof remains tracked in [#11](https://github.com/eugnel-ltd/RealTimeTranslation/issues/11).

These are evidence and implementation tasks. The owner authorises the current unreviewed-template approach without a solicitor for now. That decision does not establish missing provider facts.
