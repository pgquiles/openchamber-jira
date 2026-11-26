// A small Jira Cloud stand-in for the contract tests: REST v3 shapes, Basic
// auth, enhanced JQL search, transitions and comments. It evaluates the JQL
// this extension emits so the tests see real filtering, not a fixed answer.

import http from 'node:http';

export type FakeJiraPerson = {
  accountId: string;
  displayName: string;
  emailAddress: string;
  avatarUrl: string;
};

export type FakeJiraStatus = {
  id: string;
  name: string;
  categoryKey: 'new' | 'indeterminate' | 'done';
  categoryName: string;
};

export type FakeJiraComment = {
  id: string;
  body: unknown;
  authorId: string;
  created: string;
};

export type FakeJiraIssue = {
  id: string;
  key: string;
  projectKey: string;
  summary: string;
  statusId: string;
  priorityId: string | null;
  labels: string[];
  assigneeId: string | null;
  creatorId: string | null;
  updated: string;
  description: unknown;
  parentKey: string | null;
  subtasks: string[];
  comments: FakeJiraComment[];
  issueType?: 'Epic' | 'Task';
  epicLink?: string | null;
};

export type FakeJiraRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: string | null;
  authorization: string | null;
};

export type FakeJira = {
  origin: string;
  token: string;
  email: string;
  requests: FakeJiraRequest[];
  issues: Map<string, FakeJiraIssue>;
  /** Refuse the next request, optionally with a Retry-After header. */
  failNext: (status: number, message: string, headers?: Record<string, string>) => void;
  /** Refuse the next transition like a workflow screen that needs fields. */
  failNextTransition: (errors: Record<string, string>) => void;
  setPageSize: (size: number) => void;
  close: () => Promise<void>;
};

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const PROJECTS = [
  { id: '10000', key: 'PROJ', name: 'Project X' },
  { id: '10001', key: 'OPS', name: 'Operations' },
];

const STATUSES: Record<string, FakeJiraStatus> = {
  '1': { id: '1', name: 'To Do', categoryKey: 'new', categoryName: 'To Do' },
  '3': { id: '3', name: 'In Progress', categoryKey: 'indeterminate', categoryName: 'In Progress' },
  '5': { id: '5', name: 'Done', categoryKey: 'done', categoryName: 'Done' },
  '6': { id: '6', name: "Won't Do", categoryKey: 'done', categoryName: 'Done' },
  '10': { id: '10', name: 'Open', categoryKey: 'new', categoryName: 'To Do' },
  '11': { id: '11', name: 'Doing', categoryKey: 'indeterminate', categoryName: 'In Progress' },
  '12': { id: '12', name: 'Closed', categoryKey: 'done', categoryName: 'Done' },
};

const PROJECT_STATUSES: Record<string, string[]> = {
  PROJ: ['1', '3', '5', '6'],
  OPS: ['10', '11', '12'],
};

const PRIORITIES = [
  { id: '1', name: 'Highest' },
  { id: '2', name: 'High' },
  { id: '3', name: 'Medium' },
  { id: '4', name: 'Low' },
  { id: '5', name: 'Lowest' },
];

const PEOPLE: Record<string, FakeJiraPerson> = {
  'acc-1': {
    accountId: 'acc-1',
    displayName: 'Mona Lisa',
    emailAddress: 'mona@example.com',
    avatarUrl: 'https://avatar.example/mona.png',
  },
  'acc-2': {
    accountId: 'acc-2',
    displayName: 'Octo Kettle',
    emailAddress: 'octo@example.com',
    avatarUrl: 'https://avatar.example/octo.png',
  },
};

const paragraph = (value: string) => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });

