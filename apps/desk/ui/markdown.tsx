import type { ReactNode } from "react";

/**
 * Just enough markdown for a note: paragraphs, `- ` / `* ` bullets, `1. `
 * numbered lists, **bold**, *italics* / _italics_, `code`, [links](url)
 * and bare URLs (open in a new tab). Built as React elements, never HTML,
 * so nothing typed can run; only http(s) links become links.
 */
export const Markdown: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    // A heading (a Google Doc's section title, docs/design/desk-docs.md).
    const heading = /^\s{0,3}#{1,6}\s+/;
    if (heading.test(line)) {
      blocks.push(<h4 key={key++} className="md-heading">{inline(line.replace(heading, ""))}</h4>);
      i++;
      continue;
    }
    const bullet = /^\s*[-*]\s+/;
    const number = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || number.test(line)) {
      const ordered = number.test(line);
      const re = ordered ? number : bullet;
      const items: ReactNode[] = [];
      while (i < lines.length && re.test(lines[i]!)) items.push(<li key={items.length}>{inline(lines[i]!.replace(re, ""))}</li>), i++;
      blocks.push(ordered ? <ol key={key++}>{items}</ol> : <ul key={key++}>{items}</ul>);
      continue;
    }
    // A paragraph runs until a blank line or a list; single line breaks stay as breaks.
    const para: ReactNode[] = [];
    while (i < lines.length && lines[i]!.trim() && !bullet.test(lines[i]!) && !number.test(lines[i]!) && !heading.test(lines[i]!)) {
      if (para.length) para.push(<br key={`b${para.length}`} />);
      para.push(...inline(lines[i]!));
      i++;
    }
    blocks.push(<p key={key++}>{para}</p>);
  }
  return <div className={className}>{blocks}</div>;
};

/** **bold**, *italic*, _italic_, `code`, [text](url), a bare URL; anything else is text. */
const inline = (s: string): ReactNode[] => {
  const out: ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`(.+?)`|\[([^\]\n]+)\]\((https?:[^)\s]+)\)|(https?:\/\/[^\s<>()\]]+))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = out.length;
    if (m[2] !== undefined) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3] !== undefined || m[4] !== undefined) out.push(<em key={k}>{m[3] ?? m[4]}</em>);
    else if (m[5] !== undefined) out.push(<code key={k}>{m[5]}</code>);
    else if (m[6] !== undefined && m[7] !== undefined)
      out.push(
        <a key={k} href={m[7]} target="_blank" rel="noopener">
          {m[6]}
        </a>,
      );
    else if (m[8] !== undefined) {
      // A full stop or comma after a bare URL is the sentence's, not the link's.
      const url = m[8].replace(/[.,;:]+$/, "");
      out.push(
        <a key={k} href={url} target="_blank" rel="noopener">
          {url}
        </a>,
        m[8].slice(url.length),
      );
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
};
