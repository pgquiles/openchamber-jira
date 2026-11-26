// One case per ADF node the converter claims to understand. The test wraps an
// inline node in a paragraph and renders a block node on its own, so every
// node has a defined Markdown answer or a deliberate, documented omission.

export type AdfNodeCase = {
  name: string;
  node: Record<string, unknown>;
  inline?: boolean;
  markdown: string;
  baseUrl?: string;
};

const text = (value: string, ...marks: unknown[]): Record<string, unknown> => ({
  type: 'text',
  text: value,
  ...(marks.length > 0 ? { marks } : {}),
});

const paragraph = (...content: unknown[]): Record<string, unknown> => ({ type: 'paragraph', content });

export const ADF_NODE_CASES: AdfNodeCase[] = [
  {
    name: 'a paragraph',
    node: paragraph(text('hello')),
    markdown: 'hello',
  },
  {
    name: 'a heading',
    node: { type: 'heading', attrs: { level: 3 }, content: [text('Title')] },
    markdown: '### Title',
  },
  {
    name: 'every text mark',
    node: paragraph(
      text('bold', { type: 'strong' }),
      text(' '),
      text('italic', { type: 'em' }),
      text(' '),
      text('code', { type: 'code' }),
      text(' '),
      text('gone', { type: 'strike' }),
      text(' '),
      text('link', { type: 'link', attrs: { href: 'https://example.com/l' } }),
    ),
    markdown: '**bold** *italic* `code` ~~gone~~ [link](https://example.com/l)',
  },
  {
    name: 'a hard break',
    node: paragraph(text('first'), { type: 'hardBreak' }, text('second')),
    markdown: 'first\nsecond',
  },
  {
    name: 'a mention',
    node: { type: 'mention', attrs: { id: 'acc-2', text: '@Octo' } },
    inline: true,
    markdown: '@Octo',
  },
  {
    name: 'an emoji',
    node: { type: 'emoji', attrs: { text: '🎉' } },
    inline: true,
    markdown: '🎉',
  },
  {
    name: 'an inline card',
    node: { type: 'inlineCard', attrs: { url: 'https://example.com/card' } },
    inline: true,
    markdown: '[https://example.com/card](https://example.com/card)',
  },
  {
    name: 'a block card',
    node: { type: 'blockCard', attrs: { url: 'https://example.com/block' } },
    markdown: '[https://example.com/block](https://example.com/block)',
  },
  {
    name: 'an embed card',
    node: { type: 'embedCard', attrs: { url: 'https://example.com/embed' } },
    markdown: '[https://example.com/embed](https://example.com/embed)',
  },
  {
    name: 'a status lozenge',
    node: { type: 'status', attrs: { text: 'In Progress' } },
    inline: true,
    markdown: '**In Progress**',
  },
  {
    name: 'a date',
    node: { type: 'date', attrs: { timestamp: '1795683729000', text: '2026-11-26' } },
    inline: true,
    markdown: '2026-11-26',
  },
  {
    name: 'a bullet list',
    node: {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [paragraph(text('one'))] },
        { type: 'listItem', content: [paragraph(text('two'))] },
      ],
    },
    markdown: '- one\n- two',
  },
  {
    name: 'an ordered list that starts at three',
    node: {
      type: 'orderedList',
      attrs: { order: 3 },
      content: [
        { type: 'listItem', content: [paragraph(text('three'))] },
        { type: 'listItem', content: [paragraph(text('four'))] },
      ],
    },
    markdown: '3. three\n4. four',
  },
  {
    name: 'a nested list',
    node: {
      type: 'bulletList',
      content: [{
        type: 'listItem',
        content: [
          paragraph(text('outer')),
          { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('inner'))] }] },
        ],
      }],
    },
    markdown: '- outer\n  - inner',
  },
  {
    name: 'a task list',
    node: {
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { state: 'DONE' }, content: [text('shipped')] },
        { type: 'taskItem', attrs: { state: 'TODO' }, content: [text('pending')] },
      ],
    },
    markdown: '- [x] shipped\n- [ ] pending',
  },
  {
    name: 'a table',
    node: {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [paragraph(text('Name'))] },
            { type: 'tableHeader', content: [paragraph(text('Value'))] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [paragraph(text('one'))] },
            { type: 'tableCell', content: [paragraph(text('two'))] },
          ],
        },
      ],
    },
    markdown: '| Name | Value |\n| --- | --- |\n| one | two |',
  },
  {
    name: 'a table cell with a pipe and a backslash',
    node: {
      type: 'table',
      content: [
        { type: 'tableRow', content: [{ type: 'tableHeader', content: [paragraph(text('Value'))] }] },
        { type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph(text('a|b\\c'))] }] },
      ],
    },
    markdown: '| Value |\n| --- |\n| a\\|b\\\\c |',
  },
  {
    name: 'a code block',
    node: { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const x = 1;')] },
    markdown: '```ts\nconst x = 1;\n```',
  },
  {
    name: 'a blockquote',
    node: { type: 'blockquote', content: [paragraph(text('quoted'))] },
    markdown: '> quoted',
  },
  {
    name: 'a panel with its tone',
    node: { type: 'panel', attrs: { panelType: 'warning' }, content: [paragraph(text('Careful.'))] },
    markdown: '> **Warning**\n>\n> Careful.',
  },
  {
    name: 'an expand with its title',
    node: { type: 'expand', attrs: { title: 'More detail' }, content: [paragraph(text('Nested.'))] },
    markdown: '> **More detail**\n>\n> Nested.',
  },
  {
    name: 'a nested expand with its title',
    node: { type: 'nestedExpand', attrs: { title: 'Deeper' }, content: [paragraph(text('Inside.'))] },
    markdown: '> **Deeper**\n>\n> Inside.',
  },
  {
    name: 'a media node as an attachment link',
    node: { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'abc-123', alt: 'login screenshot' } }] },
    baseUrl: 'https://example.atlassian.net',
    markdown: '[login screenshot](https://example.atlassian.net/rest/api/3/attachment/content/abc-123)',
  },
  {
    name: 'external media by its own URL',
    node: { type: 'mediaSingle', content: [{ type: 'media', attrs: { url: 'https://cdn.example/diagram.png', alt: 'diagram' } }] },
    baseUrl: 'https://example.atlassian.net',
    markdown: '[diagram](https://cdn.example/diagram.png)',
  },
  {
    name: 'a media group with two files',
    node: {
      type: 'mediaGroup',
      content: [
        { type: 'media', attrs: { id: 'one', alt: 'first' } },
        { type: 'media', attrs: { id: 'two', alt: 'second' } },
      ],
    },
    baseUrl: 'https://example.atlassian.net/',
    markdown: '[first](https://example.atlassian.net/rest/api/3/attachment/content/one)\n'
      + '[second](https://example.atlassian.net/rest/api/3/attachment/content/two)',
  },
  {
    name: 'a caption',
    node: {
      type: 'mediaSingle',
      content: [
        { type: 'media', attrs: { id: 'abc', alt: 'shot' } },
        { type: 'caption', content: [text('The caption')] },
      ],
    },
    baseUrl: 'https://example.atlassian.net',
    markdown: '[shot](https://example.atlassian.net/rest/api/3/attachment/content/abc)\n*The caption*',
  },
  {
    name: 'a media node without a URL or id',
    node: { type: 'media', attrs: { alt: 'orphan' } },
    markdown: '[orphan]',
  },
  {
    name: 'a rule',
    node: { type: 'rule' },
    markdown: '---',
  },
  {
    name: 'an unknown inline leaf',
    node: { type: 'mystery' },
    inline: true,
    markdown: '[mystery]',
  },
  {
    name: 'an unknown block leaf',
    node: { type: 'mysteryBlock' },
    markdown: '[mysteryBlock]',
  },
  {
    name: 'an unknown block that wraps content',
    node: { type: 'mysterySection', content: [paragraph(text('inside'))] },
    markdown: 'inside',
  },
];
