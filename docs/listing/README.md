# Web listing material

[web.json](web.json) holds the current web copy and [the candidate release note](../../releases/1.0.0.md) supplies its change text. The app remains free and owner-only. Neither file claims a public launch or a deployed version.

The screenshots show the existing local production build, at 1440 × 1000 and 390 × 844 viewports, with one explicitly synthetic saved transcript. They do not show provider output, a real account or a live release. Captions and source/build hashes are in [screenshots/capture.json](screenshots/capture.json). No visual design or image composition was added.

To reproduce, build with `npm ci`, `npm --prefix client ci` and `npm run build`, then serve `client/dist` on a loopback-only HTTP server. Run `node scripts/capture-listing.mjs http://127.0.0.1:PORT`. The script needs an installed Playwright module and Chromium; cloud sessions can set `PLAYWRIGHT_MODULE=/opt/codex/cua_node/lib/node_modules/playwright-core/index.mjs` and `CHROMIUM_EXECUTABLE=/usr/bin/chromium`. These are test tools, not runtime dependencies. Use a clean committed source for accepted captures. Requests outside the selected loopback origin, writes and unexpected APIs are blocked; config and empty profiles are synthetic local fixtures. The script never starts recording.

The remaining visual material is an approved RTT product icon. The repository's Vite logo is unrelated branding and is not reused as an RTT icon. Icon creation is outside this sweep's visual-design scope. Before public use, also refresh these screenshots against the actual verified release and record that release's SHA, version and health evidence. The legal routes and support evidence are tracked in #9 and #11; listing paths alone do not prove they are live.

`baseline.listing` stays `missing` until all required material and release acceptance are real. No owner waiver or exclusion is inferred. [The web check](../aso-seo/listing-2026-10-18.md) explains why store-only validators, public search submissions and invented ranking claims do not apply to the current private channel.
