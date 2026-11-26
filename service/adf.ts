// Jira Cloud reads and writes descriptions and comments as Atlassian Document
// Format (ADF). OpenChamber speaks Markdown, so this module converts the common
// ADF nodes to Markdown and the Markdown OpenChamber writes back to valid ADF.

export type AdfMark = { type: string; attrs?: Record<string, unknown> };
export type AdfNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
};
export type AdfDocument = { type: 'doc'; version: 1; content: AdfNode[] };

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : null
);

const asNode = (value: unknown): AdfNode | null => {
  const object = asObject(value);
  return object && typeof object.type === 'string' ? object as AdfNode : null;
};

const asNodes = (value: unknown): AdfNode[] => (
  Array.isArray(value) ? value.flatMap((entry) => {
    const node = asNode(entry);
    return node ? [node] : [];
  }) : []
);

const stringAttr = (attrs: Record<string, unknown> | undefined, key: string): string | null => {
  const value = attrs?.[key];
  return typeof value === 'string' ? value : null;
};

const numberAttr = (attrs: Record<string, unknown> | undefined, key: string): number | null => {
  const value = attrs?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const fenceFor = (code: string): string => {
  const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  return '`'.repeat(longest + 1);
};

const applyMarks = (value: string, marks: AdfMark[] | undefined): string => {
  if (!Array.isArray(marks) || marks.length === 0) return value;
  const known = marks.filter((mark): mark is AdfMark => (
    typeof mark === 'object' && mark !== null && typeof mark.type === 'string'
  ));
  if (known.length === 0) return value;
  // A link wraps the formatting inside it rather than the other way around.
  const ordered = [...known].sort((left, right) => (left.type === 'link' ? 1 : 0) - (right.type === 'link' ? 1 : 0));
  let result = value;
  for (const mark of ordered) {
    switch (mark.type) {
      case 'strong':
        result = `**${result}**`;
        break;
      case 'em':
        result = `*${result}*`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'strike':
        result = `~~${result}~~`;
        break;
      case 'link': {
        const href = stringAttr(mark.attrs, 'href');
        if (href) result = `[${result}](${href})`;
        break;
      }
      default:
        break;
    }
  }
  return result;
};

const inlineText = (nodes: AdfNode[]): string => nodes.map(inlineNode).join('');

const inlineNode = (node: AdfNode): string => {
  switch (node.type) {
    case 'text':
      return applyMarks(node.text ?? '', node.marks);
    case 'hardBreak':
      return '\n';
    case 'mention': {
      const text = stringAttr(node.attrs, 'text');
      if (text) return text;
      const name = stringAttr(node.attrs, 'displayName');
      return name ? `@${name}` : '';
    }
    case 'emoji':
      return stringAttr(node.attrs, 'text') ?? stringAttr(node.attrs, 'shortName') ?? '';
    case 'inlineCard': {
      const url = stringAttr(node.attrs, 'url');
      return url ? `[${url}](${url})` : '';
    }
    case 'status': {
      const text = stringAttr(node.attrs, 'text');
      return text ? `**${text}**` : '';
    }
    case 'date':
      return stringAttr(node.attrs, 'text') ?? '';
    default:
      if (node.content) return inlineText(node.content);
      // An unknown leaf keeps a visible name instead of vanishing.
      return `[${node.type}]`;
  }
};

type RenderContext = { depth: number; baseUrl: string | null };

const PANEL_LABELS: Record<string, string> = {
  info: 'Info',
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  success: 'Success',
  error: 'Error',
};

const contextAt = (context: RenderContext, depth: number): RenderContext => ({ ...context, depth });

/**
 * A media node as a link. Jira writes an inline image as a media id, so the
 * link points at the attachment endpoint; media with its own URL (an external
 * image) uses that instead.
 */
const mediaLink = (node: AdfNode, context: RenderContext): string => {
  const label = stringAttr(node.attrs, 'alt') ?? stringAttr(node.attrs, 'title') ?? 'attachment';
  const url = stringAttr(node.attrs, 'url');
  if (url) return `[${label}](${url})`;
  const id = stringAttr(node.attrs, 'id');
  if (id && context.baseUrl) {
    return `[${label}](${context.baseUrl}/rest/api/3/attachment/content/${encodeURIComponent(id)})`;
  }
  return `[${label}]`;
};

const renderQuote = (label: string | null, body: string): string => {
  const quoted = body.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
  return label === null ? quoted : `> **${label}**\n>\n${quoted}`;
};

const renderBlocks = (nodes: AdfNode[], context: RenderContext): string[] => {
  const blocks: string[] = [];
  for (const node of nodes) {
    const block = renderBlock(node, context);
    if (block !== null && block.trim() !== '') blocks.push(block);
  }
  return blocks;
};

const renderCell = (cell: AdfNode, context: RenderContext): string => (
  renderBlocks(asNodes(cell.content), contextAt(context, 0)).join(' ').replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim()
);

const renderBlock = (node: AdfNode, context: RenderContext): string | null => {
  switch (node.type) {
    case 'paragraph':
      return inlineText(asNodes(node.content));
    case 'heading': {
      const level = Math.min(6, Math.max(1, numberAttr(node.attrs, 'level') ?? 1));
      return `${'#'.repeat(level)} ${inlineText(asNodes(node.content))}`;
    }
    case 'codeBlock': {
      const language = stringAttr(node.attrs, 'language') ?? '';
      const code = asNodes(node.content).map((child) => child.text ?? '').join('');
      const fence = fenceFor(code);
      return `${fence}${language}\n${code}\n${fence}`;
    }
    case 'blockquote':
    case 'panel':
    case 'expand':
    case 'nestedExpand': {
      const body = renderBlocks(asNodes(node.content), context).join('\n\n');
      const label = node.type === 'panel'
        ? PANEL_LABELS[stringAttr(node.attrs, 'panelType') ?? '']
        : stringAttr(node.attrs, 'title');
      return renderQuote(label ?? null, body);
    }
    case 'media':
      return mediaLink(node, context);
    case 'mediaSingle':
    case 'mediaGroup':
      return renderBlocks(asNodes(node.content), context).join('\n');
    case 'caption':
      return `*${inlineText(asNodes(node.content))}*`;
    case 'blockCard':
    case 'embedCard': {
      const url = stringAttr(node.attrs, 'url');
      return url ? `[${url}](${url})` : `[${node.type}]`;
    }
    case 'rule':
      return '---';
    case 'bulletList':
    case 'orderedList':
      return renderList(node, context);
    case 'taskList':
      return asNodes(node.content).map((item) => {
        const done = stringAttr(item.attrs, 'state')?.toUpperCase() === 'DONE';
        const content = asNodes(item.content);
        const inlineOnly = content.every((child) => [
          'text', 'hardBreak', 'mention', 'emoji', 'inlineCard', 'status', 'date',
        ].includes(child.type));
        const label = inlineOnly ? inlineText(content) : renderBlocks(content, context).join(' ');
        return `${'  '.repeat(context.depth)}- [${done ? 'x' : ' '}] ${label}`;
      }).join('\n');
    case 'table':
      return renderTable(node, context);
    default:
      if (node.content) return renderBlocks(node.content, context).join('\n\n');
      // Unknown blocks name themselves, so a reader can tell something is missing.
      return `[${node.type}]`;
  }
};

const renderList = (node: AdfNode, context: RenderContext): string => {
  const indent = '  '.repeat(context.depth);
  const ordered = node.type === 'orderedList';
  const start = ordered ? numberAttr(node.attrs, 'order') ?? 1 : 0;
  return asNodes(node.content).map((item, index) => {
    const marker = ordered ? `${start + index}. ` : '- ';
    const blocks = renderBlocks(asNodes(item.content), contextAt(context, context.depth + 1));
    if (blocks.length === 0) return `${indent}${marker.trimEnd()}`;
    const lines: string[] = [];
    blocks.forEach((block, blockIndex) => {
      block.split('\n').forEach((line, lineIndex) => {
        if (blockIndex === 0 && lineIndex === 0) lines.push(`${indent}${marker}${line}`);
        else if (blockIndex === 0) lines.push(`${indent}${' '.repeat(marker.length)}${line}`);
        else lines.push(line);
      });
    });
    return lines.join('\n');
  }).join('\n');
};

const renderTable = (node: AdfNode, context: RenderContext): string => {
  const rows = asNodes(node.content);
  if (rows.length === 0) return '';
  const first = asNodes(rows[0]?.content);
  const header = `| ${first.map((cell) => renderCell(cell, context)).join(' | ')} |`;
  const divider = `| ${first.map(() => '---').join(' | ')} |`;
  const body = rows.slice(1).map((row) => `| ${asNodes(row.content).map((cell) => renderCell(cell, context)).join(' | ')} |`);
  return [header, divider, ...body].join('\n');
};

/** Convert an ADF document from Jira into Markdown; anything else answers ''. */
export function adfToMarkdown(value: unknown, options: { baseUrl?: string } = {}): string {
  const root = asObject(value);
  if (!root || root.type !== 'doc') return '';
  const baseUrl = typeof options.baseUrl === 'string' && options.baseUrl.trim() !== ''
    ? options.baseUrl.trim().replace(/\/+$/, '')
    : null;
  const markdown = renderBlocks(asNodes(root.content), { depth: 0, baseUrl }).join('\n\n');
  return markdown.replace(/\n{3,}/g, '\n\n').trim();
}

const INLINE_LINK = /^\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/;
const INLINE_STRONG_STAR = /^\*\*([\s\S]+?)\*\*/;
const INLINE_STRONG_UNDERSCORE = /^__([\s\S]+?)__/;
const INLINE_STRIKE = /^~~([\s\S]+?)~~/;
const INLINE_CODE = /^`([^`]+)`/;
const INLINE_EM_STAR = /^\*([^*\n]+)\*/;
const INLINE_EM_UNDERSCORE = /^_([^_\n]+)_/;

const markText = (nodes: AdfNode[], mark: AdfMark): AdfNode[] => nodes.flatMap((node) => (
  node.type === 'text' ? [{ ...node, marks: [...(node.marks ?? []), mark] }] : [node]
));

const parseInline = (source: string): AdfNode[] => {
  const nodes: AdfNode[] = [];
  let plain = '';
  let index = 0;
  const flush = (): void => {
    if (plain !== '') {
      nodes.push({ type: 'text', text: plain });
      plain = '';
    }
  };

  while (index < source.length) {
    const rest = source.slice(index);

    const link = rest.match(INLINE_LINK);
    if (link) {
      flush();
      const href = link[2] ?? '';
      nodes.push(...markText(parseInline(link[1] ?? ''), { type: 'link', attrs: { href } }));
      index += link[0].length;
      continue;
    }

    const strong = rest.match(INLINE_STRONG_STAR) ?? rest.match(INLINE_STRONG_UNDERSCORE);
    if (strong) {
      flush();
      nodes.push(...markText(parseInline(strong[1] ?? ''), { type: 'strong' }));
      index += strong[0].length;
      continue;
    }

    const strike = rest.match(INLINE_STRIKE);
    if (strike) {
      flush();
      nodes.push(...markText(parseInline(strike[1] ?? ''), { type: 'strike' }));
      index += strike[0].length;
      continue;
    }

    const code = rest.match(INLINE_CODE);
    if (code) {
      flush();
      nodes.push({ type: 'text', text: code[1] ?? '', marks: [{ type: 'code' }] });
      index += code[0].length;
      continue;
    }

    const em = rest.match(INLINE_EM_STAR) ?? rest.match(INLINE_EM_UNDERSCORE);
    if (em) {
      flush();
      nodes.push(...markText(parseInline(em[1] ?? ''), { type: 'em' }));
      index += em[0].length;
      continue;
    }

    const char = source[index] ?? '';
    if (char === '`' || char === '*' || char === '_' || char === '~' || char === '[') {
      // Not a construct we know: keep the character as text and move on.
      plain += char;
      index += 1;
      continue;
    }
    plain += char;
    index += 1;
  }

  flush();
  return nodes;
};

