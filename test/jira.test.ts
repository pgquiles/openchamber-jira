import { describe, expect, test } from 'bun:test';

import {
  buildJql,
  epicChildrenJql,
  epicLinkFieldId,
  escapeJqlString,
  isEpicIssueType,
  isIssueKey,
  isProjectKey,
  mapPriorityName,
  mapStatusCategory,
  priorityFilterNames,
} from '../service/jira.ts';

const BASE = { state: 'open', people: 'any', priority: 'all', containerId: null } as const;
const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

describe('status category mapping', () => {
  test.each([
    [{ key: 'new', name: 'To Do' }, 'todo'],
    [{ key: 'new', name: 'Open' }, 'todo'],
    [{ key: 'indeterminate', name: 'In Progress' }, 'in-progress'],
    [{ key: 'in-flight', name: 'In Flight' }, 'in-progress'],
    [{ key: 'done', name: 'Done' }, 'done'],
    [{ key: 'completed', name: 'Complete' }, 'done'],
    [{ key: 'done', name: 'Won\u2019t Do' }, 'done'],
  ])('%j answers %s', (category, expected) => {
    expect(mapStatusCategory(category)).toBe(expected as never);
  });

  test('answers null for a category Jira does not define', () => {
    expect(mapStatusCategory({ key: 'unknown', name: 'Blocked' })).toBeNull();
    expect(mapStatusCategory(null)).toBeNull();
    expect(mapStatusCategory(undefined)).toBeNull();
  });
});

describe('priority mapping', () => {
  test.each([
    ['Highest', 'urgent'],
    ['Blocker', 'urgent'],
    ['Critical', 'urgent'],
    ['High', 'high'],
    ['Medium', 'medium'],
    ['Normal', 'medium'],
    ['Low', 'low'],
    ['Lowest', 'low'],
    ['Trivial', 'low'],
    ['HIGH', 'high'],
    [null, 'none'],
    [undefined, 'none'],
    ['Not a priority we know', 'none'],
  ])('%s answers %s', (name, expected) => {
    expect(mapPriorityName(name)).toBe(expected as never);
  });

  test('builds the priority filter from the names the site really has', () => {
    expect(priorityFilterNames('urgent', PRIORITIES)).toEqual(['Highest']);
    expect(priorityFilterNames('low', PRIORITIES)).toEqual(['Low', 'Lowest']);
    expect(priorityFilterNames('urgent', ['Critical', 'Blocker', 'High'])).toEqual(['Critical', 'Blocker']);
    expect(priorityFilterNames('high', ['Highest'])).toEqual([]);
    expect(priorityFilterNames('all', PRIORITIES)).toEqual([]);
    expect(priorityFilterNames('none', PRIORITIES)).toEqual([]);
  });
});

describe('JQL', () => {
  test('defaults to the signed-in user’s active issues, newest first', () => {
    expect(buildJql(BASE, PRIORITIES)).toEqual({
      matchesNothing: false,
      jql: 'statusCategory != Done AND assignee = currentUser() ORDER BY updated DESC',
    });
  });

  test('maps every declared state filter to a Jira status category', () => {
    expect(buildJql({ ...BASE, state: 'all' }, PRIORITIES).jql)
      .toBe('assignee = currentUser() ORDER BY updated DESC');
    expect(buildJql({ ...BASE, state: 'todo' }, PRIORITIES).jql)
      .toBe('statusCategory = "To Do" AND assignee = currentUser() ORDER BY updated DESC');
    expect(buildJql({ ...BASE, state: 'in-progress' }, PRIORITIES).jql)
      .toBe('statusCategory = "In Progress" AND assignee = currentUser() ORDER BY updated DESC');
    expect(buildJql({ ...BASE, state: 'done' }, PRIORITIES).jql)
      .toBe('statusCategory = Done AND assignee = currentUser() ORDER BY updated DESC');
  });

  test('scopes both any and me to the signed-in assignee, and created to the reporter', () => {
    expect(buildJql({ ...BASE, people: 'any' }, PRIORITIES).jql).toContain('assignee = currentUser()');
    expect(buildJql({ ...BASE, people: 'me' }, PRIORITIES).jql).toContain('assignee = currentUser()');
    expect(buildJql({ ...BASE, people: 'created' }, PRIORITIES).jql).toContain('reporter = currentUser()');
  });

  test('adds the project, priority and text conditions in a stable order', () => {
    expect(buildJql({
      state: 'todo', people: 'created', priority: 'high', containerId: 'PROJ', query: 'login bug',
    }, PRIORITIES)).toEqual({
      matchesNothing: false,
      jql: 'project = "PROJ" AND statusCategory = "To Do" AND reporter = currentUser() AND priority in ("High") AND summary ~ "login bug" ORDER BY updated DESC',
    });
  });

  test('searches a key-shaped query by key or summary', () => {
    expect(buildJql({ ...BASE, query: 'PROJ-42' }, PRIORITIES).jql)
      .toBe('statusCategory != Done AND assignee = currentUser() AND (key = "PROJ-42" OR summary ~ "PROJ-42") ORDER BY updated DESC');
  });

  test('treats a bare word as a summary search even if it has digits', () => {
    expect(buildJql({ ...BASE, query: 'release 42' }, PRIORITIES).jql)
      .toContain('summary ~ "release 42"');
  });

  test('filters out every issue when the site has no priority for the chosen level', () => {
    expect(buildJql({ ...BASE, priority: 'urgent' }, ['Medium', 'Low'])).toEqual({
      matchesNothing: true,
      jql: '',
    });
  });

  test('filters on an empty priority', () => {
    expect(buildJql({ ...BASE, priority: 'none' }, PRIORITIES).jql)
      .toBe('statusCategory != Done AND assignee = currentUser() AND priority is EMPTY ORDER BY updated DESC');
  });

  test('escapes quotes and backslashes in a search string', () => {
    expect(escapeJqlString('a"b\\c')).toBe('a\\"b\\\\c');
    expect(buildJql({ ...BASE, query: 'x" OR key = "PROJ-1' }, PRIORITIES).jql)
      .toContain('summary ~ "x\\" OR key = \\"PROJ-1"');
  });

  test('refuses a project key that could rewrite the query', () => {
    expect(() => buildJql({ ...BASE, containerId: 'PROJ" OR project = "OPS' }, PRIORITIES))
      .toThrow('not a Jira project key');
  });

  test('refuses a state filter it did not declare', () => {
    expect(() => buildJql({ ...BASE, state: 'inReview' }, PRIORITIES))
      .toThrow('unknown state filter');
  });
});

