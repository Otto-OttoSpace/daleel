# Daleel · دليل

**Is your codebase ready for Saudi DGA design-system compliance?**

Saudi Arabia's Digital Government Authority mandates one unified design system for every ministry — **RTL-first, IBM Plex Sans Arabic, WCAG 2.1 AA** — and compliance is a *legal requirement* for government digital services. **Daleel** ("guide") scans your code for the auto-checkable gaps and prints the manual checklist for the rest.

It is **AST-verified** (Babel for JS/TS/JSX, PostCSS for CSS), so a utility inside a comment, string or identifier is never mis-flagged — and it is **report-only**: Daleel is a readiness *gate*, it never edits your source.

```bash
npx daleel .                 # DGA readiness report
npx daleel . --json          # machine-readable (CI)
```

> `dls-check` still works as a bin alias if you were using the old name.

## What it checks
- **RTL-first (RTL)** — physical CSS/Tailwind (`ml-4`, `md:ml-4`, `text-left`, `space-x-4`, `left-0`, `rounded-l`, `margin-left`, arbitrary `[margin-left:…]`, hard-coded `dir="ltr"` / `direction: ltr`) that breaks the DGA's RTL default. Variant-prefixed utilities (`md:`, `hover:`, `rtl:`) are caught.
- **Font (FONT)** — flags a font stack that names a font but **not** IBM Plex Sans Arabic (the DGA-mandated family). Quote-aware: `font-family: "IBM Plex Sans Arabic", sans-serif` is *compliant* and never flagged.
- **WCAG 2.1 AA (A11Y)** — missing `alt` on `<img>`/`<Image>`, missing `lang` on `<html>`/`<Html>` (JSX-aware; skips spread-prop elements it can't verify).
- **+ a manual checklist** for what a scanner can't verify (official DGA tokens/components, contrast, keyboard nav, AR⇄EN parity).

## Suppress & configure
- Inline: `// daleel-ignore` (this line) or `// daleel-ignore-next-line`. Narrow it: `// daleel-ignore FONT` or `// daleel-ignore rtl-physical-utility`.
- Config (`.daleelrc.json` / `daleel.config.json`, or `--config <path>`):
  ```json
  { "fonts": ["My Brand Arabic"], "ignore": ["legacy/**", "**/*.stories.tsx"], "disable": ["A11Y"] }
  ```
  `fonts` = extra approved families · `ignore` = path globs to skip · `disable` = categories or rule names to silence.

## In your AI agent (MCP)
```json
{ "mcpServers": { "daleel": { "command": "npx", "args": ["-y","-p","github:moradothmanepro-OTTO/dls-check","daleel-mcp"] } } }
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
