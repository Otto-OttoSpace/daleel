# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do **not** open a public issue.
- Preferred: GitHub → the repo's **Security** tab → **Report a vulnerability** (private advisory).
- Or email **work@ottospace.co**.

You'll get an acknowledgement as fast as possible, and coordinated disclosure once a fix is ready.

## What Daleel does with your code

Daleel is a static analyzer that runs entirely on your machine.

- **Offline / telemetry-free.** The default (static) analysis makes **no network calls** — nothing about your code, findings, or usage is ever sent anywhere. No analytics, no phone-home, no accounts.
- **Read-scoped & report-only.** It only reads the files/paths you point it at, and it **never edits your source** — Daleel is a readiness gate, not a codemod.
- **No secrets handling.** It parses source for RTL / font / a11y patterns; it does not read `.env` files, credentials, or network resources.
- **`--render` (optional)** shapes your Arabic against a **bundled** reference font (or a local font you pass via `--font`) using HarfBuzz — still fully offline; nothing is downloaded.

## Supply chain

- Runtime dependencies are minimal and pinned (see `package.json`); a small `files` allowlist means only source + docs are published.
- Prefer a **pinned tag** — `npx github:Otto-OttoSpace/daleel@<tag>` — over a moving branch for reproducible, auditable runs.
- MIT-licensed; the full source is public and auditable.

## Supported versions

The latest published version receives fixes. Older 0.x versions are not maintained.
