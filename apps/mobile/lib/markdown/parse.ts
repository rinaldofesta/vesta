// A small, dependency-free Markdown parser for chat messages. Handles the
// subset models actually emit: headings, fenced code, bullet/numbered lists,
// paragraphs, and inline bold / italic / code. Pure and unit-tested; the
// renderer (components/Markdown.tsx) maps this tree to React Native views.

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; children: Inline[] }
  | { t: "italic"; children: Inline[] }
  | { t: "code"; v: string };

export type Block =
  | { t: "p"; inline: Inline[] }
  | { t: "h"; level: number; inline: Inline[] }
  | { t: "code"; v: string; lang?: string }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][] };

// --- Inline ---

// Italic last so bold (**/__) wins over italic (*/_); code first so its
// contents are never reinterpreted as emphasis.
export function parseInline(s: string): Inline[] {
  return splitCode(s);
}

function splitCode(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(...splitBold(s.slice(last, m.index)));
    out.push({ t: "code", v: m[1] });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(...splitBold(s.slice(last)));
  return out;
}

// Emphasis only applies when a marker isn't space-padded (CommonMark: `5 * 3 *`
// is not italic) and, for underscores, isn't intraword (`snake_case` is literal).
function emphasisValid(
  content: string,
  before: string,
  after: string,
  underscore: boolean,
): boolean {
  if (/^\s|\s$/.test(content)) return false;
  if (underscore && (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after))) {
    return false;
  }
  return true;
}

function splitBold(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const underscore = m[2] !== undefined;
    const content = m[1] ?? m[2];
    const before = m.index > 0 ? s[m.index - 1] : "";
    const after = m.index + m[0].length < s.length ? s[m.index + m[0].length] : "";
    if (m.index > last) out.push(...splitItalic(s.slice(last, m.index)));
    if (emphasisValid(content, before, after, underscore)) {
      out.push({ t: "bold", children: splitItalic(content) });
    } else {
      out.push(...splitItalic(m[0])); // not emphasis — keep markers literal
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(...splitItalic(s.slice(last)));
  return out;
}

function splitItalic(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*([^*]+)\*|_([^_]+)_/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const underscore = m[2] !== undefined;
    const content = m[1] ?? m[2];
    const before = m.index > 0 ? s[m.index - 1] : "";
    const after = m.index + m[0].length < s.length ? s[m.index + m[0].length] : "";
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    if (emphasisValid(content, before, after, underscore)) {
      out.push({ t: "italic", children: [{ t: "text", v: content }] });
    } else {
      out.push({ t: "text", v: m[0] }); // not emphasis — keep markers literal
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out.length > 0 ? out : [{ t: "text", v: s }];
}

// --- Blocks ---

const HEADING = /^(#{1,6})\s+(.*)$/;
const UL_ITEM = /^\s*[-*+]\s+(.*)$/;
const OL_ITEM = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fence = line.trim().match(/^```(.*)$/);
    if (fence) {
      const lang = fence[1].trim() || undefined;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (if present)
      blocks.push({ t: "code", v: body.join("\n"), lang });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      blocks.push({
        t: "h",
        level: heading[1].length,
        inline: parseInline(heading[2].trim()),
      });
      i++;
      continue;
    }

    if (UL_ITEM.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && UL_ITEM.test(lines[i])) {
        items.push(parseInline(lines[i].match(UL_ITEM)![1].trim()));
        i++;
      }
      blocks.push({ t: "ul", items });
      continue;
    }

    if (OL_ITEM.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && OL_ITEM.test(lines[i])) {
        items.push(parseInline(lines[i].match(OL_ITEM)![1].trim()));
        i++;
      }
      blocks.push({ t: "ol", items });
      continue;
    }

    // Paragraph: accumulate consecutive plain lines.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("```") &&
      !HEADING.test(lines[i]) &&
      !UL_ITEM.test(lines[i]) &&
      !OL_ITEM.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    blocks.push({ t: "p", inline: parseInline(para.join(" ")) });
  }

  return blocks;
}
