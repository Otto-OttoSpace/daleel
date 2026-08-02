# Daleel · دليل

**Is your codebase ready for Saudi DGA design-system compliance?**

Saudi Arabia's Digital Government Authority publishes a unified design system for government services — **RTL-first, IBM Plex Sans Arabic, WCAG 2.2 AA**. **Daleel** ("guide") is an *advisory readiness gate*: it scans your code for the auto-checkable gaps and prints the manual checklist for the rest. It maps to the DGA design system as published — confirm against the current DGA spec for your project; Daleel is not a legal opinion.

It is **AST-verified** (Babel for JS/TS/JSX, PostCSS for CSS), so a utility inside a comment, string or identifier is never mis-flagged — and it is **report-only**: Daleel is a readiness *gate*, it never edits your source.

```bash
npx daleel .                 # DGA readiness report
npx daleel . --json          # machine-readable (CI)
npx daleel . --render        # + HarfBuzz font-proof: shape the Arabic and PROVE
                             #   the DGA font covers + joins it (not just named)
npx daleel . --render --font public/fonts/IBMPlexSansArabic-Regular.ttf
```

> `dls-check` still works as a bin alias if you were using the old name.

## What it checks
- **RTL-first (RTL)** — physical CSS/Tailwind (`ml-4`, `md:ml-4`, `text-left`, `space-x-4`, `left-0`, `rounded-l`, `margin-left`, arbitrary `[margin-left:…]`, hard-coded `dir="ltr"` / `direction: ltr`) that breaks the DGA's RTL default. Variant-prefixed utilities (`md:`, `hover:`, `rtl:`) are caught.
- **Font (FONT)** — flags a font stack that names a font but **not** IBM Plex Sans Arabic (the DGA-recommended family). Quote-aware: `font-family: "IBM Plex Sans Arabic", sans-serif` is *compliant* and never flagged; icon and code/monospace fonts (Font Awesome, Fira Code, monospace…) are never flagged.
- **Font-proof (`--render`, optional)** — the static check only proves the DGA font is *named*. `--render` goes further: it shapes the actual Arabic in your source with [HarfBuzz](https://harfbuzz.github.io/) and proves a real font file **covers** every Arabic char (no ▯ tofu) and does real **contextual joining** — catching a Latin face mislabeled as Arabic. Rule `font-no-arabic-coverage`. Optional deps (`harfbuzzjs` + `fontkit`); ships a reference Arabic face so it runs out of the box, or point `--font` / `.daleelrc.json`'s `"fontFile"` at the webfont you ship. The default static tier stays dependency-light.
- **WCAG 2.2 AA (A11Y)** — missing `alt` on `<img>`/`<Image>`, missing `lang` on `<html>`/`<Html>` (JSX-aware; skips spread-prop elements it can't verify).
- **+ a manual checklist** for what a scanner can't verify (official DGA tokens/components, contrast, keyboard nav, AR⇄EN parity).

## Suppress & configure
- Inline: `// daleel-ignore` (this line) or `// daleel-ignore-next-line`. Narrow it: `// daleel-ignore FONT` or `// daleel-ignore rtl-physical-utility`.
- Config (`.daleelrc.json` / `daleel.config.json`, or `--config <path>`):
  ```json
  { "fonts": ["My Brand Arabic"], "ignore": ["legacy/**", "**/*.stories.tsx"], "disable": ["A11Y"], "fontFile": "public/fonts/IBMPlexSansArabic-Regular.ttf" }
  ```
  `fonts` = extra approved families · `ignore` = path globs to skip · `disable` = categories or rule names to silence · `fontFile` = the actual DGA font file `--render` shapes against.

## In your AI agent (MCP)
```json
{ "mcpServers": { "daleel": { "command": "npx", "args": ["-y","-p","github:Otto-OttoSpace/daleel","daleel-mcp"] } } }
```
Tools: `daleel_scan`, `daleel_check_code` (`dls_scan` / `dls_check_code` still work as aliases).

## For agencies
Building Saudi-government digital services? Run this in CI so every PR answers "does it pass DGA?" — the one question a compliance audit hinges on.

## Develop
```bash
npm install
npm test        # node --test regression corpus (input + expected-findings)
```

---
Part of **[Otto](https://dev.ottospace.co)**. MIT © 2026

## 💛 Support & commercial use

The Miraat suite is free and open-source (MIT). If it helps you ship correct Arabic/RTL, please consider [sponsoring on GitHub](https://github.com/sponsors/Otto-OttoSpace) — it funds maintenance and new rules.

Using it in a commercial product, in CI, or need the private **DGA compliance** rule pack? A **Miraat Pro** commercial licence — commercial use, a hosted CI audit that gates PRs ([miraat-action](https://github.com/Otto-OttoSpace/miraat-action)), and priority support — is available. Email **work@ottospace.co** and we'll set you up.