const isFence = (line: string): RegExpMatchArray | null => line.match(/^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/);
const isHeading = (line: string): RegExpMatchArray | null => line.match(/^(#{1,6})\s+(.*?)\s*$/);
const isRule = (line: string): boolean => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
const isQuote = (line: string): boolean => /^\s*>\s?/.test(line);
const isBullet = (line: string): RegExpMatchArray | null => line.match(/^(\s*)[-*+]\s+(.*)$/);
const isOrdered = (line: string): RegExpMatchArray | null => line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);

const startsBlock = (line: string): boolean => (
  isFence(line) !== null || isHeading(line) !== null || isRule(line)
  || isQuote(line) || isBullet(line) !== null || isOrdered(line) !== null
);

const parseList = (lines: string[], startIndex: number, ordered: boolean): { node: AdfNode; next: number } => {
  const first = (ordered ? isOrdered(lines[startIndex] ?? '') : isBullet(lines[startIndex] ?? ''));
  const baseIndent = first?.[1]?.length ?? 0;
  const order = ordered ? Number(first?.[2] ?? 1) : 0;
  const items: AdfNode[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const match = ordered ? isOrdered(line) : isBullet(line);
    if (!match || (match[1]?.length ?? 0) !== baseIndent) break;

    const textLine = ordered ? match[3] ?? '' : match[2] ?? '';
    const contentLines = [textLine];
    index += 1;

    while (index < lines.length) {
      const next = lines[index] ?? '';
      if (next.trim() === '') {
        const following = lines[index + 1] ?? '';
        const followingMatch = ordered ? isOrdered(following) : isBullet(following);
        if (!followingMatch || (followingMatch[1]?.length ?? 0) !== baseIndent) break;
        index += 1;
        continue;
      }
      const nested = ordered ? isOrdered(next) : isBullet(next);
      if (nested && (nested[1]?.length ?? 0) === baseIndent) break;
      contentLines.push(next.replace(new RegExp(`^\\s{0,${baseIndent + 2}}`), ''));
      index += 1;
    }

    const content = parseBlocks(contentLines);
    items.push({ type: 'listItem', content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }] });
  }

  const node: AdfNode = ordered
    ? { type: 'orderedList', attrs: { order }, content: items }
    : { type: 'bulletList', content: items };
  return { node, next: index };
};

