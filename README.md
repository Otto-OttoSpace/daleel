# dls-check

**Is your codebase ready for Saudi DGA design-system compliance?**

Saudi Arabia's Digital Government Authority mandates one unified design system for every ministry — **RTL-first, IBM Plex Sans Arabic, WCAG 2.1 AA** — and compliance is a *legal requirement* for government digital services. `dls-check` scans your code for the auto-checkable gaps and prints the manual checklist for the rest.

```bash
npx dls-check .              # DGA readiness report
npx dls-check . --json       # machine-readable (CI)
```

## What it checks
- **RTL-first** — physical CSS/Tailwind (`ml-`, `text-left`, `margin-left`, hard-coded `dir="ltr"`) that breaks the DGA's RTL default
- **Font** — flags stacks missing **IBM Plex Sans Arabic** (DGA-mandated)
- **WCAG 2.1 AA** (regex-checkable subset) — missing `alt`, missing `<html lang>`
- **+ a manual checklist** for what a scanner can't verify (official DGA tokens/components, contrast, keyboard nav, AR⇄EN parity)

## In your AI agent (MCP)
```json
{ "mcpServers": { "dls-check": { "command": "npx", "args": ["-y","-p","github:moradothmanepro-OTTO/dls-check","dls-check-mcp"] } } }
```
Tools: `dls_scan`, `dls_check_code`.

## For agencies
Building Saudi-government digital services? Run this in CI so every PR answers "does it pass DGA?" — the one question a compliance audit hinges on.

---
Part of **[Otto](https://dev.ottospace.co)**. MIT © 2026
