/**
 * Custom CSS check (customization 6). A small tokenizer, not regexes on the raw text: comments,
 * strings and escapes are resolved first, so `u\72l(` is still `url(`. Deny by default: only
 * the listed at-rules pass, every fetching function fails, and the whole sheet is refused on any problem.
 */

/** `key` is an i18n key under `appearance.css_errors`. */
export interface CssProblem {
  line: number;
  key: string;
}
export type Sanitized = { ok: true; css: string } | { ok: false; problems: CssProblem[] };

export const CSS_LIMITS = { bytes: 32 * 1024, rules: 1000, selector: 500, depth: 4, logical: 6, tokens: 20000, parens: 32 } as const;

const FETCHING = new Set([
  "url",
  "src",
  "image",
  "image-set",
  "-webkit-image-set",
  "element",
  "-moz-element",
  "paint",
  "cross-fade",
  "-webkit-cross-fade",
  "expression",
]);
const AT_RULES = new Set(["media", "supports", "keyframes", "-webkit-keyframes", "container"]);
const BANNED_PROPERTIES = new Set(["behavior", "-moz-binding"]);
const LOGICAL = new Set(["has", "not", "is", "where"]);
/** Selectors that must keep pointer events: the page itself and the guarded controls. */
const PROTECTED = /(^|[\s>+~,(])(\*|html|body|:root|#root)(?![\w-])|\[data-nuvo-guard/;

type Kind = "ident" | "function" | "at" | "string" | "ws" | "open" | "close" | "semicolon" | "colon" | "lparen" | "rparen" | "other";
interface Token {
  kind: Kind;
  /** Escapes decoded, lower-cased for names; the raw character otherwise. */
  value: string;
  line: number;
}

const isIdentChar = (c: string | undefined) => c !== undefined && (/[A-Za-z0-9_-]/.test(c) || c.charCodeAt(0) >= 0x80);
/** CSS Syntax 3: a backslash starts an escape unless a newline or the end of input follows it. */
const isEscape = (c: string | undefined, next: string | undefined) => c === "\\" && next !== undefined && next !== "\n" && next !== "\r" && next !== "\f";
const isIdentStart = (c: string | undefined, next: string | undefined, afterNext?: string) =>
  c !== undefined && (/[A-Za-z_]/.test(c) || c.charCodeAt(0) >= 0x80 || isEscape(c, next) || (c === "-" && (isIdentChar(next) || isEscape(next, afterNext))));

/** Reads an identifier at `start`, decoding `\hex ` and `\x` escapes. */
function readName(text: string, start: number): { name: string; end: number } {
  let i = start;
  let name = "";
  while (i < text.length) {
    const c = text[i];
    if (isEscape(c, text[i + 1])) {
      const hex = /^[0-9a-fA-F]{1,6}/.exec(text.slice(i + 1, i + 7));
      if (hex) {
        name += String.fromCodePoint(Math.min(parseInt(hex[0], 16), 0x10ffff) || 0xfffd);
        i += 1 + hex[0].length;
        if (/\s/.test(text[i] ?? "")) i += 1;
      } else {
        name += text[i + 1];
        i += 2;
      }
    } else if (isIdentChar(c)) {
      name += c;
      i += 1;
    } else break;
  }
  return { name: name.toLowerCase(), end: i };
}

function tokenize(text: string, problems: CssProblem[]): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let i = 0;
  const lines = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) if (text[k] === "\n") line += 1;
  };
  const single: Record<string, Kind> = { "{": "open", "}": "close", ";": "semicolon", ":": "colon", "(": "lparen", ")": "rparen" };
  while (i < text.length) {
    const c = text[i];
    const at = line;
    const before = i;
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) {
        problems.push({ line: at, key: "unclosed_comment" });
        return tokens;
      }
      lines(i, end);
      i = end + 2;
      tokens.push({ kind: "ws", value: " ", line: at });
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      if (text[j] !== c) {
        problems.push({ line: at, key: "unclosed_string" });
        return tokens;
      }
      lines(i, j);
      tokens.push({ kind: "string", value: text.slice(i + 1, j), line: at });
      i = j + 1;
    } else if (/\s/.test(c)) {
      lines(i, i + 1);
      i += 1;
      tokens.push({ kind: "ws", value: " ", line: at });
    } else if (c === "@" && isIdentStart(text[i + 1], text[i + 2], text[i + 3])) {
      const { name, end } = readName(text, i + 1);
      tokens.push({ kind: "at", value: name, line: at });
      i = end;
    } else if (isIdentStart(c, text[i + 1], text[i + 2])) {
      const { name, end } = readName(text, i);
      if (text[end] === "(") {
        tokens.push({ kind: "function", value: name, line: at });
        i = end + 1;
      } else {
        tokens.push({ kind: "ident", value: name, line: at });
        i = end;
      }
    } else {
      tokens.push({ kind: single[c] ?? "other", value: c, line: at });
      i += 1;
    }
    // every pass must consume input, whatever the branches above decided
    if (i <= before) i = before + 1;
  }
  return tokens;
}

/** Index of the first of `kinds` at parenthesis depth 0 from `start`, or the token count. */
function findAtTop(tokens: Token[], start: number, kinds: Kind[]): number {
  let parens = 0;
  for (let i = start; i < tokens.length; i += 1) {
    const kind = tokens[i].kind;
    if (kind === "function" || kind === "lparen") parens += 1;
    else if (kind === "rparen") parens = Math.max(0, parens - 1);
    else if (parens === 0 && kinds.includes(kind)) return i;
  }
  return tokens.length;
}