const createIssues = (): FakeJiraIssue[] => [
  {
    id: '10001', key: 'PROJ-1', projectKey: 'PROJ', summary: 'Login fails on Safari',
    statusId: '3', priorityId: '1', labels: ['bug', 'frontend'], assigneeId: 'acc-1', creatorId: 'acc-2',
    updated: '2026-11-20T09:12:00.000+0000',
    description: {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Open Safari and retry the ' },
            { type: 'text', text: 'login', marks: [{ type: 'code' }] },
            { type: 'text', text: '.' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [paragraph('clear cookies')] },
            { type: 'listItem', content: [paragraph('retry')] },
          ],
        },
      ],
    },
    parentKey: null,
    subtasks: ['PROJ-2'],
    comments: [{
      id: 'c-1',
      body: { type: 'doc', version: 1, content: [paragraph('Reproduced on Safari 18.')] },
      authorId: 'acc-2',
      created: '2026-11-20T10:00:00.000+0000',
    }],
  },
  {
    id: '10002', key: 'PROJ-2', projectKey: 'PROJ', summary: 'Add a regression test for Safari',
    statusId: '1', priorityId: '3', labels: [], assigneeId: 'acc-2', creatorId: 'acc-1',
    updated: '2026-11-19T16:40:00.000+0000', description: null, parentKey: 'PROJ-1',
    subtasks: [], comments: [],
  },
  {
    id: '10003', key: 'PROJ-3', projectKey: 'PROJ', summary: 'Old login bug',
    statusId: '5', priorityId: '4', labels: ['bug'], assigneeId: 'acc-1', creatorId: 'acc-1',
    updated: '2026-11-18T11:05:00.000+0000', description: null, parentKey: null,
    subtasks: [], comments: [],
  },
  {
    id: '10004', key: 'PROJ-4', projectKey: 'PROJ', summary: "Won't fix the old flow",
    statusId: '6', priorityId: '4', labels: [], assigneeId: 'acc-1', creatorId: 'acc-1',
    updated: '2026-11-17T08:00:00.000+0000', description: null, parentKey: null,
    subtasks: [], comments: [],
  },
  {
    id: '10005', key: 'PROJ-5', projectKey: 'PROJ', summary: 'Draft the migration plan',
    statusId: '1', priorityId: '3', labels: ['docs'], assigneeId: 'acc-1', creatorId: 'acc-1',
    updated: '2026-11-22T07:30:00.000+0000', description: null, parentKey: null,
    subtasks: [], comments: [],
  },
  {
    id: '10011', key: 'OPS-1', projectKey: 'OPS', summary: 'Rotate the pantry keys',
    statusId: '10', priorityId: '2', labels: [], assigneeId: 'acc-1', creatorId: 'acc-2',
    updated: '2026-11-21T07:30:00.000+0000', description: null, parentKey: null,
    subtasks: [], comments: [],
  },
  {
    id: '10012', key: 'OPS-2', projectKey: 'OPS', summary: 'Replace the broken shelf',
    statusId: '12', priorityId: '4', labels: [], assigneeId: 'acc-2', creatorId: 'acc-1',
    updated: '2026-11-16T13:20:00.000+0000', description: null, parentKey: null,
    subtasks: [], comments: [],
  },
  {
    id: '10020', key: 'PROJ-10', projectKey: 'PROJ', summary: 'Safari login epic',
    statusId: '1', priorityId: '2', labels: ['epic'], assigneeId: 'acc-2', creatorId: 'acc-2',
    updated: '2026-11-24T09:00:00.000+0000', description: null, parentKey: null,
    subtasks: [], comments: [], issueType: 'Epic',
  },
  {
    id: '10021', key: 'PROJ-11', projectKey: 'PROJ', summary: 'Make Safari login survive reloads',
    statusId: '3', priorityId: '3', labels: [], assigneeId: 'acc-2', creatorId: 'acc-2',
    updated: '2026-11-25T09:00:00.000+0000', description: null, parentKey: null,
    subtasks: [], comments: [], epicLink: 'PROJ-10',
  },
  {
    id: '10022', key: 'PROJ-12', projectKey: 'PROJ', summary: 'Review Safari login logs',
    statusId: '5', priorityId: '4', labels: [], assigneeId: 'acc-2', creatorId: 'acc-2',
    updated: '2026-11-15T09:00:00.000+0000', description: null, parentKey: null,
    subtasks: [], comments: [], epicLink: 'PROJ-10',
  },
];

