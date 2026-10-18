# Real-Time Translation: web listing draft

Internal draft, prepared 18 October 2026. Refs #12. This text does not form a published listing or complete the listing baseline.

## Name

Real-Time Translation

## Short description

Live speech transcription and translation, with session templates and optional AI answers.

## Description

Real-Time Translation turns speech into a live transcript and translated text. Choose a session template for an interview or meeting, review saved transcripts in this browser, and use optional AI answers for questions in the session.

The web app currently runs for the owner behind Cloudflare Access. Public sign-up remains unavailable.

## Features in the current code

- Live speech recognition and translation, with multiple output languages.
- Session templates for screening, timed interviews, competency interviews, one-way video interviews and meetings.
- Type a question or extract one from the transcript. Optional detection can find questions for AI answers.
- Transcript history and settings stored in this browser.
- Candidate profiles protected by the web app's existing access controls.

The repository contains these features. A final listing needs proof from its release. This draft does not say the live app includes the latest repairs.

## Availability and price

The pricing model is free. The existing web address is `rtt.eugnel.com`, with access restricted to the owner. There is no announced public launch date or public sign-up.

## Release text

The manifest records no release version. There is no published “what's new” text for this draft. The verified release and its note will supply release copy, screenshots and evidence for each feature.

## Outstanding listing material

- A verified release version and channel availability.
- Privacy and terms pages, plus verified routing for the approved support address `rtt@eugnel.uk` (#9 and #11).
- The other required publication baseline items, including customer accounts and observability (#8 and #10).
- A product icon and screenshots of the verified existing interface, using synthetic transcript and profile data. These assets do not yet exist; visual design remains outside this sweep.

This draft includes no new visual assets or visual design. Legal and support page links and release dates remain unknown. It makes no accuracy guarantee or claim of permanent browser history.

## Evidence

- [Product manifest](../../product.yaml): owner-only `building` status, web domain, no recorded release version, current pricing model and missing listing baseline.
- [North star](../north-star.md): current owner-only use.
- [Repository README](../../readme.md) and [session templates](../../shared/sessionTemplates.ts): current feature descriptions and session types.
- [Deployment notes](../../DEPLOY.md): Cloudflare Access, provider boundaries and candidate profiles.

The product remains `building` with `baseline.listing: missing`. This is internal preparation for #12, not publication or a waiver.
