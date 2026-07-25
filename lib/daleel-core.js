'use strict';
/*
 * Daleel core — Saudi DGA (Digital Government Authority) design-system readiness
 * detection. REPORT-ONLY: Daleel is a compliance gate, not a codemod. Every
 * finding is advisory; Daleel never edits your source.
 *
 * The "zero mistakes" architecture:
 *   - JS / TS / JSX / TSX is parsed with Babel and only className/class strings,
 *     class-combining helpers (cn/clsx/cva…), inline-style objects and JSX
 *     elements are inspected — so a physical utility inside a comment, an
 *     identifier, or an unrelated string is NEVER flagged.
 *   - CSS / SCSS / LESS is walked with PostCSS (decl tree) — comments can't fire.
 *   - Markup (.html/.vue/.svelte/.astro) uses bounded class-attribute regex over
 *     an HTML-comment-masked source.
 *   - If a parser is missing or the source doesn't parse, Daleel falls back to a
 *     comment/string-masked regex so it degrades safely — it never throws.
 *
 * Categories: RTL (RTL-first) · FONT (IBM Plex Sans Arabic) · A11Y (WCAG 2.1 AA).
 */
const path = require('path');

let babelParser, babelTraverse, postcss;
try { babelParser = require('@babel/parser'); } catch { babelParser = null; }
try { const t = require('@babel/traverse'); babelTraverse = t.default || t; } catch { babelTraverse = null; }
try { postcss = require('postcss'); } catch { postcss = null; }

const JS_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const CSS_EXT = new Set(['.css', '.scss', '.less', '.pcss']);
const MARKUP_EXT = new Set(['.html', '.htm', '.vue', '.svelte', '.astro']);

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
const MSG = {
  logical: 'not RTL-safe — DGA is RTL-first; use logical utilities (ms-/me-/ps-/pe-/start-/end-)',
  space: 'horizontal spacing flips under RTL — DGA is RTL-first; use gap/logical spacing or *-x-reverse',
  corner: 'physical corner — DGA is RTL-first; use logical corners (rounded-ss/se/ee/es)',
  cssProp: 'physical CSS property — DGA is RTL-first; use logical (margin-inline-*, inset-inline-*)',
  cssVal: 'physical CSS value — DGA is RTL-first; use logical (start/end, inline-start/inline-end)',
  cssCorner: 'physical corner radius — DGA is RTL-first; use border-start-start-radius…',
  jsStyle: 'physical inline-style property — DGA is RTL-first; use the *Inline* logical form',
  dir: 'hard-coded LTR — DGA defaults RTL; derive direction from the locale',
  font: 'DGA mandates "IBM Plex Sans Arabic" — this stack names a font but not the DGA family',
  imgAlt: 'missing alt attribute (WCAG 2.1 AA)',
  htmlLang: 'missing lang attribute (WCAG / DGA bilingual)',
};

