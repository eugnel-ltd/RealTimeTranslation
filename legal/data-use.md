# Data use and storage choices: {{product.name}}

Effective: {{effective}}

This is a free, private tool for the authorised adult owner. Public signup is unavailable. It is for professional use, not for children. Translation and AI output can be wrong. Review it before use; do not rely on it for professional advice or as the sole basis for an employment decision.

## Before you record or request an answer

When you start speech, the app sends microphone audio to the selected provider. The browser lets this device capture audio after you grant permission. Other people still need notice and a lawful basis for their data. Tell participants what you plan to record and how it will be used. Record or upload personal information only when you have a lawful basis and the required permissions. Do not submit sensitive or confidential material without an appropriate basis and safeguards.

Azure speech uses the Microsoft service directly from the browser. Gemini Live uses Google, directly or through our Cloudflare proxy. Text translation uses Azure Translator when configured, with Google fallback. Detection can send a transcript window and last question to TypeSafe; its configured fallback can use Google. AI answers send the question, recent conversation and any selected context, notes or candidate profile to Google. If you stop capture, providers can still hold material you sent earlier.

## Your browser choices

The app saves future final transcripts in this browser only after you enable “Save future final transcripts in this browser” in Settings and save the choice. It starts off when no positive choice exists. You can switch it off to stop future history writes. The app does not later add final transcripts completed while saving was off. It also skips an utterance when an interim result spans a change of choice. Providers can buffer audio: a future final result may include speech already in progress when you enable saving. This choice controls local storage of received results, not the start time of audio capture.

Your existing saved history and notes stay when you switch saving off. Delete saved sessions in History, clear saved context or notes and save, or clear this site's browser data. When you enable saving, Clear Transcripts first flushes pending final text to history, then clears the current display. It does not delete saved history or provider copies. Browser history and saved settings have no automatic expiry in this app. If the browser refuses a changed history choice, Settings reports that it applies only until reload. Clear site data to remove any older stored choice. The browser can block, clear or evict storage. Keep your own copy of material you need.

We use Access sign-in and security information to protect this private tool. User-requested settings and the history choice stay in this browser. We run no advertising or optional client usage tracker. Microphone access uses the browser's actual permission control.

## Account sign-in when available

These account features are disabled in the current private service. Cloudflare Access still protects the tool. Implemented account controls become available only after the operator configures and enables them; this notice does not announce public signup.

When account sign-in is available, you can use the offered email code, Google or Apple methods and manage linked methods in Account. Google sign-in requests only your identifier and email. Apple can provide your email or a relay address. This does not give us access to your mailbox or documents. We store account identifiers, verified email addresses, linked methods, sign-in times and security records. Email codes go through Cloudflare Email Sending. A provider accepting or queuing a message is not proof that it reached your mailbox. Encrypted Apple credentials may remain while revocation or an uncertain exchange is being resolved.

Necessary sign-in cookies are Secure and HttpOnly. The session cookie is valid for up to 30 days. The sign-in flow cookie and email code are valid for up to 10 minutes. The deletion-resumption cookie is valid for up to 30 days. Successful signout clears these cookies in this browser. Cookie or code expiry stops use of a credential; it does not prove that its stored record has been erased. Cleanup runs in bounded batches when maintenance is invoked, with some expired proof records also removed during later sign-in attempts. We do not promise immediate physical deletion at expiry.

When enabled, account settings and optional history belong to the verified account in this browser. The history choice still starts off without a positive saved choice. Old browser data is not automatically assigned to a new account. Changing accounts stops the prior account's work, and the app checks sign-in again before loading another account's saved data.

## Server copies and requests

Existing owner profiles remain separate in Cloudflare KV until an operator overwrites or removes them. When accounts are enabled, customer profiles use a separate account-scoped D1 database. Neither profile store has an automatic expiry. If you choose a profile for an answer, the app sends its content to Google. Support email goes through Cloudflare to our existing support mailbox and R2 records. Stored R2 records exclude attachments, but forwarded original mail may include them. These records have no automatic expiry.

When the Account deletion control is available, it requires recent sign-in and explicit confirmation. It blocks further account use before attempting deletion, revokes known Apple credentials and waits for the product's profile erasure before removing identity records. A pending or retry status is not confirmation of completion. Unresolved provider work can delay completion; the deletion-resumption cookie lets this browser check progress, and fresh proof can resume a pending deletion.

After completion, minimal security records remain to prevent stale requests from restoring an erased account. These include permanent random account identifiers and timestamps for newly created accounts, not saved profile content. Migrated accounts, if any, keep their existing identifiers. Completed deletion receipts become eligible for cleanup after 90 days once their resumption tickets have expired; shorter-lived proof and notification records have separate cleanup thresholds. Unresolved security or provider work stays until safely resolved. Mail rate and budget records also remain for abuse prevention and accounting; cleanup uses a 62-day cutoff and calendar-month buckets, not a guaranteed 62-day maximum.

On a matching completion receipt, the browser removes only the verified account's known settings, history and fallback marker in this browser. If it cannot identify that saved scope after a reload, or storage removal fails, you may need to clear this site's data manually. Account deletion does not clear other browsers or devices, unrelated legacy browser data, support correspondence or provider backups. It does not delete your Google or Apple account.

Ask {{company.privacy_email}} for a copy, correction, objection or deletion, including when account controls are unavailable. Say which history, profile or support request you mean. Do not send unnecessary sensitive data. An operator assesses separate server, support and provider copies. A local deletion, completed account job or blank profile does not prove that providers, backups or caches have also removed the data.

## Providers and international processing

Microsoft documents that its real-time speech and speech translation do not retain customer input after processing. Its text Translator service also does not persist submitted text. Our code does not enable optional Speech audio logging. Speech uses the UK South region. Other services and metadata can follow different processing routes.

Google requires Paid Services for UK API clients. Google excludes content from product improvement under its UK data-use terms, even for unpaid quota. Abuse monitoring retains prompts, context and output for 55 days. International processing may occur. Before use, the operator must check that the project meets the billing requirement. An API key alone does not prove this. Provider notices explain these terms.

TypeSafe AI, Inc. publishes US hosting and a commitment not to train on API input. Its DPA sets a retention criterion based on purpose. It gives no fixed day count and includes UK transfer terms. We do not claim enterprise zero retention. Cloudflare processes hosting, Access, security and storage data across its service infrastructure; its DPA includes UK transfer terms. Cloudflare publishes a seven-day period for Workers Paid logs. Access periods depend on the plan and any exports. These periods do not automatically expire KV profiles or support R2 records.

When configured for sign-in, Turnstile processes browser and network signals to resist abuse. Cloudflare acts as processor for the site's security checks and as a separate controller for improving bot detection under its Turnstile notice. Google and Apple also process sign-in and security information under their own linked privacy notices. These roles differ from processing transcript content for an answer.

Cloudflare sent-message previews can retain the full message for about seven days when enabled; new sending domains default to enabled previews. D1 backup recovery windows are published as 30 days on Workers Paid and seven days on Free. The actual sender-preview setting, database plan, jurisdiction and any exports need verification before account activation. A database location hint is not a guarantee that all related processing stays in that location. Backup recovery and provider retention are separate from deleting the app's current records.

We plan minimal Sentry reports for server failures. Reporting needs a configured project before use. It sends fixed failure categories, route/status tags and release information, without original requests or errors. The project and region still need live verification. There is no client analytics or advertising identifier in this reporting code.

The provider notices linked below describe their processing terms and international safeguards. Contact {{company.privacy_email}} for the applicable arrangements or to exercise a right. The privacy page states our ICO registration ({{company.ico_registration}}).
