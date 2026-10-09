import type { ReactNode } from "react";

/**
 * Just enough markdown for a note: paragraphs, `- ` / `* ` bullets, `1. `
 * numbered lists, **bold**, *italics* / _italics_, `code`. Built as React
 * elements, never HTML, so nothing typed can run.
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
    while (i < lines.length && lines[i]!.trim() && !bullet.test(lines[i]!) && !number.test(lines[i]!)) {
      if (para.length) para.push(<br key={`b${para.length}`} />);
      para.push(...inline(lines[i]!));
      i++;
    }
    blocks.push(<p key={key++}>{para}</p>);
  }
  return <div className={className}>{blocks}</div>;
};

/** **bold**, *italic*, _italic_, `code`; anything else is text. */
const inline = (s: string): ReactNode[] => {
  const out: ReactNode[] = [];
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`(.+?)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const k = out.length;
    if (m[2] !== undefined) out.push(<strong key={k}>{m[2]}</strong>);
    else if (m[3] !== undefined || m[4] !== undefined) out.push(<em key={k}>{m[3] ?? m[4]}</em>);
    else if (m[5] !== undefined) out.push(<code key={k}>{m[5]}</code>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
};
