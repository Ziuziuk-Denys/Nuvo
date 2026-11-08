import { describe, expect, it } from "vitest";
import { sanitizeCss } from "./cssSanitizer";

const keys = (css: string) => {
  const result = sanitizeCss(css);
  return result.ok ? [] : result.problems.map((p) => `${p.line}:${p.key}`);
};

describe("custom CSS sanitizer", () => {
  it("refuses every fetching construct, escaped, upper-case or inside @media", () => {
    const fetching = [
      "body { background: url(https://example.org/x.png) }",
      'body { background: URL("https://example.org/x.png") }',
      "body { background: u\\72l(https://example.org/x.png) }",
      "body { background: \\75\\72\\6c (https://example.org/x.png) }",
      "body { background: image-set('a.png' 1x) }",
      "body { background: -webkit-image-set('a.png' 1x) }",
      "body { mask: image(a.png) }",
      "body { background: element(#root) }",
      "body { background: paint(x) }",
      "body { background: cross-fade(a, b) }",
      "body { width: expression(alert(1)) }",
      "a::after { content: attr(data-x url) }",
      "a::after { background: attr(data-x type(<url>)) }",
      "@media (min-width: 1px) { body { background: url(x) } }",
    ];
    for (const css of fetching) expect(keys(css), css).toContain("1:fetch");
  });

  it("refuses at-rules outside the allow-list and banned properties", () => {
    for (const css of [
      '@import "x.css";',
      "@IMPORT url(x);",
      '@\\69mport "x.css";',
      "@font-face { font-family: x }",
      "@namespace x url(y);",
      "@charset 'utf-8';",
      "@page { margin: 0 }",
      "@property --x { syntax: '*' }",
      "@layer x { a { color: red } }",
      "@scope (a) { b { color: red } }",
      "@container style(--x: 1) { a { color: red } }",
    ]) {
      expect(keys(css), css).toContain("1:at_rule");
    }
    expect(keys("a { behavior: url(x.htc) }")).toContain("1:property");
    expect(keys("a { -moz-binding: none }")).toContain("1:property");
  });

  it("a comment inside a name splits it, so the browser drops it as invalid CSS (documented, allowed)", () => {
    expect(sanitizeCss("body { background: ur/**/l(x) }").ok).toBe(true);
  });

  it("strings and comments never count as functions", () => {
    expect(sanitizeCss('a::after { content: "url(x)" } /* url(y) */').ok).toBe(true);
  });

  it("never-hide checks: a topmost fixed layer and inert page or guarded controls", () => {
    expect(keys("\n.x { position: fixed; z-index: 2147483647; inset: 0 }")).toEqual(["2:never_hide"]);
    expect(keys("body { pointer-events: none }")).toEqual(["1:never_hide"]);
    expect(keys("[data-nuvo-guard] { pointer-events: none }")).toEqual(["1:never_hide"]);
    expect(sanitizeCss(".somebody { pointer-events: none } .x { position: fixed; z-index: 10 }").ok).toBe(true);
  });

  it("Windows line endings and a byte-order mark keep the line numbers right", () => {
    expect(keys("\uFEFFa { color: red }\r\n\r\nb { background: url(x) }")).toEqual(["3:fetch"]);
  });

  it("accepts a normal snippet", () => {
    const css = `
:root { --n-accent: #e0457b !important; }
.n-scroll:hover { color: rgba(0, 0, 0, 0.5); border-radius: 12px; }
@media (prefers-color-scheme: dark) { a { color: color-mix(in srgb, var(--n-ink) 80%, transparent) } }
@keyframes pulse { from { opacity: 1 } to { opacity: 0.5 } }
a { &:hover { text-decoration: underline } }
`;
    expect(sanitizeCss(css)).toEqual({ ok: true, css });
  });

  it("caps: 33 KB, 1001 rules, nesting 5, long and costly selectors, broken structure", () => {
    expect(keys(`a { content: "${"x".repeat(33 * 1024)}" }`)).toEqual(["1:too_large"]);
    expect(keys("a{}".repeat(1001))).toContain("1:too_many_rules");
    expect(sanitizeCss("a{}".repeat(1000)).ok).toBe(true);
    expect(keys("a { b { c { d { e { color: red } } } } }")).toContain("1:too_deep");
    expect(sanitizeCss("a { b { c { d { color: red } } } }").ok).toBe(true);
    expect(keys(`.${"x".repeat(501)} { color: red }`)).toContain("1:selector_long");
    expect(keys(`a${":is(b)".repeat(4)}${":not(c)".repeat(3)} { color: red }`)).toContain("1:selector_cost");
    expect(keys("a { color: red")).toContain("1:unbalanced");
    expect(keys("a { color: red } }")).toContain("1:unbalanced");
    expect(keys('a { content: "x }')).toContain("1:unclosed_string");
    expect(keys("a { color: red } /* x")).toContain("1:unclosed_comment");
  });

  it("a carriage return or form feed ends a string like a newline, so the rest is still checked", () => {
    for (const end of ["\r", "\f", "\r\n"]) {
      expect(keys(`a{--x:"${end}}b{background:url(https://e.test/x)}/*"}`)).not.toEqual([]);
    }
    expect(keys("a{--x:'\0'}")).toEqual([]);
  });

  it("hiding the page or a guarded control is refused by the static rule too", () => {
    const hiding = [
      "html { display: none }",
      "body { visibility: hidden }",
      ":root { opacity: 0 }",
      "[data-nuvo-guard] { display: none }",
      "#root { opacity: 0.1 }",
    ];
    for (const css of hiding) expect(keys(css), css).toContain("1:never_hide");
    expect(keys(".card { display: none }")).toEqual([]);
  });

  it("refuses deeply nested or huge input fast, before any per-token scan", () => {
    const nested = `a { content: ${"attr(".repeat(5000)}x${")".repeat(5000)} }`;
    const started = performance.now();
    expect(keys(nested).some((k) => k.endsWith(":too_deep"))).toBe(true);
    const flat = `a { content: ${"x ".repeat(16000)} }`;
    expect(keys(flat).some((k) => k.endsWith(":too_large"))).toBe(true);
    expect(performance.now() - started).toBeLessThan(500);
    expect(keys("a { width: calc(1px + (2px * (3px + (4px)))) }")).toEqual([]);
  });
});

describe("tokenizer termination", () => {
  it("a lone backslash before a newline or the end of input is a delimiter, not an endless name", () => {
    for (const css of ["a{}\\\n", "a{}\\", "\\\n", "-\\\n", "@\\\n", "a{color:red}\\\r\n"]) {
      expect(sanitizeCss(css)).toBeDefined();
    }
  });

  it("random short strings of hostile characters always return", () => {
    const pieces = ["\\", "\n", "\r\n", '"', "'", "{", "}", "/*", "*/", "-", "@", "(", ")", ";", ":", "a", "1", " ", "\\41 ", "url(", "\f"];
    let seed = 12345;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const started = Date.now();
    for (let run = 0; run < 4000; run += 1) {
      let css = "";
      const length = 1 + (next() % 8);
      for (let k = 0; k < length; k += 1) css += pieces[next() % pieces.length];
      sanitizeCss(css);
    }
    expect(Date.now() - started).toBeLessThan(10000);
  });
});