const text = (tokens: Token[]) =>
  tokens
    .map((t) => (t.kind === "function" ? `${t.value}(` : t.kind === "at" ? `@${t.value}` : t.value))
    .join("")
    .trim();

interface Block {
  style: boolean;
  selector: string;
  line: number;
  fixed: boolean;
  topmost: boolean;
  inert: boolean;
}

export function sanitizeCss(css: string): Sanitized {
  const problems: CssProblem[] = [];
  if (new TextEncoder().encode(css).length > CSS_LIMITS.bytes) return { ok: false, problems: [{ line: 1, key: "too_large" }] };
  // CSS preprocessing: CR, CRLF and FF are newlines (they end strings), NUL is U+FFFD
  css = css.replace(/\r\n?|\f/g, "\n").replace(/\0/g, "\ufffd");
  const tokens = tokenize(css, problems);
  // bounds first: every later pass may rescan from each function, so nesting and size are capped before them
  if (tokens.length > CSS_LIMITS.tokens) return { ok: false, problems: [{ line: 1, key: "too_large" }] };
  let nesting = 0;
  for (const token of tokens) {
    if (token.kind === "function" || token.kind === "lparen") nesting += 1;
    else if (token.kind === "rparen") nesting = Math.max(0, nesting - 1);
    if (nesting > CSS_LIMITS.parens) return { ok: false, problems: [{ line: token.line, key: "too_deep" }] };
  }

  // functions anywhere: fetching ones always, attr() when it could yield a URL
  tokens.forEach((token, index) => {
    if (token.kind !== "function") return;
    if (FETCHING.has(token.value)) problems.push({ line: token.line, key: "fetch" });
    if (token.value === "attr") {
      const end = findAtTop(tokens, index + 1, ["rparen"]);
      if (tokens.slice(index + 1, end).some((t) => t.value === "url" || t.value === "type")) problems.push({ line: token.line, key: "fetch" });
    }
  });

  const stack: Block[] = [];
  let rules = 0;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.kind === "ws" || token.kind === "semicolon") {
      i += 1;
      continue;
    }
    if (token.kind === "close") {
      const block = stack.pop();
      if (!block) problems.push({ line: token.line, key: "unbalanced" });
      else if (block.style && block.fixed && block.topmost) problems.push({ line: block.line, key: "never_hide" });
      else if (block.style && block.inert && PROTECTED.test(block.selector)) problems.push({ line: block.line, key: "never_hide" });
      i += 1;
      continue;
    }
    const end = findAtTop(tokens, i, ["open", "semicolon", "close"]);
    const prelude = tokens.slice(i, end);
    const opensBlock = tokens[end]?.kind === "open";
    const parent = stack[stack.length - 1];
    if (token.kind === "at") {
      if (!AT_RULES.has(token.value)) problems.push({ line: token.line, key: "at_rule" });
      if (token.value === "container" && prelude.some((t) => t.kind === "function" && t.value === "style")) problems.push({ line: token.line, key: "at_rule" });
    } else if (opensBlock) {
      const selector = text(prelude);
      rules += 1;
      if (selector.length > CSS_LIMITS.selector) problems.push({ line: token.line, key: "selector_long" });
      if (prelude.filter((t) => t.kind === "function" && LOGICAL.has(t.value)).length > CSS_LIMITS.logical)
        problems.push({ line: token.line, key: "selector_cost" });
    } else if (parent?.style) {
      // a declaration: name, colon, value up to the semicolon or the closing brace
      const name = prelude[0].kind === "ident" ? prelude[0].value : "";
      const colon = prelude.findIndex((t) => t.kind === "colon");
      const value = colon >= 0 ? text(prelude.slice(colon + 1)).toLowerCase() : "";
      if (BANNED_PROPERTIES.has(name)) problems.push({ line: token.line, key: "property" });
      if (name === "position" && /^(fixed|sticky)\b/.test(value)) parent.fixed = true;
      if (name === "z-index" && Number.parseInt(value, 10) > 1000) parent.topmost = true;
      if (name === "pointer-events" && /^none\b/.test(value)) parent.inert = true;
      if (name === "display" && /^none\b/.test(value)) parent.inert = true;
      if (name === "visibility" && /^(hidden|collapse)\b/.test(value)) parent.inert = true;
      if (name === "opacity" && Number.parseFloat(value) / (value.includes("%") ? 100 : 1) < 0.5) parent.inert = true;
    }
    if (opensBlock) {
      stack.push({ style: token.kind !== "at", selector: text(prelude), line: token.line, fixed: false, topmost: false, inert: false });
      if (stack.length > CSS_LIMITS.depth) problems.push({ line: token.line, key: "too_deep" });
    }
    i = opensBlock ? end + 1 : end;
  }
  if (stack.length > 0) problems.push({ line: stack[stack.length - 1].line, key: "unbalanced" });
  if (rules > CSS_LIMITS.rules) problems.push({ line: 1, key: "too_many_rules" });

  const unique = problems.filter((p, k) => problems.findIndex((q) => q.line === p.line && q.key === p.key) === k);
  return unique.length === 0 ? { ok: true, css } : { ok: false, problems: unique };
}
