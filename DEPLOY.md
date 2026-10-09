# Deploy Real-Time Translator on Cloudflare Workers

Do **not** put API keys in the client. The Vite bundle is served as Worker static assets; all secrets live in Worker secrets.

## Worker

- Name: `rtt`
- Custom domain: `rtt.eugnel.com` (from `wrangler.jsonc`)
- Assets: `client/dist` (SPA)
- API: `/api/*` runs the Worker first (`run_worker_first`)
- `workers_dev: false` and `preview_urls: false` so no `workers.dev` / preview URL bypasses Access

## Secrets

Set each with Wrangler (values are never printed back):

```bash
npx wrangler secret put AZURE_SPEECH_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TYPESAFE_API_KEY
# From the Cloudflare Zero Trust Access application named "RTT" (AUD / Application Audience).
# Prefer a secret so it is not in wrangler.jsonc. A plaintext var of the same name also works.
npx wrangler secret put ACCESS_AUD
# Optional — only if you add a Translator resource later. The Speech key cannot be reused.
npx wrangler secret put AZURE_TRANSLATOR_KEY
```

| Secret | Used by |
| --- | --- |
| `AZURE_SPEECH_KEY` | `GET /api/speech-token` → Azure `issueToken` |
| `GEMINI_API_KEY` | Gemini Live ephemeral tokens, Live proxy, and text translation when Translator is unset |
| `ANTHROPIC_API_KEY` | `POST /api/answer` and Jev fallback question detection |
| `TYPESAFE_API_KEY` | Default question detector (`POST /api/detect-question` → Jev `POST https://api.typesafe.ai/v1/systemone`) |
| `ACCESS_AUD` | Access JWT audience from the **RTT** Access app. Required in production (`SKIP_ACCESS_CHECK=false`); missing/empty → `500 ACCESS_AUD not configured` on `/api/*` |
| `AZURE_TRANSLATOR_KEY` | Optional. If set, `POST /api/translate` uses Azure Translator; otherwise Gemini `gemini-3.5-flash-lite` |

## Vars (`wrangler.jsonc` or dashboard)

| Var | Default / notes |
| --- | --- |
| `AZURE_SPEECH_REGION` | `uksouth` |
| `AZURE_TRANSLATOR_REGION` | Required only with `AZURE_TRANSLATOR_KEY` |
| `ACCESS_TEAM_DOMAIN` | `https://eugnel.cloudflareaccess.com` |
| `SKIP_ACCESS_CHECK` | `false` in production (and in `wrangler.jsonc`). `true` only in local `.dev.vars` |
| `DEFAULT_ANSWER_MODEL` | `claude-opus-5-5` (`claude-sonnet-5-5` also allowed) |
| `GEMINI_TRANSLATE_MODEL` | `gemini-3.5-flash-lite` |
| `GEMINI_LIVE_TRANSCRIBE_MODEL` | `gemini-3.5-transcribe-live` |
| `GEMINI_LIVE_TRANSLATE_MODEL` | `gemini-3.5-live-translate-preview` |
| `TYPESAFE_MODEL` | `jev-latest` |

Update vars:

```bash
npx wrangler deploy
# or dashboard → Workers → rtt → Settings → Variables
```

## Cloudflare Access

Protect `rtt.eugnel.com` with Access (Google login). The Worker verifies `Cf-Access-Jwt-Assertion` on **all** `/api/*` routes using `ACCESS_TEAM_DOMAIN` JWKS and `ACCESS_AUD`.

`ACCESS_AUD` is **not** in `wrangler.jsonc`. Set it with `npx wrangler secret put ACCESS_AUD` (or a Worker var) using the Application Audience from Zero Trust → Access → Applications → **RTT**. If it is empty while `SKIP_ACCESS_CHECK` is false, `/api/*` returns **500** `{ "error": "ACCESS_AUD not configured" }` (fail closed).

Do not enable a `workers.dev` route or preview URLs — those hostnames would skip the Access policy on `rtt.eugnel.com`.

Local development: copy `.dev.vars.example` to `.dev.vars` and set `SKIP_ACCESS_CHECK=true`.

## Build and deploy (from this repo)

```bash
npm install
npm --prefix client install
npm run build                 # client production build + secret-pattern scan of dist
npx wrangler deploy --dry-run # packaging check only
npx wrangler deploy           # you run this with your Cloudflare token
```

This environment has **no** Cloudflare/Azure/Gemini/Anthropic/TypeSafe keys. Do not deploy from the agent.

## Local Worker + smoke script

```bash
cp .dev.vars.example .dev.vars
# fill real keys in .dev.vars; keep SKIP_ACCESS_CHECK=true
npx wrangler dev
```

In another terminal:

```bash
node scripts/smoke.mjs
# or: SMOKE_BASE_URL=http://127.0.0.1:8787 node scripts/smoke.mjs
```

If Access is enabled against the smoke target:

```bash
SMOKE_ACCESS_JWT='<Cf-Access-Jwt-Assertion>' node scripts/smoke.mjs
```

The script checks:

