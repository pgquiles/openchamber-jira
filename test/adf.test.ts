import { describe, expect, test } from 'bun:test';

import { adfToMarkdown, markdownToAdf } from '../service/adf.ts';
import { ADF_NODE_CASES } from './fixtures/adf-nodes.ts';

const doc = (...content: unknown[]) => ({ type: 'doc', version: 1, content });

const text = (value: string, ...marks: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks.length > 0 ? { marks } : {}),
});

const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });

describe('ADF to Markdown', () => {
  test('renders headings, paragraphs, marks, lists, code and quotes', () => {
    const value = doc(
      { type: 'heading', attrs: { level: 2 }, content: [text('Summary')] },
      paragraph(
        text('Fix '),
        text('login', { type: 'code' }),
        text(' and see '),
        text('docs', { type: 'link', attrs: { href: 'https://example.com/docs' } }),
        text('.'),
      ),
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(text('one'))] },
          { type: 'listItem', content: [paragraph(text('two', { type: 'strong' }))] },
        ],
      },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const x = 1;')] },
      { type: 'blockquote', content: [paragraph(text('quoted'))] },
    );

    expect(adfToMarkdown(value)).toBe([
      '## Summary',
      '',
      'Fix `login` and see [docs](https://example.com/docs).',
      '',
      '- one',
      '- **two**',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '> quoted',
    ].join('\n'));
  });

  test('keeps a link around the formatting inside it', () => {
    const value = doc(paragraph(text('release', { type: 'strong' }, { type: 'link', attrs: { href: 'https://example.com/r' } })));
    expect(adfToMarkdown(value)).toBe('[**release**](https://example.com/r)');
  });

  test('renders hard breaks, mentions, emoji and inline cards', () => {
    const value = doc(paragraph(
      text('first'),
      { type: 'hardBreak' },
      text('second '),
      { type: 'mention', attrs: { id: 'acc-2', text: '@Octo' } },
      { type: 'emoji', attrs: { text: '🎉' } },
      text(' '),
      { type: 'inlineCard', attrs: { url: 'https://example.com/card' } },
    ));

    expect(adfToMarkdown(value)).toBe('first\nsecond @Octo🎉 [https://example.com/card](https://example.com/card)');
  });

  test('renders nested lists with indentation and ordered lists from their start', () => {
    const value = doc({
      type: 'orderedList',
      attrs: { order: 3 },
      content: [
        {
          type: 'listItem',
          content: [
            paragraph(text('third')),
            {
              type: 'bulletList',
              content: [
                { type: 'listItem', content: [paragraph(text('nested'))] },
              ],
            },
          ],
        },
      ],
    });

    expect(adfToMarkdown(value)).toBe('3. third\n  - nested');
  });

  test('renders task lists and rules', () => {
    const value = doc(
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { state: 'DONE' }, content: [text('ship it')] },
          { type: 'taskItem', attrs: { state: 'TODO' }, content: [text('write docs')] },
        ],
      },
      { type: 'rule' },
    );

    expect(adfToMarkdown(value)).toBe('- [x] ship it\n- [ ] write docs\n\n---');
  });

  test('renders a table with a header row', () => {
    const value = doc({
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
    });

    expect(adfToMarkdown(value)).toBe('| Name | Value |\n| --- | --- |\n| one | two |');
  });

  test('answers an empty string for a missing or foreign document', () => {
    expect(adfToMarkdown(null)).toBe('');
    expect(adfToMarkdown({ type: 'paragraph', content: [text('no doc')] })).toBe('');
    expect(adfToMarkdown({ type: 'doc', version: 1, content: [] })).toBe('');
  });
});

describe('every ADF node type', () => {
  for (const nodeCase of ADF_NODE_CASES) {
    test(`renders ${nodeCase.name}`, () => {
      const value = nodeCase.inline ? doc(paragraph(nodeCase.node)) : doc(nodeCase.node);
      const options = nodeCase.baseUrl === undefined ? {} : { baseUrl: nodeCase.baseUrl };
      expect(adfToMarkdown(value, options)).toBe(nodeCase.markdown);
    });
  }
});