// ---------------------------------------------------------------------------
// Fonts (FONT) — flag a stack that NAMES a font but not an approved DGA family.
// This is the corrected, quote-aware check (the old regex captured only the
// whitespace before the opening quote, inverting the result).
// ---------------------------------------------------------------------------
const DGA_FONTS_DEFAULT = ['ibm plex sans arabic'];
const GENERIC_FONTS = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji',
  'fangsong', 'inherit', 'initial', 'revert', 'revert-layer', 'unset',
  '-apple-system', 'blinkmacsystemfont',
]);
function fontDeclNeedsDGA(value, approved) {
  const families = String(value).split(',')
    .map(f => f.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(Boolean);
  if (!families.length) return false;
  const hasNamed = families.some(f => !GENERIC_FONTS.has(f));
  const hasDGA = families.some(f => approved.has(f));
  return hasNamed && !hasDGA;
}

// ---------------------------------------------------------------------------
// Tailwind physical utilities (RTL) — variant-prefix aware.
// ---------------------------------------------------------------------------
// Strip leading responsive/state variants (md:, hover:, rtl:, dark:,
// group-hover:, peer-focus:, [&:hover]: …) so the bare utility is what we test.
function stripVariants(tok) {
  let s = tok;
  for (;;) {
    const m = s.match(/^(?:[\w-]+|\[[^\]]*\]):/);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  return s;
}

const PHYS_CSS_PROPS = new Set([
  'margin-left', 'margin-right', 'padding-left', 'padding-right',
  'border-left', 'border-right',
  'border-left-width', 'border-right-width',
  'border-left-color', 'border-right-color',
  'border-left-style', 'border-right-style',
  'left', 'right',
]);

// [re, kind]. `kind` selects the message. Order doesn't matter (first match wins).
const PHYS_UTIL_MATCHERS = [
  [/^-?m[lr]-/, 'logical'],                    // ml-4  mr-2  -ml-1
  [/^-?p[lr]-/, 'logical'],                    // pl-4  pr-2
  [/^-?(?:left|right)-/, 'logical'],           // left-0 right-full  (inset)
  [/^text-(?:left|right)$/, 'logical'],        // text-left / text-right
  [/^float-(?:left|right)$/, 'logical'],       // float-left / float-right
  [/^clear-(?:left|right)$/, 'logical'],       // clear-left / clear-right
  [/^-?scroll-m[lr]-/, 'logical'],             // scroll-ml-2
  [/^-?scroll-p[lr]-/, 'logical'],             // scroll-pl-2
  [/^-?space-x-/, 'space'],                    // space-x-4  (flips in RTL)
  [/^-?divide-x(?:-|$)/, 'space'],             // divide-x / divide-x-2
  [/^-?rounded-(?:l|r|tl|tr|bl|br)(?:-|$)/, 'corner'], // rounded-l  rounded-tr-lg
  [/^-?border-(?:l|r)(?:-|$)/, 'logical'],     // border-l  border-r-2
];

// Returns a `kind` string (logical|space|corner) or null.
function physicalUtil(tok) {
  let u = stripVariants(tok);
  if (u.startsWith('!')) u = u.slice(1);
  // Arbitrary property: [margin-left:3px]
  const arb = u.match(/^\[([a-z-]+)\s*:/i);
  if (arb) return PHYS_CSS_PROPS.has(arb[1].toLowerCase()) ? 'logical' : null;
  if (u === 'space-x-reverse' || u === 'divide-x-reverse') return null; // these ARE the RTL fix
  for (const [re, kind] of PHYS_UTIL_MATCHERS) if (re.test(u)) return kind;
  return null;
}
function utilRule(kind) {
  return kind === 'corner' ? 'rtl-physical-corner' : kind === 'space' ? 'rtl-space-x' : 'rtl-physical-utility';
}

// class-combining helpers whose string args are class lists
const CLASS_UTILS = new Set(['cn', 'clsx', 'classnames', 'classNames', 'cx', 'cva', 'tv', 'tw', 'twMerge', 'twJoin']);
const CLASS_TAGS = new Set(['tw', 'css']);

// Inline-style physical property names (camelCase, JS)
const STYLE_PHYS = new Set([
  'marginLeft', 'marginRight', 'paddingLeft', 'paddingRight',
  'borderLeft', 'borderRight',
  'borderLeftWidth', 'borderRightWidth',
  'borderLeftColor', 'borderRightColor',
  'borderLeftStyle', 'borderRightStyle',
  'left', 'right',
]);
const DIR_VAL = new Set(['left', 'right']);

// ---------------------------------------------------------------------------
// Regexes (used by markup + as safe fallbacks). font-family capture is
// quote-tolerant and stops at ; } newline or backtick — the corrected form.
// ---------------------------------------------------------------------------
const FONT_DECL_RE = /font-family\s*:\s*([^;}\n`]+)/gi;
const DIRECTION_LTR_RE = /\bdirection\s*:\s*["'`]?\s*ltr\b/gi;
const DIR_LTR_ATTR_RE = /\bdir\s*=\s*["']ltr["']/gi;
const IMG_NO_ALT_RE = /<img\b(?![^>]*\balt[\s=])[^>]*>/gi;
const HTML_NO_LANG_RE = /<html\b(?![^>]*\blang[\s=])[^>]*>/gi;
const CLASS_ATTR_RE = /\b(?:class|className)\s*=\s*(["'])((?:(?!\1).)*)\1/g;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}
function ev(s) { return String(s).trim().replace(/\s+/g, ' ').slice(0, 60); }

// Blank out //, /* */ comments (JS/TS), preserving length & newlines, respecting
// strings so `//` inside a string is not treated as a comment start.
function maskJsComments(src) {
  const a = src.split('');
  let mode = 'code';
  for (let i = 0; i < a.length; i++) {
    const c = a[i], d = a[i + 1];
    if (mode === 'code') {
      if (c === '/' && d === '/') { a[i] = a[i + 1] = ' '; mode = 'line'; i++; continue; }
      if (c === '/' && d === '*') { a[i] = a[i + 1] = ' '; mode = 'block'; i++; continue; }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
    } else if (mode === 'line') {
      if (c === '\n') mode = 'code'; else a[i] = ' ';
    } else if (mode === 'block') {
      if (c === '*' && d === '/') { a[i] = a[i + 1] = ' '; i++; mode = 'code'; }
      else if (c !== '\n') a[i] = ' ';
    } else if (mode === 'sq') { if (c === '\\') i++; else if (c === "'" || c === '\n') mode = 'code'; }
    else if (mode === 'dq') { if (c === '\\') i++; else if (c === '"' || c === '\n') mode = 'code'; }
    else if (mode === 'tpl') { if (c === '\\') i++; else if (c === '`') mode = 'code'; }
  }
  return a.join('');
}
// Blank out <!-- --> HTML comments, preserving newlines & length.
function maskHtmlComments(src) {
  return src.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
}

// ---------------------------------------------------------------------------
// Inline-ignore: `daleel-ignore` on a line suppresses findings on that line;
// `daleel-ignore-next-line` suppresses the following line. An optional
// comma/space list of categories or rules narrows it (else all).
// ---------------------------------------------------------------------------
const KNOWN_CATS = new Set(['RTL', 'FONT', 'A11Y']);
const RULE_SHAPE = /^[a-z][a-z0-9-]*-[a-z0-9-]+$/; // e.g. rtl-physical-utility, font-not-dga
function ignoreMap(src) {
  const map = new Map(); // 1-based line -> true | Set<UPPER>
  const lines = src.split('\n');
  const add = (ln, spec) => {
    if (ln < 1) return;
    if (map.get(ln) === true) return;
    if (spec === true) { map.set(ln, true); return; }
    const s = map.get(ln) || new Set();
    for (const r of spec) s.add(r);
    map.set(ln, s);
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/daleel-ignore(-next-line)?\b([^\n]*)/);
    if (!m) continue;
    // A marker on its own line (only whitespace + a comment opener before it)
    // applies to the NEXT line; a trailing comment applies to its own line.
    const standalone = /^\s*(?:\/\/|\/\*|\{\s*\/\*|<!--|\*)?\s*$/.test(lines[i].slice(0, m.index));
    const target = (m[1] || standalone) ? i + 2 : i + 1;
    // A trailing list of KNOWN categories / rule-names narrows the suppression;
    // anything else (prose, a reason) leaves it as ignore-all. Tokens stop at
    // punctuation, so "// daleel-ignore (temporary)" ignores the whole line.
    const toks = (m[2] || '').replace(/\*\/|-->/g, ' ').split(/[,\s]+/).filter(Boolean);
    const rules = toks.filter(t => KNOWN_CATS.has(t.toUpperCase()) || RULE_SHAPE.test(t)).map(t => t.toUpperCase());
    add(target, rules.length ? rules : true);
  }
  return map;
}
function isIgnored(map, f) {
  const v = map.get(f.line);
  if (!v) return false;
  if (v === true) return true;
  return v.has(f.cat) || v.has(f.rule.toUpperCase());
}

// ---------------------------------------------------------------------------
// JS / TS / JSX / TSX (Babel AST). Returns true if parsed, false otherwise.
// ---------------------------------------------------------------------------
function babelPlugins(ext) {
  const p = [];
  if (ext === '.ts' || ext === '.tsx') p.push('typescript');
  if (ext !== '.ts') p.push('jsx');
  return p;
}
function scanJsAst(src, ext, findings, approved) {
  if (!babelParser || !babelTraverse) return false;
  let ast;
  try {
    ast = babelParser.parse(src, { sourceType: 'unambiguous', allowReturnOutsideFunction: true, plugins: babelPlugins(ext) });
  } catch { return false; }

  const seen = new Set();
  const push = (cat, rule, line, from, msg) => {
    const k = rule + ':' + line + ':' + from;
    if (seen.has(k)) return; seen.add(k);
    findings.push({ cat, rule, line, from: ev(from), msg });
  };
  const classTokens = (raw, line) => {
    for (const tok of raw.split(/\s+/)) {
      if (!tok || tok.includes('${') || tok.includes('{') || tok.includes('}')) continue;
      const kind = physicalUtil(tok);
      if (kind) push('RTL', utilRule(kind), line, tok, MSG[kind]);
    }
  };
  const utilCallee = (callee) => {
    if (!callee) return false;
    if (callee.type === 'Identifier') return CLASS_UTILS.has(callee.name);
    if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') return CLASS_UTILS.has(callee.property.name);
    return false;
  };
  const utilTag = (tag) => tag && tag.type === 'Identifier' && CLASS_TAGS.has(tag.name);
  const isClassContext = (p) => {
    let n = p.parentPath;
    if (n && n.isJSXExpressionContainer && n.isJSXExpressionContainer()) n = n.parentPath;
    if (n && n.isJSXAttribute && n.isJSXAttribute()) {
      const an = n.node.name && n.node.name.name;
      if (an === 'className' || an === 'class') return true;
    }
    return !!p.findParent(pp =>
      (pp.isCallExpression && pp.isCallExpression() && utilCallee(pp.node.callee)) ||
      (pp.isTaggedTemplateExpression && pp.isTaggedTemplateExpression() && utilTag(pp.node.tag)));
  };
  const styleObject = (objExpr) => {
    for (const prop of objExpr.properties) {
      if (prop.type !== 'ObjectProperty' || prop.computed) continue;
      const k = prop.key;
      const keyName = k.type === 'Identifier' ? k.name : (k.type === 'StringLiteral' ? k.value : null);
      if (!keyName) continue;
      const line = k.loc.start.line;
      if (STYLE_PHYS.has(keyName)) push('RTL', 'rtl-js-style', line, keyName, MSG.jsStyle);
      if ((keyName === 'textAlign' || keyName === 'float' || keyName === 'clear') &&
        prop.value.type === 'StringLiteral' && DIR_VAL.has(prop.value.value))
        push('RTL', 'rtl-js-style', prop.value.loc.start.line, keyName + ': ' + prop.value.value, MSG.jsStyle);
      if (keyName === 'fontFamily' && prop.value.type === 'StringLiteral' && fontDeclNeedsDGA(prop.value.value, approved))
        push('FONT', 'font-not-dga', prop.value.loc.start.line, prop.value.value, MSG.font);
    }
  };

  babelTraverse(ast, {
    StringLiteral(p) {
      if (isClassContext(p)) classTokens(p.node.value, p.node.loc.start.line);
    },
    TemplateElement(p) {
      const tl = p.parentPath;
      if (!tl || !tl.isTemplateLiteral() || tl.node.expressions.length !== 0) return;
      if (isClassContext(tl)) classTokens(p.node.value.raw, p.node.loc.start.line);
    },
    JSXAttribute(p) {
      if (p.node.name.name !== 'style') return;
      const v = p.node.value;
      if (v && v.type === 'JSXExpressionContainer' && v.expression && v.expression.type === 'ObjectExpression') styleObject(v.expression);
    },
    ObjectProperty(p) {
      const k = p.node.key;
      const keyName = k.type === 'Identifier' ? k.name : (k.type === 'StringLiteral' ? k.value : null);
      if (keyName === 'fontFamily' && p.node.value.type === 'StringLiteral' && fontDeclNeedsDGA(p.node.value.value, approved))
        push('FONT', 'font-not-dga', p.node.value.loc.start.line, p.node.value.value, MSG.font);
    },
    JSXOpeningElement(p) {
      const nameNode = p.node.name;
      const name = nameNode.type === 'JSXIdentifier' ? nameNode.name : null;
      if (!name) return;
      const attrs = p.node.attributes || [];
      const hasSpread = attrs.some(a => a.type === 'JSXSpreadAttribute');
      const attrNames = new Set(attrs.filter(a => a.type === 'JSXAttribute').map(a => a.name && a.name.name));
      const line = p.node.loc.start.line;
      if ((name === 'img' || name === 'Image') && !hasSpread && !attrNames.has('alt'))
        push('A11Y', 'a11y-img-alt', line, '<' + name + '>', MSG.imgAlt);
      if ((name === 'html' || name === 'Html') && !hasSpread && !attrNames.has('lang'))
        push('A11Y', 'a11y-html-lang', line, '<' + name + '>', MSG.htmlLang);
      for (const a of attrs)
        if (a.type === 'JSXAttribute' && a.name.name === 'dir' && a.value && a.value.type === 'StringLiteral' && /^ltr$/i.test(a.value.value))
          push('RTL', 'rtl-hardcoded-dir', line, 'dir="ltr"', MSG.dir);
    },
  });
  return true;
}

// CSS-in-JS font-family / direction that lives inside template/string literals
// (AST scoping above only covers className + style objects). Masked so comments
// never fire. Deduped by the caller's `seen`-equivalent via findings identity.
function scanJsCssInJs(src, findings, approved) {
  const masked = maskJsComments(src);
  let m;
  FONT_DECL_RE.lastIndex = 0;
  while ((m = FONT_DECL_RE.exec(masked))) {
    if (fontDeclNeedsDGA(m[1], approved))
      findings.push({ cat: 'FONT', rule: 'font-not-dga', line: lineAt(masked, m.index), from: ev(m[1]), msg: MSG.font });
  }
  DIRECTION_LTR_RE.lastIndex = 0;
  while ((m = DIRECTION_LTR_RE.exec(masked)))
    findings.push({ cat: 'RTL', rule: 'rtl-hardcoded-dir', line: lineAt(masked, m.index), from: ev(m[0]), msg: MSG.dir });
}

// Fallback when Babel is unavailable or the file doesn't parse: masked-regex.
function scanJsFallback(src, findings, approved) {
  const masked = maskJsComments(src);
  let m;
  CLASS_ATTR_RE.lastIndex = 0;
  while ((m = CLASS_ATTR_RE.exec(masked))) {
    const raw = m[2];
    if (/[{}$<]/.test(raw)) continue;
    const line = lineAt(masked, m.index);
    for (const tok of raw.split(/\s+/)) {
      const kind = tok && physicalUtil(tok);
      if (kind) findings.push({ cat: 'RTL', rule: utilRule(kind), line, from: ev(tok), msg: MSG[kind] });
    }
  }
  DIR_LTR_ATTR_RE.lastIndex = 0;
  while ((m = DIR_LTR_ATTR_RE.exec(masked)))
    findings.push({ cat: 'RTL', rule: 'rtl-hardcoded-dir', line: lineAt(masked, m.index), from: 'dir="ltr"', msg: MSG.dir });
  IMG_NO_ALT_RE.lastIndex = 0;
  while ((m = IMG_NO_ALT_RE.exec(masked)))
    findings.push({ cat: 'A11Y', rule: 'a11y-img-alt', line: lineAt(masked, m.index), from: '<img>', msg: MSG.imgAlt });
}

// ---------------------------------------------------------------------------
// CSS (PostCSS)
// ---------------------------------------------------------------------------
const CSS_CORNER = new Set(['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius']);
const CSS_VALUE_PROP = { 'text-align': DIR_VAL, float: DIR_VAL, clear: DIR_VAL };
function scanCss(src, findings, approved) {
  if (!postcss) return false;
  let root;
  try { root = postcss.parse(src); } catch { return false; }
  root.walkDecls(decl => {
    const prop = decl.prop.toLowerCase();
    const line = decl.source && decl.source.start ? decl.source.start.line : 1;
    if (prop === 'direction' && /^ltr$/i.test(decl.value.trim())) {
      findings.push({ cat: 'RTL', rule: 'rtl-hardcoded-dir', line, from: 'direction: ' + decl.value.trim(), msg: MSG.dir }); return;
    }
    if (prop === 'font-family') {
      if (fontDeclNeedsDGA(decl.value, approved))
        findings.push({ cat: 'FONT', rule: 'font-not-dga', line, from: ev(decl.value), msg: MSG.font });
      return;
    }
    if (PHYS_CSS_PROPS.has(prop)) {
      findings.push({ cat: 'RTL', rule: 'rtl-css-physical', line, from: decl.prop, msg: MSG.cssProp }); return;
    }
    if (CSS_CORNER.has(prop)) {
      findings.push({ cat: 'RTL', rule: 'rtl-physical-corner', line, from: decl.prop, msg: MSG.cssCorner }); return;
    }
    if (CSS_VALUE_PROP[prop]) {
      const val = decl.value.trim().toLowerCase();
      if (CSS_VALUE_PROP[prop].has(val))
        findings.push({ cat: 'RTL', rule: 'rtl-css-physical', line, from: prop + ': ' + val, msg: MSG.cssVal });
    }
  });
  return true;
}
// Fallback for exotic SCSS/LESS that PostCSS can't parse.
function scanCssFallback(src, findings, approved) {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i].replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    let m;
    const pp = /\b(margin|padding|border)-(left|right)\b|(?<![-\w])(left|right)\s*:/gi;
    while ((m = pp.exec(ln))) findings.push({ cat: 'RTL', rule: 'rtl-css-physical', line: i + 1, from: ev(m[0].replace(/:\s*$/, '')), msg: MSG.cssProp });
    const ta = /text-align\s*:\s*(left|right)|\b(float|clear)\s*:\s*(left|right)/gi;
    while ((m = ta.exec(ln))) findings.push({ cat: 'RTL', rule: 'rtl-css-physical', line: i + 1, from: ev(m[0]), msg: MSG.cssVal });
    FONT_DECL_RE.lastIndex = 0;
    while ((m = FONT_DECL_RE.exec(ln))) if (fontDeclNeedsDGA(m[1], approved)) findings.push({ cat: 'FONT', rule: 'font-not-dga', line: i + 1, from: ev(m[1]), msg: MSG.font });
    DIRECTION_LTR_RE.lastIndex = 0;
    while ((m = DIRECTION_LTR_RE.exec(ln))) findings.push({ cat: 'RTL', rule: 'rtl-hardcoded-dir', line: i + 1, from: ev(m[0]), msg: MSG.dir });
  }
}

// ---------------------------------------------------------------------------
// Markup (.html/.vue/.svelte/.astro) — bounded class-attr regex over an
// HTML-comment-masked source.
// ---------------------------------------------------------------------------
function scanMarkup(src, findings, approved) {
  const masked = maskHtmlComments(src);
  let m;
  CLASS_ATTR_RE.lastIndex = 0;
  while ((m = CLASS_ATTR_RE.exec(masked))) {
    const raw = m[2];
    if (/[{}$<]/.test(raw)) continue; // binding / template artefact
    const valStart = m.index + m[0].length - 1 - raw.length;
    const line = lineAt(masked, valStart);
    for (const tok of raw.split(/\s+/)) {
      const kind = tok && physicalUtil(tok);
      if (kind) findings.push({ cat: 'RTL', rule: utilRule(kind), line, from: ev(tok), msg: MSG[kind] });
    }
  }
  FONT_DECL_RE.lastIndex = 0;
  while ((m = FONT_DECL_RE.exec(masked))) if (fontDeclNeedsDGA(m[1], approved)) findings.push({ cat: 'FONT', rule: 'font-not-dga', line: lineAt(masked, m.index), from: ev(m[1]), msg: MSG.font });
  DIRECTION_LTR_RE.lastIndex = 0;
  while ((m = DIRECTION_LTR_RE.exec(masked))) findings.push({ cat: 'RTL', rule: 'rtl-hardcoded-dir', line: lineAt(masked, m.index), from: ev(m[0]), msg: MSG.dir });
  DIR_LTR_ATTR_RE.lastIndex = 0;
  while ((m = DIR_LTR_ATTR_RE.exec(masked))) findings.push({ cat: 'RTL', rule: 'rtl-hardcoded-dir', line: lineAt(masked, m.index), from: 'dir="ltr"', msg: MSG.dir });
  IMG_NO_ALT_RE.lastIndex = 0;
  while ((m = IMG_NO_ALT_RE.exec(masked))) { if (/\{[^}]*\}/.test(m[0])) continue; findings.push({ cat: 'A11Y', rule: 'a11y-img-alt', line: lineAt(masked, m.index), from: '<img>', msg: MSG.imgAlt }); }
  HTML_NO_LANG_RE.lastIndex = 0;
  while ((m = HTML_NO_LANG_RE.exec(masked))) { if (/\{[^}]*\}/.test(m[0])) continue; findings.push({ cat: 'A11Y', rule: 'a11y-html-lang', line: lineAt(masked, m.index), from: '<html>', msg: MSG.htmlLang }); }
}

// ---------------------------------------------------------------------------
// Sort + dedupe
// ---------------------------------------------------------------------------
const CAT_ORDER = { RTL: 0, FONT: 1, A11Y: 2 };
function sortDedupe(findings) {
  findings.sort((a, b) =>
    a.line - b.line ||
    (CAT_ORDER[a.cat] - CAT_ORDER[b.cat]) ||
    a.rule.localeCompare(b.rule) ||
    a.from.localeCompare(b.from));
  const seen = new Set();
  return findings.filter(f => {
    const k = [f.cat, f.rule, f.line, f.from].join('|');
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}

// ---------------------------------------------------------------------------
// Public entry.  opts: { fonts?: string[] (extra approved families),
//                        disable?: string[] (categories or rules to drop) }
// ---------------------------------------------------------------------------
function scanSource(file, src, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  const approved = new Set(DGA_FONTS_DEFAULT);
  for (const f of opts.fonts || []) approved.add(String(f).trim().toLowerCase());
  const disable = new Set((opts.disable || []).map(s => String(s).toUpperCase()));

  let findings = [];
  if (JS_EXT.has(ext)) {
    if (!scanJsAst(src, ext, findings, approved)) scanJsFallback(src, findings, approved);
    scanJsCssInJs(src, findings, approved);
  } else if (CSS_EXT.has(ext)) {
    if (!scanCss(src, findings, approved)) scanCssFallback(src, findings, approved);
  } else if (MARKUP_EXT.has(ext)) {
    scanMarkup(src, findings, approved);
  } else {
    return { findings: [] };
  }

  const ign = ignoreMap(src);
  findings = findings.filter(f => !isIgnored(ign, f) && !disable.has(f.cat) && !disable.has(f.rule.toUpperCase()));
  findings = sortDedupe(findings);
  return { findings };
}

module.exports = {
  scanSource,
  // exported for tests / reuse
  fontDeclNeedsDGA, physicalUtil, stripVariants,
  JS_EXT, CSS_EXT, MARKUP_EXT,
};
