# Provider facts for RTT legal pages

We checked the public sources on 18 October 2026 without external writes. These sources establish published terms, not the private project's billing, custom settings or a new expenditure approval. The [inventory](data-inventory.md) establishes which data the code sends.

| Source | Verified fact used in the pages |
|---|---|
| [Google Gemini terms](https://ai.google.dev/gemini-api/terms), effective 23 March 2026 | UK API clients require Paid Services. The separate UK data-use clause applies paid handling even to unpaid quota. API project billing status still needs direct verification. |
| [Google abuse monitoring](https://ai.google.dev/gemini-api/docs/usage-policies) | Prompts, context and outputs have a published 55-day abuse-monitoring period. This is not a promise of zero retention. |
| [Microsoft Speech privacy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/speech-to-text/data-privacy-security) | Real-time speech and speech translation have no stored customer input after processing. This differs from batch or optional logging modes. RTT does not enable those logging modes. |
| [Microsoft Translator privacy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/translator/data-privacy-security) | Submitted text is not persisted. Do not extend this statement to other Microsoft products or all metadata. |
| [TypeSafe privacy](https://typesafe.ai/legal/privacy-policy) and [DPA](https://typesafe.ai/legal/data-processing) | The service publishes US hosting, no training on API input, purpose-based retention and UK transfer terms. Enterprise zero retention is a separate arrangement, not RTT's default. |
| [Cloudflare DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) | Publishes service-processing roles and UK transfer arrangements. The pages do not impose one unsupported role on every provider or item of metadata. |
| [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) | Current Workers Paid retention is seven days. This does not expire KV or R2 records. |
| [Zero Trust logs](https://developers.cloudflare.com/cloudflare-one/insights/logs/) | Access retention varies by plan: the published Free period is 24 hours. Exports and custom arrangements must be checked separately. |
| [ICO storage guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/cookies-and-similar-technologies/) | Optional device storage needs a positive choice. The necessary-service exception does not cover a feature merely because it is useful. RTT therefore asks before future transcript-history writes. |

## Build inputs and facts still requiring live evidence

`product.yaml` owns product data facts. `legal/company-source.json` identifies the canonical HQ revision and digest for `legal/company.snapshot.yaml`. The build uses that snapshot. The source repository remains the authority. To update it, obtain the current reviewed `eugnel-hq/company/company.yaml`, copy its bytes, and update the source commit and SHA-256 digest in the same reviewed change. Never promote an expected registration date to an issued number.

The build uses shared legal rendering and writes four escaped HTML pages. It does not publish the generic consent/store sheets, which contain controls or channel claims the private web app does not implement. The data-use page explains the controls the app has.

A working API key does not prove that the project meets Google billing rules. This PR changes no billing setting. Before Google-enabled use in the UK, an operator must verify the active billing requirement. This change approves no billing action or spend. The current Access plan/exports, support mailbox retention and live Sentry project also need operational evidence where they differ from the code or public defaults. These are concrete live checks; published provider terms are no longer treated as wholly unknown.

There is no new advertising or client usage tracker. The history choice is separate from necessary Access security and user-requested saved settings. The app keeps old history and notes when the user has no positive choice or switches saving off. API account integration must preserve these controls and update policy facts when it adds customer identity data.
