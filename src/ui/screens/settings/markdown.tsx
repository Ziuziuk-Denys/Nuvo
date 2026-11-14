import type { CSSProperties, JSX, ReactNode } from "react";
import { openExternal } from "../../ports/system";
import styles from "./markdown.module.css";

export type Inline =
  | string
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] };

export type Block =
  { kind: "heading"; level: 1 | 2 | 3; children: Inline[] } | { kind: "paragraph"; children: Inline[] } | { kind: "list"; ordered: boolean; items: Inline[][] };

// Group order: strong, code, link, em with *, em with _ (only at word edges, so snake_case stays text)
const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*(?!\s)(.+?)\*|(?<![\p{L}\p{N}_])_(?!\s)(.+?)_(?![\p{L}\p{N}_])/u;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push(rest);
      break;
    }
    if (match.index > 0) out.push(rest.slice(0, match.index));
    const [, strong, code, label, href, star, underscore] = match;
    if (strong !== undefined) out.push({ kind: "strong", children: parseInline(strong) });
    else if (code !== undefined) out.push({ kind: "code", text: code });
    else if (label !== undefined) out.push({ kind: "link", href, children: parseInline(label) });
    else out.push({ kind: "em", children: parseInline(star ?? underscore) });
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", children: parseInline(paragraph.join(" ")) });
    if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map(parseInline) });
    paragraph = [];
    list = null;
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const heading = HEADING.exec(line);
    const item = BULLET.exec(line) ?? NUMBERED.exec(line);
    if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2].trim()) });
    } else if (item) {
      const ordered = !BULLET.test(line);
      if (paragraph.length > 0 || (list && list.ordered !== ordered)) flush();
      list ??= { ordered, items: [] };
      list.items.push(item[1].trim());
    } else if (list && /^\s/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      if (list) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

const SAFE_LINK = /^https?:\/\//i;

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (typeof node === "string") return node;
    if (node.kind === "strong") return <strong key={index}>{renderInline(node.children)}</strong>;
    if (node.kind === "em") return <em key={index}>{renderInline(node.children)}</em>;
    if (node.kind === "code") return <code key={index}>{node.text}</code>;
    // A button, not an anchor: the window never navigates, and only web links open
    if (!SAFE_LINK.test(node.href)) return <span key={index}>{renderInline(node.children)}</span>;
    return (
      <button key={index} type="button" className={styles.link} title={node.href} onClick={() => openExternal(node.href)}>
        {renderInline(node.children)}
      </button>
    );
  });
}

export function splitLead(item: Inline[]): { lead: Inline[]; rest: Inline[] } {
  const [first, ...after] = item;
  if (typeof first === "string" || first?.kind !== "strong") return { lead: item, rest: [] };
  const lead = [...first.children];
  const last = lead.length - 1;
  if (typeof lead[last] === "string") lead[last] = lead[last].replace(/[,.:;]\s*$/, "");
  const rest = [...after];
  if (typeof rest[0] === "string") rest[0] = rest[0].trimStart().replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
  if (rest[0] === "") rest.shift();
  return { lead, rest };
}

function Tracks({ items }: { items: Inline[][] }): JSX.Element {
  return (
    <ol className={styles.tracks}>
      {items.map((item, at) => {
        const { lead, rest } = splitLead(item);
        return (
          <li key={at} className={styles.track} style={{ "--at": at } as CSSProperties}>
            <span className={styles.trackNumber} aria-hidden="true">
              {String(at + 1).padStart(2, "0")}
            </span>
            <span className={styles.trackLead}>{renderInline(lead)}</span>
            {rest.length > 0 ? <span className={styles.trackRest}>{renderInline(rest)}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

const HEADINGS = { 1: "h3", 2: "h4", 3: "h5" } as const;

export function Markdown({ text, className, tracks = false }: { text: string; className?: string; tracks?: boolean }): JSX.Element {
  return (
    <div className={[styles.markdown, className].filter(Boolean).join(" ")}>
      {parseMarkdown(text).map((block, index) => {
        if (block.kind === "heading") {
          const Tag = HEADINGS[block.level];
          return <Tag key={index}>{renderInline(block.children)}</Tag>;
        }
        if (block.kind === "paragraph") return <p key={index}>{renderInline(block.children)}</p>;
        if (tracks) return <Tracks key={index} items={block.items} />;
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index}>
            {block.items.map((item, at) => (
              <li key={at}>{renderInline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
