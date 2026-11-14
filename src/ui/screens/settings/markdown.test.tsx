// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Markdown, parseInline, parseMarkdown, splitLead } from "./markdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const open = vi.hoisted(() => vi.fn());
vi.mock("../../ports/system", () => ({ openExternal: open }));

describe("parseInline", () => {
  it("reads bold, italics, code and links, and nests them", () => {
    expect(parseInline("**The cover shows,** and *more* in `code` [the chat](https://t.me/x)")).toEqual([
      { kind: "strong", children: ["The cover shows,"] },
      " and ",
      { kind: "em", children: ["more"] },
      " in ",
      { kind: "code", text: "code" },
      " ",
      { kind: "link", href: "https://t.me/x", children: ["the chat"] },
    ]);
    expect(parseInline("**bold with [a link](https://a.b)**")).toEqual([
      { kind: "strong", children: ["bold with ", { kind: "link", href: "https://a.b", children: ["a link"] }] },
    ]);
  });

  it("keeps snake_case, lone stars and unclosed marks as text", () => {
    expect(parseInline("set auto_gain on")).toEqual(["set auto_gain on"]);
    expect(parseInline("2 * 3 and **open")).toEqual(["2 * 3 and **open"]);
    expect(parseInline("_quiet_ word")).toEqual([{ kind: "em", children: ["quiet"] }, " word"]);
  });
});

describe("parseMarkdown", () => {
  it("splits headings, paragraphs and both kinds of lists", () => {
    const blocks = parseMarkdown("## Fixes\n\nA beta for testers:\nthe first builds.\n\n- one\n  still one\n* two\n\n1. first\n2) second");
    expect(blocks).toEqual([
      { kind: "heading", level: 2, children: ["Fixes"] },
      { kind: "paragraph", children: ["A beta for testers: the first builds."] },
      { kind: "list", ordered: false, items: [["one still one"], ["two"]] },
      { kind: "list", ordered: true, items: [["first"], ["second"]] },
    ]);
  });

  it("ends a list when a paragraph follows it", () => {
    expect(parseMarkdown("- item\nPlease report").map((block) => block.kind)).toEqual(["list", "paragraph"]);
  });
});

describe("Markdown", () => {
  it("never turns the text into HTML", () => {
    const html = renderToStaticMarkup(<Markdown text={'**<img src=x onerror="alert(1)">** <script>alert(2)</script>'} />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("<strong>&lt;img");
  });

  it("opens web links outside the app and leaves other schemes as text", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => root.render(<Markdown text="[ok](https://nuvo.test) [bad](javascript:alert(1))" />));
    expect(host.querySelector("a")).toBeNull();
    expect(host.innerHTML).not.toContain("javascript");
    const buttons = host.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    await act(async () => buttons[0].click());
    expect(open).toHaveBeenCalledWith("https://nuvo.test");
    act(() => root.unmount());
  });
});

describe("release note leads", () => {
  it("a bold opening becomes the headline and the rest its line, capitalised", () => {
    expect(splitLead(parseInline("**The cover shows in Discord,** and there is a button."))).toEqual({
      lead: ["The cover shows in Discord"],
      rest: ["And there is a button."],
    });
    expect(splitLead(parseInline("**Notch buttons work on Windows.**"))).toEqual({ lead: ["Notch buttons work on Windows"], rest: [] });
    expect(splitLead(parseInline("Plain note"))).toEqual({ lead: ["Plain note"], rest: [] });
  });

  it("numbers every change of a list in tracks mode", () => {
    const html = renderToStaticMarkup(<Markdown text={"Intro.\n\n- **One,** two\n- **Three.**"} tracks />);
    expect(html).toContain("<p>Intro.</p>");
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).toContain(">01<");
    expect(html).toContain(">02<");
  });
});