- `GET /api/health`
- `GET /api/config`
- `GET /api/speech-token`
- `POST /api/translate` (Azure Translator if key set, else Gemini)
- `GET/POST /api/gemini-token` (ephemeral token uses `bidiGenerateContentSetup`)
- `GET /api/gemini-live` (expects HTTP 426 without Upgrade)
- WebSocket `/api/gemini-live` (text `{"setupComplete":{}}`, not `[object Blob]`)
- `POST /api/detect-question` (and `mode: "question-start"` for manual extract)
- `GET /api/config` includes `templates`
- `GET /api/profiles` (seed ids `james`, `wing`)
- `GET /api/profiles/james` (bytes only; markdown is never printed)
- `PUT /api/profiles/james` with a **synthetic ~25KB** profile **only when that key is empty** and the smoke target is localhost (or `SMOKE_SEED_PROFILE=1`)
- `POST /api/answer` for `claude-opus-5-5` and `claude-sonnet-5-5`, including **time-to-first-token**
- `POST /api/answer` with `profileId=james` twice: cache **write** then cache **read** TTFT (`cache_creation_input_tokens` / `cache_read_input_tokens`)

## Candidate profiles (Workers KV)

This repo is **public**. Never commit CV / profile markdown. Keep files under gitignored `/profiles/` (or anywhere outside the repo) and upload them to KV.

### 1. Create the namespace

```bash
npx wrangler kv namespace create PROFILES
```

Copy the printed `id` into `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "PROFILES",
    "id": "<NAMESPACE_ID>"
  }
]
```

Then deploy so the Worker can read `env.PROFILES`. `wrangler dev` uses **local** KV by default and does not read production keys. Do not set `"remote": true` on this binding unless you intend to read/write live profiles from your laptop.

### 2. Seed keys `profile:james` and `profile:wing`

Value = markdown body (up to ~200KB). Metadata = display name.

```bash
# files stay local; /profiles/ is gitignored
npx wrangler kv key put --binding=PROFILES --remote \
  --path ./profiles/james.md profile:james \
  --metadata '{"name":"James"}'

npx wrangler kv key put --binding=PROFILES --remote \
  --path ./profiles/wing.md profile:wing \
  --metadata '{"name":"Wing"}'
```

Or paste / upload `.md` / `.txt` in **Settings → Candidate profile** after deploy (`PUT /api/profiles/:id`, Access-protected).

### 3. APIs (all `/api/*`, Access)

| Method | Path | Body / result |
| --- | --- | --- |
| `GET` | `/api/profiles` | `{ profiles: [{ id, name }] }` — always `james` and `wing` |
| `GET` | `/api/profiles/:id` | `{ id, name, markdown }` |
| `PUT` | `/api/profiles/:id` | `{ markdown, name? }` → `{ id, name, markdown, bytes }` (413 if over 200KiB) |

`POST /api/answer` loads the selected profile **server-side** via `ProfileLoader` (`kvProfileLoader` today). The profile is a separate Anthropic system block with `cache_control: { type: "ephemeral" }` so a 20–30KB CV stays in the prompt cache; extra notes / role context sit **after** that block and do not bust the prefix. Swap `kvProfileLoader` for a retrieval memory (e.g. Hindsight) later without changing the client.

Settings: **Candidate profile** = James / Wing / None (main source). The old CV textarea is **Extra notes (override)** in `localStorage` only.

## Translation fallback

1. Azure Translator if `AZURE_TRANSLATOR_KEY` is set.
2. Else Gemini `GEMINI_TRANSLATE_MODEL` (`gemini-3.5-flash-lite`) via `GEMINI_API_KEY`, including Cantonese (`yue` / `zh-HK`, 口語粵語 / Traditional) and the two UI target languages. Gemini Live translate to Cantonese uses the same 口語 instruction (嘅/咗/唔), not 書面語.

## Question detector

Default: TypeSafe **Jev** (`POST /v1/systemone`) with parallel Noul + Choice questions (see `worker/src/detect-question.ts`). Threshold is in Settings (default `0.7`).

If `TYPESAFE_API_KEY` is missing, or Jev returns 429/5xx/529, the Worker cools down Jev for **5 minutes** and falls back to Claude. The client `QuestionDetector` interface is the plug point for a later external service.

Manual **Answer now** with auto-detect off posts `mode: "question-start"` so Jev can point at where the current question *starts* (preamble included). If Jev is unavailable, the client sends the full generous window (90–120s, or back to the previous answer, capped at 3 minutes) and Claude extracts. Extraction must include preamble and all sub-parts (never truncate).

## Session templates

Presets live in `shared/sessionTemplates.ts` (add an entry there to ship a new type). The main bar and Settings expose the same dropdown; the id is stored in `localStorage` and sent as `templateId` on `POST /api/answer`.

| Id | Behaviour |
| --- | --- |
| `interview-screening` | ~30 min screening; short conversational answers |
| `interview-ai-timed` | Optional 1/2/3 min speak countdown; answers sized to the clock |
| `interview-competency` | Default. STAR / key points (previous AI Answer behaviour) |
| `interview-oneway-video` | HireVue / Sapia / Willo / Spark Hire: 30s prep + 3:00 record, 250–330 word STAR, keyword bullets, prominent on-screen question box |
| `meeting` | Not an interview: summary, suggested reply, action items. Auto-detect off by default |

**Auto-detect** is a visible On/Off switch on the AI Answer panel (hotkey `D`) and can change mid-session. Type a question in the panel (Enter submits, Shift+Enter newline, hotkey `Q` focuses). One-way AI video makes that box prominent because questions are often on-screen text.