const TRANSITIONS: Record<string, Array<{ id: string; name: string; to: string }>> = {
  '1': [{ id: '11', name: 'Start progress', to: '3' }, { id: '12', name: 'Done', to: '5' }],
  '3': [{ id: '21', name: 'To Do', to: '1' }, { id: '22', name: 'Done', to: '5' }],
  '5': [{ id: '31', name: 'Reopen', to: '1' }, { id: '32', name: 'In Progress', to: '3' }],
  '6': [{ id: '31', name: 'Reopen', to: '1' }],
  '10': [{ id: '41', name: 'Start progress', to: '11' }, { id: '42', name: 'Done', to: '12' }],
  '11': [{ id: '43', name: 'To Do', to: '10' }, { id: '44', name: 'Done', to: '12' }],
  '12': [{ id: '45', name: 'Reopen', to: '10' }],
};

type JsonObject = Record<string, Json>;

const personJson = (id: string | null): Json => {
  if (id === null) return null;
  const person = PEOPLE[id];
  return person ? {
    accountId: person.accountId,
    displayName: person.displayName,
    emailAddress: person.emailAddress,
    avatarUrls: { '24x24': person.avatarUrl, '48x48': person.avatarUrl },
    active: true,
  } : null;
};

const statusJson = (id: string): Json => {
  const status = STATUSES[id];
  if (!status) return null;
  return {
    id: status.id,
    name: status.name,
    description: '',
    iconUrl: '',
    statusCategory: {
      id: status.categoryKey === 'new' ? 2 : status.categoryKey === 'indeterminate' ? 4 : 3,
      key: status.categoryKey,
      name: status.categoryName,
      colorName: status.categoryKey === 'new' ? 'blue-gray' : status.categoryKey === 'indeterminate' ? 'yellow' : 'green',
    },
  };
};

const priorityJson = (id: string | null): Json => {
  if (id === null) return null;
  const priority = PRIORITIES.find((entry) => entry.id === id);
  return priority ? { id: priority.id, name: priority.name, iconUrl: '', statusColor: '' } : null;
};