describe('malformed ADF', () => {
  const TYPES = [
    'doc', 'paragraph', 'text', 'hardBreak', 'mention', 'emoji', 'inlineCard', 'blockCard', 'embedCard',
    'status', 'date', 'heading', 'codeBlock', 'blockquote', 'panel', 'expand', 'nestedExpand',
    'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'table', 'tableRow', 'tableCell',
    'media', 'mediaSingle', 'mediaGroup', 'caption', 'rule', 'mystery', 'mysteryBlock', '',
  ] as const;

  /** A deterministic generator, so a failure can be replayed from its seed. */
  const randomDocument = (seed: number): unknown => {
    let state = seed >>> 0;
    const next = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 2 ** 32;
    };
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
    const value = (depth: number): unknown => {
      const roll = next();
      if (depth === 0 || roll < 0.3) return pick([null, true, false, 0, -1, 1.5, '', 'text', pick(TYPES)]);
      if (roll < 0.55) return Array.from({ length: Math.floor(next() * 4) }, () => value(depth - 1));
      const node: Record<string, unknown> = {};
      if (next() < 0.85) node.type = pick(TYPES);
      if (next() < 0.6) node.content = value(depth - 1);
      if (next() < 0.5) {
        node.attrs = {
          level: pick([0, 1, 7, 'x', null]),
          text: pick([42, 'Text', null]),
          timestamp: pick([42, '1795683729000', null]),
          url: pick([42, 'https://example.com/x', null]),
          id: pick([1, 'abc', null]),
          panelType: pick(['warning', 7, null]),
          title: pick([[], 'T', null]),
          alt: pick([{}, 'alt', null]),
          order: pick([0, -1, 'x', null]),
        };
      }
      if (next() < 0.4) node.text = pick([42, 'word', null]);
      if (next() < 0.3) node.marks = pick([null, 'x', {}, [{ type: 'link', attrs: { href: 42 } }], [{ type: 'strong' }, null]]);
      return node;
    };
    return value(4);
  };

  test('never throws on a document that is not ADF', () => {
    for (let seed = 1; seed <= 500; seed += 1) {
      const value = randomDocument(seed);
      expect(() => adfToMarkdown(value)).not.toThrow();
      expect(() => adfToMarkdown(value, { baseUrl: 'https://example.atlassian.net' })).not.toThrow();
    }
  });

  test('never throws on a document with the right shape but broken parts', () => {
    const broken = doc(
      { type: 'paragraph', content: 'not an array' },
      { type: 'heading', attrs: 'nope', content: [text('x')] },
      { type: 'codeBlock', content: [{ type: 'text', text: 42 }] },
      { type: 'table', content: [{ type: 'tableRow', content: null }, null] },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: null }] },
      { type: 'panel', attrs: { panelType: 42 }, content: [] },
      { type: 'mystery', content: null },
      { type: 'mystery' },
      null,
      'text',
    );
    expect(() => adfToMarkdown(broken)).not.toThrow();
  });
});

describe('Markdown to ADF', () => {
  test('turns the session comment OpenChamber writes into a linked paragraph', () => {
    expect(markdownToAdf('[OpenChamber session completed](https://openchamber.example/?session=abc)'))
      .toEqual(doc(paragraph(text('OpenChamber session completed', {
        type: 'link',
        attrs: { href: 'https://openchamber.example/?session=abc' },
      }))));
  });

  test('turns headings, emphasis, lists and inline code into ADF nodes', () => {
    const markdown = [
      '# Release',
      '',
      'Ship **this** and *that* with `pnpm`.',
      '',
      '- first',
      '- second',
      '',
      '1. one',
      '2. two',
    ].join('\n');

    expect(markdownToAdf(markdown)).toEqual(doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('Release')] },
      paragraph(
        text('Ship '),
        text('this', { type: 'strong' }),
        text(' and '),
        text('that', { type: 'em' }),
        text(' with '),
        text('pnpm', { type: 'code' }),
        text('.'),
      ),
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(text('first'))] },
          { type: 'listItem', content: [paragraph(text('second'))] },
        ],
      },
      {
        type: 'orderedList',
        attrs: { order: 1 },
        content: [
          { type: 'listItem', content: [paragraph(text('one'))] },
          { type: 'listItem', content: [paragraph(text('two'))] },
        ],
      },
    ));
  });

  test('turns fenced code, quotes and hard breaks into ADF nodes', () => {
    const markdown = [
      '```json',
      '{"ok":true}',
      '```',
      '',
      '> quoted',
      '',
      'first  ',
      'second',
    ].join('\n');

    expect(markdownToAdf(markdown)).toEqual(doc(
      { type: 'codeBlock', attrs: { language: 'json' }, content: [text('{"ok":true}')] },
      { type: 'blockquote', content: [paragraph(text('quoted'))] },
      paragraph(text('first'), { type: 'hardBreak' }, text('second')),
    ));
  });

  test('refuses an empty comment body', () => {
    expect(() => markdownToAdf('')).toThrow('comment body is empty');
    expect(() => markdownToAdf('   \n\n  ')).toThrow('comment body is empty');
  });

  test('round-trips the common markdown shapes it writes', () => {
    const markdown = [
      '## Summary',
      '',
      'Fix `login` and see [docs](https://example.com/docs).',
      '',
      '- one',
      '- **two**',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '> quoted',
    ].join('\n');

    expect(adfToMarkdown(markdownToAdf(markdown))).toBe(markdown);
  });
});
