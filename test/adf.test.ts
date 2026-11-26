import { describe, expect, test } from 'bun:test';

import { adfToMarkdown, markdownToAdf } from '../service/adf.ts';

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