const unescapeJql = (value: string): string => value.replace(/\\(["\\])/g, '$1');

const splitJql = (body: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? '';
    if (char === '\\' && quoted) {
      current += char;
      if (index + 1 < body.length) current += body[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (!quoted && char === '(') depth += 1;
    if (!quoted && char === ')') depth -= 1;
    if (!quoted && depth === 0 && body.startsWith(' AND ', index)) {
      parts.push(current.trim());
      current = '';
      index += 4;
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
};

const categoryMatches = (issue: FakeJiraIssue, condition: string): boolean => {
  const status = STATUSES[issue.statusId];
  if (!status) return false;
  if (condition === 'statusCategory != Done') return status.categoryKey !== 'done';
  const name = condition.match(/^statusCategory = "((?:[^"\\]|\\.)*)"$/);
  if (name) {
    const wanted = unescapeJql(name[1] ?? '').toLowerCase();
    return status.categoryName.toLowerCase() === wanted || status.categoryKey === wanted;
  }
  if (condition === 'statusCategory = Done') return status.categoryKey === 'done';
  throw new Error(`fake Jira cannot evaluate "${condition}"`);
};

const matchesCondition = (issue: FakeJiraIssue, condition: string, accountId: string): boolean => {
  if (condition.startsWith('statusCategory ')) return categoryMatches(issue, condition);

  const project = condition.match(/^project = "((?:[^"\\]|\\.)*)"$/);
  if (project) return issue.projectKey.toLowerCase() === unescapeJql(project[1] ?? '').toLowerCase();

  if (condition === 'project is not EMPTY') return true;
  if (condition === 'assignee = currentUser()') return issue.assigneeId === accountId;
  if (condition === 'reporter = currentUser()') return issue.creatorId === accountId;
  if (condition === 'priority is EMPTY') return issue.priorityId === null;

  const priorityIn = condition.match(/^priority in \((.*)\)$/);
  if (priorityIn) {
    const names = [...(priorityIn[1] ?? '').matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((match) => unescapeJql(match[1] ?? '').toLowerCase());
    const current = PRIORITIES.find((entry) => entry.id === issue.priorityId)?.name.toLowerCase();
    return current !== undefined && names.includes(current);
  }

  const epicChildren = condition.match(/^parent = "((?:[^"\\]|\\.)*)"(?: OR cf\[(\d+)\] = "((?:[^"\\]|\\.)*)")?$/);
  if (epicChildren) {
    const parent = unescapeJql(epicChildren[1] ?? '').toLowerCase();
    if (issue.parentKey?.toLowerCase() === parent) return true;
    const custom = epicChildren[3];
    return custom !== undefined && issue.epicLink?.toLowerCase() === unescapeJql(custom).toLowerCase();
  }

  const keyIn = condition.match(/^key in \((.*)\)$/);
  if (keyIn) {
    const keys = [...(keyIn[1] ?? '').matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((match) => unescapeJql(match[1] ?? '').toLowerCase());
    return keys.includes(issue.key.toLowerCase());
  }

  const summary = condition.match(/^summary ~ "((?:[^"\\]|\\.)*)"$/);
  if (summary) return issue.summary.toLowerCase().includes(unescapeJql(summary[1] ?? '').toLowerCase());

  const keyOrSummary = condition.match(/^\(key = "((?:[^"\\]|\\.)*)" OR summary ~ "((?:[^"\\]|\\.)*)"\)$/);
  if (keyOrSummary) {
    const key = unescapeJql(keyOrSummary[1] ?? '').toLowerCase();
    const text = unescapeJql(keyOrSummary[2] ?? '').toLowerCase();
    return issue.key.toLowerCase() === key || issue.summary.toLowerCase().includes(text);
  }

  throw new Error(`fake Jira cannot evaluate "${condition}"`);
};

const matchesJql = (issue: FakeJiraIssue, jql: string, accountId: string): boolean => {
  const orderAt = jql.indexOf('ORDER BY ');
  const body = orderAt >= 0 ? jql.slice(0, orderAt) : jql;
  return splitJql(body).every((condition) => matchesCondition(issue, condition, accountId));
};

export const startFakeJira = ({ token = 'jira-token', email = 'mona@example.com', deploymentType = 'Cloud', requireAuth = false } = {}): Promise<FakeJira> => new Promise((resolve, reject) => {
  const issues = new Map(createIssues().map((issue) => [issue.key, issue]));
  const requests: FakeJiraRequest[] = [];
  const failures: Array<{ status: number; message: string; headers: Record<string, string> }> = [];
  let transitionFailure: Record<string, string> | null = null;
  let pageSize = 100;
  let nextComment = 0;

  const readBody = (req: http.IncomingMessage): Promise<string> => new Promise((done, fail) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => done(body));
    req.on('error', fail);
  });

  const acceptsBasic = (header: string | null): boolean => {
    if (!header?.startsWith('Basic ')) return false;
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    return separator > 0 && decoded.slice(0, separator) === email && decoded.slice(separator + 1) === token;
  };

  const issueByValue = (value: string): FakeJiraIssue | null => {
    if (issues.has(value.toUpperCase())) return issues.get(value.toUpperCase()) ?? null;
    for (const issue of issues.values()) if (issue.id === value) return issue;
    return null;
  };

  const projectOf = (issue: FakeJiraIssue) => PROJECTS.find((project) => project.key === issue.projectKey) ?? null;

  const issueTypeJson = (issue: FakeJiraIssue): Json => ({
    id: '10001',
    name: issue.issueType ?? 'Task',
    subtask: false,
    hierarchyLevel: issue.issueType === 'Epic' ? 1 : 0,
  });

  const issueStub = (issue: FakeJiraIssue): Json => ({
    id: issue.id,
    key: issue.key,
    self: `${origin}/rest/api/3/issue/${issue.id}`,
    fields: {
      summary: issue.summary,
      status: statusJson(issue.statusId),
      priority: priorityJson(issue.priorityId),
      project: projectJson(projectOf(issue)),
      updated: issue.updated,
      issuetype: issueTypeJson(issue),
    },
  });

  const issueJson = (issue: FakeJiraIssue): Json => {
    const parent = issue.parentKey ? issueByValue(issue.parentKey) : null;
    const subtasks = issue.subtasks.flatMap((key) => {
      const child = issueByValue(key);
      return child ? [issueStub(child)] : [];
    });
    return {
      id: issue.id,
      key: issue.key,
      self: `${origin}/rest/api/3/issue/${issue.id}`,
      fields: {
        summary: issue.summary,
        status: statusJson(issue.statusId),
        priority: priorityJson(issue.priorityId),
        labels: issue.labels,
        assignee: personJson(issue.assigneeId),
        reporter: personJson(issue.creatorId),
        project: projectJson(projectOf(issue)),
        updated: issue.updated,
        description: issue.description as Json,
        issuetype: issueTypeJson(issue),
        ...(issue.epicLink ? { customfield_10014: issue.epicLink } : {}),
        ...(parent ? { parent: issueStub(parent) } : {}),
        ...(subtasks.length > 0 ? { subtasks } : {}),
      },
    };
  };

  const projectJson = (project: { id: string; key: string; name: string } | null): Json => (
    project ? { id: project.id, key: project.key, name: project.name, projectTypeKey: 'software', simplified: true } : null
  );

  const commentJson = (comment: FakeJiraComment): Json => ({
    id: comment.id,
    body: comment.body as Json,
    author: personJson(comment.authorId),
    created: comment.created,
    updated: comment.created,
  });

  const jiraError = (status: number, message: string) => ({ status, body: { errorMessages: [message], errors: {} } as Json });

  const search = (url: URL, accountId: string) => {
    const jql = url.searchParams.get('jql') ?? '';
    const offset = Number(url.searchParams.get('nextPageToken') ?? '0');
    const requested = Number(url.searchParams.get('maxResults') ?? '50');
    const limit = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 50, pageSize));
    const matches = [...issues.values()]
      .filter((issue) => matchesJql(issue, jql, accountId))
      .sort((left, right) => right.updated.localeCompare(left.updated) || left.key.localeCompare(right.key));
    const page = matches.slice(offset, offset + limit);
    const next = offset + limit < matches.length ? String(offset + limit) : null;
    return {
      status: 200,
      body: {
        issues: page.map(issueJson),
        ...(next ? { nextPageToken: next } : {}),
        isLast: next === null,
      } as Json,
    };
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const send = (status: number, body: Json, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };

    readBody(req).then((body) => {
      requests.push({
        method: req.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        body: body === '' ? null : body,
        authorization: req.headers.authorization ?? null,
      });

      const failure = failures.shift();
      if (failure) {
        send(failure.status, jiraError(failure.status, failure.message).body, failure.headers);
        return;
      }

      const authorized = acceptsBasic(req.headers.authorization ?? null);
      const deployment = { deploymentType, version: '1001.0.0', versionNumbers: [1001, 0, 0], baseUrl: origin, serverTitle: 'Fake Jira' };

      if (url.pathname === '/rest/api/3/serverInfo' && req.method === 'GET') {
        if (requireAuth && !authorized) {
          send(401, jiraError(401, 'You are not authenticated.').body);
          return;
        }
        send(200, deployment as Json);
        return;
      }

      if (!authorized) {
        send(401, jiraError(401, 'You are not authenticated.').body);
        return;
      }

      if (url.pathname === '/rest/api/3/myself' && req.method === 'GET') {
        send(200, personJson('acc-1'));
        return;
      }

      if (url.pathname === '/rest/api/3/priority' && req.method === 'GET') {
        send(200, PRIORITIES as unknown as Json);
        return;
      }

      if (url.pathname === '/rest/api/3/field' && req.method === 'GET') {
        send(200, [
          { id: 'summary', name: 'Summary' },
          { id: 'parent', name: 'Parent' },
          {
            id: 'customfield_10014',
            name: 'Epic Link',
            schema: { type: 'any', custom: 'com.pyxis.greenhopper.jira:gh-epic-link' },
          },
        ] as unknown as Json);
        return;
      }

      if (url.pathname === '/rest/api/3/search/jql' && req.method === 'GET') {
        const answer = search(url, 'acc-1');
        send(answer.status, answer.body);
        return;
      }

      if (url.pathname === '/rest/api/3/project/search' && req.method === 'GET') {
        const startAt = Number(url.searchParams.get('startAt') ?? '0');
        const maxResults = Math.min(Number(url.searchParams.get('maxResults') ?? '100'), 100);
        const page = PROJECTS.slice(startAt, startAt + maxResults);
        send(200, {
          self: `${origin}/rest/api/3/project/search`,
          maxResults,
          startAt,
          total: PROJECTS.length,
          isLast: startAt + maxResults >= PROJECTS.length,
          values: page.map(projectJson),
        } as Json);
        return;
      }

      const projectStatuses = url.pathname.match(/^\/rest\/api\/3\/project\/([^/]+)\/statuses$/);
      if (projectStatuses && req.method === 'GET') {
        const key = decodeURIComponent(projectStatuses[1] ?? '').toUpperCase();
        const ids = PROJECT_STATUSES[key];
        if (!ids) {
          send(404, jiraError(404, `No project could be found with key '${key}'.`).body);
          return;
        }
        send(200, [{
          id: '10001',
          name: 'Task',
          subtask: false,
          statuses: ids.map((id) => statusJson(id)),
        }] as Json);
        return;
      }

      const transitions = url.pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)\/transitions$/);
      if (transitions) {
        const issue = issueByValue(decodeURIComponent(transitions[1] ?? ''));
        if (!issue) {
          send(404, jiraError(404, 'Issue does not exist or you do not have permission to see it.').body);
          return;
        }
        if (req.method === 'GET') {
          send(200, {
            expand: 'transitions',
            transitions: (TRANSITIONS[issue.statusId] ?? []).map((transition) => ({
              id: transition.id,
              name: transition.name,
              to: statusJson(transition.to),
            })),
          } as Json);
          return;
        }
        if (req.method === 'POST') {
          const parsed = JSON.parse(body || '{}') as { transition?: { id?: unknown } };
          const wanted = String(parsed.transition?.id ?? '');
          const transition = (TRANSITIONS[issue.statusId] ?? []).find((entry) => entry.id === wanted);
          if (!transition) {
            send(400, jiraError(400, 'Transition id is not valid for this issue.').body);
            return;
          }
          if (transitionFailure) {
            const errors = transitionFailure;
            transitionFailure = null;
            send(400, { errorMessages: [], errors } as Json);
            return;
          }
          issue.statusId = transition.to;
          res.writeHead(204);
          res.end();
          return;
        }
      }

      const comments = url.pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)\/comment$/);
      if (comments) {
        const issue = issueByValue(decodeURIComponent(comments[1] ?? ''));
        if (!issue) {
          send(404, jiraError(404, 'Issue does not exist or you do not have permission to see it.').body);
          return;
        }
        if (req.method === 'GET') {
          const maxResults = Number(url.searchParams.get('maxResults') ?? '100');
          const newestFirst = url.searchParams.get('orderBy')?.startsWith('-') ?? false;
          const comments = newestFirst ? [...issue.comments].reverse() : issue.comments;
          send(200, {
            startAt: 0,
            maxResults,
            total: issue.comments.length,
            comments: comments.slice(0, maxResults).map(commentJson),
          } as Json);
          return;
        }
        if (req.method === 'POST') {
          const parsed = JSON.parse(body || '{}') as { body?: unknown };
          const value = parsed.body as { type?: unknown; content?: unknown } | undefined;
          if (!value || value.type !== 'doc' || !Array.isArray(value.content)) {
            send(400, jiraError(400, 'The comment body must be an Atlassian document.').body);
            return;
          }
          nextComment += 1;
          const comment: FakeJiraComment = {
            id: `c-new-${nextComment}`,
            body: value,
            authorId: 'acc-1',
            created: '2026-11-26T12:00:00.000+0000',
          };
          issue.comments.push(comment);
          send(201, commentJson(comment));
          return;
        }
      }

      const one = url.pathname.match(/^\/rest\/api\/3\/issue\/([^/]+)$/);
      if (one && req.method === 'GET') {
        const issue = issueByValue(decodeURIComponent(one[1] ?? ''));
        if (!issue) {
          send(404, jiraError(404, 'Issue does not exist or you do not have permission to see it.').body);
          return;
        }
        send(200, issueJson(issue));
        return;
      }

      send(404, jiraError(404, `No route for ${req.method} ${url.pathname}.`).body);
    }).catch(() => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errorMessages: ['fake Jira failed to read the request'] }));
    });
  });

  let origin = '';

  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      reject(new Error('fake Jira has no port'));
      return;
    }
    origin = `http://127.0.0.1:${address.port}`;
    resolve({
      origin,
      token,
      email,
      requests,
      issues,
      failNext: (status, message, headers = {}) => { failures.push({ status, message, headers }); },
      failNextTransition: (errors) => { transitionFailure = errors; },
      setPageSize: (size) => { pageSize = Math.max(1, size); },
      close: () => new Promise((done) => { server.close(() => done()); }),
    });
  });
});