describe('issue keys', () => {
  test.each(['PROJ-1', 'ABC_2-300', 'ops-12'])('%s is a key', (value) => {
    expect(isIssueKey(value)).toBe(true);
  });

  test.each(['PROJ', 'PROJ-', '-1', 'PROJ-1-2', 'release 42', 'PROJ-1 OR x'])('%s is not a key', (value) => {
    expect(isIssueKey(value)).toBe(false);
  });
});

describe('company-managed Epic Link', () => {
  test('finds the link field by its schema even when its name is localized', () => {
    expect(epicLinkFieldId([
      { id: 'summary', name: 'Summary' },
      {
        id: 'customfield_10014',
        name: 'Enlace de epic',
        schema: { type: 'any', custom: 'com.pyxis.greenhopper.jira:gh-epic-link' },
      },
    ])).toBe('customfield_10014');
  });

  test('finds the link field by its English name', () => {
    expect(epicLinkFieldId([
      { id: 'customfield_10101', name: 'Epic Link' },
    ])).toBe('customfield_10101');
  });

  test('ignores a field that is not a custom Epic Link', () => {
    expect(epicLinkFieldId([
      { id: 'parent', name: 'Epic Link' },
      { id: 'customfield_10200', name: 'Sprint', schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
    ])).toBeNull();
  });

  test('builds a child query for native and company-managed epics', () => {
    expect(epicChildrenJql('PROJ-10', null)).toBe('parent = "PROJ-10" ORDER BY updated DESC');
    expect(epicChildrenJql('PROJ-10', 'customfield_10014'))
      .toBe('parent = "PROJ-10" OR cf[10014] = "PROJ-10" ORDER BY updated DESC');
    expect(epicChildrenJql('PROJ-10', 'customfield_not-numeric'))
      .toBe('parent = "PROJ-10" ORDER BY updated DESC');
  });
});

describe('epic issue types', () => {
  test('recognizes an epic by name, including a localized hierarchy', () => {
    expect(isEpicIssueType({ name: 'Epic', subtask: false })).toBe(true);
    expect(isEpicIssueType({ name: 'Épica', hierarchyLevel: 1 })).toBe(true);
    expect(isEpicIssueType({ name: 'Task', hierarchyLevel: 0 })).toBe(false);
    expect(isEpicIssueType({ name: 'Sub-task', subtask: true })).toBe(false);
    expect(isEpicIssueType(null)).toBe(false);
  });
});

describe('project keys', () => {
  test.each(['PROJ', 'ABC_2', 'ops'])('%s is a project key', (value) => {
    expect(isProjectKey(value)).toBe(true);
  });

  test.each(['', '1PROJ', 'PROJ X', 'PROJ"', 'PROJ/OTHER', 'PROJ-1'])('%s is not a project key', (value) => {
    expect(isProjectKey(value)).toBe(false);
  });
});