const parseBlocks = (lines: string[]): AdfNode[] => {
  const blocks: AdfNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = isFence(line);
    if (fence) {
      const marker = fence[1] ?? '```';
      const language = fence[2] ?? '';
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith(marker)) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      const joined = code.join('\n');
      const node: AdfNode = { type: 'codeBlock', content: joined === '' ? [] : [{ type: 'text', text: joined }] };
      if (language !== '') node.attrs = { language };
      blocks.push(node);
      continue;
    }

    const heading = isHeading(line);
    if (heading) {
      blocks.push({
        type: 'heading',
        attrs: { level: (heading[1] ?? '#').length },
        content: parseInline(heading[2] ?? ''),
      });
      index += 1;
      continue;
    }

    if (isRule(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (isQuote(line)) {
      const quoted: string[] = [];
      while (index < lines.length && isQuote(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^\s*>\s?/, ''));
        index += 1;
      }
      const content = parseBlocks(quoted);
      blocks.push({ type: 'blockquote', content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }] });
      continue;
    }

    if (isBullet(line)) {
      const list = parseList(lines, index, false);
      blocks.push(list.node);
      index = list.next;
      continue;
    }

    if (isOrdered(line)) {
      const list = parseList(lines, index, true);
      blocks.push(list.node);
      index = list.next;
      continue;
    }

    const content: AdfNode[] = [];
    let hardBreakNext = false;
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (current.trim() === '') break;
      if (content.length > 0 && startsBlock(current)) break;
      if (content.length > 0) content.push(hardBreakNext ? { type: 'hardBreak' } : { type: 'text', text: ' ' });
      content.push(...parseInline(current.replace(/\s{2,}$/, '')));
      hardBreakNext = /\s{2,}$/.test(current);
      index += 1;
    }
    blocks.push({ type: 'paragraph', content });
  }

  return blocks;
};

/** Convert Markdown from OpenChamber into a valid ADF document for Jira. */
export function markdownToAdf(markdown: string): AdfDocument {
  const source = markdown.replace(/\r\n?/g, '\n');
  if (source.trim() === '') throw new Error('comment body is empty');
  return { type: 'doc', version: 1, content: parseBlocks(source.split('\n')) };
}
