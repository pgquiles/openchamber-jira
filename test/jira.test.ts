import { describe, expect, test } from 'bun:test';

import {
  buildJql,
  epicChildrenJql,
  epicLinkFieldId,
  escapeJqlString,
  explainFieldErrors,
  failureCode,
  isCustomFieldId,
  isEpicIssueType,
  isIssueKey,
  isProjectKey,
  jiraFieldNames,
  mapPriorityName,
  mapStatusCategory,
  priorityFilterNames,
  refusalMessage,
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
  test('defaults to active issues anyone owns, most recently updated first', () => {
    expect(buildJql(BASE, PRIORITIES)).toEqual({
      matchesNothing: false,
      jql: 'statusCategory != Done ORDER BY updated DESC',
    });
  });

  test('maps every declared state filter to a Jira status category', () => {
    expect(buildJql({ ...BASE, state: 'all' }, PRIORITIES).jql)
      .toBe('project is not EMPTY ORDER BY updated DESC');
    expect(buildJql({ ...BASE, state: 'todo' }, PRIORITIES).jql)
      .toBe('statusCategory = "To Do" ORDER BY updated DESC');
    expect(buildJql({ ...BASE, state: 'in-progress' }, PRIORITIES).jql)
      .toBe('statusCategory = "In Progress" ORDER BY updated DESC');
    expect(buildJql({ ...BASE, state: 'done' }, PRIORITIES).jql)
      .toBe('statusCategory = Done ORDER BY updated DESC');
  });

  test('leaves anyone unrestricted, scopes me to the assignee, and created to the reporter', () => {
    expect(buildJql({ ...BASE, people: 'any' }, PRIORITIES).jql)
      .toBe('statusCategory != Done ORDER BY updated DESC');
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
      .toBe('statusCategory != Done AND (key = "PROJ-42" OR summary ~ "PROJ-42") ORDER BY updated DESC');
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
      .toBe('statusCategory != Done AND priority is EMPTY ORDER BY updated DESC');
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

describe('field names in Jira errors', () => {
  const names = jiraFieldNames([
    { id: 'summary', name: 'Summary' },
    { id: 'resolution', name: 'Resolution' },
    { id: 'customfield_10046', name: 'Gate check' },
    { id: 'customfield_10047', name: '   ' },
    { id: 'customfield_10048', name: 'customfield_10048' },
    { id: 'customfield_10049', name: 'Cost $&' },
    { id: 7, name: 'Number id' },
    { id: 'customfield_10050' },
  ]);

  test('keeps a display name for every field that has a useful one', () => {
    expect([...names]).toEqual([
      ['summary', 'Summary'],
      ['resolution', 'Resolution'],
      ['customfield_10046', 'Gate check'],
      ['customfield_10049', 'Cost $&'],
    ]);
  });

  test('names a required custom field and keeps its id searchable', () => {
    expect(explainFieldErrors(
      'Jira answered 400: customfield_10046: Gate check is required.',
      ['customfield_10046'],
      names,
    )).toBe('Jira answered 400: Gate check (customfield_10046): Gate check is required.');
  });

  test('leaves a system field and an unknown id untouched', () => {
    const message = 'Jira answered 400: resolution: Resolution is required. customfield_99999: Nope.';
    expect(explainFieldErrors(message, ['resolution'], names)).toBe(message);
    expect(explainFieldErrors(message, ['customfield_99999'], names)).toBe(message);
  });

  test('explains every resolved field in one message', () => {
    expect(explainFieldErrors(
      'customfield_10046: one. customfield_10049: two.',
      ['customfield_10046', 'customfield_10049'],
      names,
    )).toBe('Gate check (customfield_10046): one. Cost $& (customfield_10049): two.');
  });

  test('ignores a name that is only the id', () => {
    expect(explainFieldErrors('customfield_10048: nope.', ['customfield_10048'], names))
      .toBe('customfield_10048: nope.');
  });

  test('marks only custom-field ids for a name', () => {
    expect(['customfield_10046', 'customfield_1', 'customfield_', 'customfield_x', 'resolution']
      .map(isCustomFieldId)).toEqual([true, true, false, false, false]);
  });
});

describe('refusal messages', () => {
  test('sends a refused credential to Settings → Integrations', () => {
    expect(refusalMessage(401, '', null)).toBe(
      'Jira refused the credential (401). It may have been revoked or expired; reconnect the account in Settings → Integrations.',
    );
  });

  test('keeps Jira’s own 401 text', () => {
    expect(refusalMessage(401, 'You are not authenticated.', null)).toBe(
      'Jira refused the credential (401): You are not authenticated. It may have been revoked or expired; reconnect the account in Settings → Integrations.',
    );
  });

  test('names a missing scope instead of blaming expiry', () => {
    expect(refusalMessage(401, 'Unauthorized; scope does not match', null)).toBe(
      'Jira refused the credential (401): Unauthorized; scope does not match. The token is missing a scope this action needs; reconnect with a token that has it.',
    );
  });

  test('reads a 403 as a permission problem in the project', () => {
    expect(refusalMessage(403, 'Forbidden', null)).toBe(
      'Jira answered 403: Forbidden. The account or token does not have permission for this project; check the project role, the token scopes, or an organization policy.',
    );
  });

  test('reads a 404 as a missing item or lost access', () => {
    expect(refusalMessage(404, 'Issue does not exist or you do not have permission to see it', null)).toBe(
      'Jira answered 404: Issue does not exist or you do not have permission to see it. The issue or project may be gone, or this account cannot see it.',
    );
  });

  test('keeps the reset time on a rate limit', () => {
    expect(refusalMessage(429, 'Rate limit exceeded.', 30_000)).toBe(
      'Jira rate-limited the request (429): Rate limit exceeded. Try again in 30 s.',
    );
  });

  test('answers a rate limit without a reset time', () => {
    expect(refusalMessage(429, '', null)).toBe('Jira rate-limited the request (429).');
  });

  test('leaves every other status as Jira worded it', () => {
    expect(refusalMessage(400, 'customfield_10046: Gate check is required.', null))
      .toBe('Jira answered 400: customfield_10046: Gate check is required.');
    expect(refusalMessage(500, 'boom', null)).toBe('Jira answered 500: boom.');
  });
});

describe('failure codes', () => {
  test.each([
    [400, 'JIRA_REJECTED'],
    [401, 'JIRA_UNAUTHORIZED'],
    [403, 'JIRA_FORBIDDEN'],
    [404, 'JIRA_NOT_FOUND'],
    [409, 'JIRA_CONFLICT'],
    [422, 'JIRA_REJECTED'],
    [429, 'JIRA_RATE_LIMITED'],
    [500, 'JIRA_UPSTREAM'],
    [503, 'JIRA_UPSTREAM'],
  ])('%i answers %s', (status, code) => {
    expect(failureCode(status)).toBe(code as never);
  });
});
