// Jira Cloud tracker for OpenChamber. OpenChamber keeps the API token and adds
// Basic auth (account email + token) through the outbound proxy; this service
// only builds REST v3 calls and maps Jira's shapes to the neutral tracker shape.

import http from 'node:http';

import {
  TRACKER_PROVIDER_ERROR_MESSAGE_MAX,
  TRACKER_PROVIDER_PATH,
  TrackerOutboundError,
  createTrackerOutbound,
  readTrackerProviderRequest,
  type SourceControlJsonObject,
  type SourceControlOutboundResponse,
  type TrackerProviderComment,
  type TrackerProviderContainer,
  type TrackerProviderDataByMethod,
  type TrackerProviderError,
  type TrackerProviderInputs,
  type TrackerProviderItem,
  type TrackerProviderItemSummary,
  type TrackerProviderLiveSummary,
  type TrackerProviderMethod,
  type TrackerProviderPerson,
  type TrackerProviderResult,
  type TrackerProviderWorkflowState,
} from '@openchamber/sdk';

import { adfToMarkdown, markdownToAdf } from './adf.ts';
import { buildJql, epicChildrenJql, epicLinkFieldId, escapeJqlString, explainFieldErrors, failureCode, isCustomFieldId, isEpicIssueType, isIssueKey, isProjectKey, jiraFieldNames, mapPriorityName, mapStatusCategory, refusalMessage } from './jira.ts';

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const serviceToken = process.env.OPENCHAMBER_SERVICE_TOKEN ?? '';
if (!port || !serviceToken) {
  console.error('OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required');
  process.exit(1);
}
const outbound = createTrackerOutbound({ env: process.env });

type JiraPerson = {
  accountId?: unknown;
  displayName?: unknown;
  emailAddress?: unknown;
  avatarUrls?: Record<string, unknown>;
};

type JiraStatus = {
  id?: unknown;
  name?: unknown;
  statusCategory?: { key?: unknown; name?: unknown };
};

type JiraIssue = {
  id?: unknown;
  key?: unknown;
  fields?: {
    summary?: unknown;
    status?: JiraStatus;
    priority?: { name?: unknown } | null;
    labels?: unknown;
    assignee?: JiraPerson | null;
    reporter?: JiraPerson | null;
    project?: JiraProject | null;
    updated?: unknown;
    description?: unknown;
    parent?: JiraIssue;
    subtasks?: JiraIssue[];
    issuetype?: { name?: unknown; subtask?: unknown; hierarchyLevel?: unknown };
    /** Custom fields, including a company-managed Epic Link, arrive by id. */
    [field: string]: unknown;
  };
};

type JiraSearch = {
  issues?: JiraIssue[];
  nextPageToken?: unknown;
  isLast?: unknown;
};

type JiraComment = {
  id?: unknown;
  body?: unknown;
  author?: JiraPerson | null;
  created?: unknown;
};

type JiraTransitions = {
  transitions?: Array<{ id?: unknown; name?: unknown; to?: JiraStatus }>;
};

type JiraProjectStatuses = Array<{ id?: unknown; name?: unknown; statuses?: JiraStatus[] }>;

type JiraProjectPage = {
  values?: Array<{ id?: unknown; key?: unknown; name?: unknown }>;
  isLast?: unknown;
};

type Call = { instance: string; handle: string };

class CallError extends Error {
  readonly status: number;
  /** OpenChamber keeps a non-2xx status only when the extension also sends a
   * machine code, so every failure that should keep Jira's status carries one. */
  readonly code: string | undefined;
  /** The custom-field ids a Jira `errors` object named, for the display name. */
  readonly fields: readonly string[];
  constructor(message: string, status: number, details: { code?: string; fields?: readonly string[] } = {}) {
    super(message);
    this.status = status;
    this.code = details.code;
    this.fields = details.fields ?? [];
  }
}

const truncate = (value: string, max: number): string => (value.length <= max ? value : value.slice(0, max));

type JiraFailure = { detail: string; fields: string[] };

const jiraFailure = (response: SourceControlOutboundResponse): JiraFailure => {
  const fields: string[] = [];
  try {
    const parsed = JSON.parse(response.body) as { errorMessages?: unknown; errors?: unknown };
    const messages: string[] = [];
    if (Array.isArray(parsed.errorMessages)) {
      messages.push(...parsed.errorMessages.filter((value): value is string => typeof value === 'string'));
    }
    if (parsed.errors && typeof parsed.errors === 'object' && !Array.isArray(parsed.errors)) {
      for (const [field, value] of Object.entries(parsed.errors)) {
        if (typeof value !== 'string') continue;
        messages.push(`${field}: ${value}`);
        if (isCustomFieldId(field)) fields.push(field);
      }
    }
    if (messages.length > 0) return { detail: messages.join(' '), fields };
  } catch {
    // The status and the raw body say what they can.
  }
  return { detail: response.body.trim().slice(0, 300), fields };
};

const serverFailure = (response: SourceControlOutboundResponse): CallError => {
  const { detail, fields } = jiraFailure(response);
  const message = refusalMessage(response.status, detail, retryAfterMs(response.headers));
  return new CallError(message, response.status, { code: failureCode(response.status), fields });
};

/** A header by name, whatever its case; the host relays lower-case names. */
const headerValue = (headers: Record<string, string> | undefined, name: string): string | null => {
  if (!headers) return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== name) continue;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return null;
};

/**
 * `Retry-After` in milliseconds: delta-seconds, or the HTTP-date form some
 * proxies send instead. Null when Jira asked for no particular wait.
 */
const retryAfterMs = (headers: Record<string, string> | undefined): number | null => {
  const value = headerValue(headers, 'retry-after');
  if (value === null) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BUDGET_MS = 10_000;

/**
 * Reads Jira's reset time and retries a read while the wait fits the budget.
 * Writes are never retried: a 429 means the request was refused, but a 503 or
 * a timeout can arrive after Jira acted, and repeating a comment or a
 * transition would duplicate it.
 */
const retryableRead = (method: 'GET' | 'POST', status: number, attempt: number): boolean => (
  method === 'GET' && (status === 429 || status === 503) && attempt < RETRY_MAX_ATTEMPTS
);

const api = async <T,>(
  call: Call,
  method: 'GET' | 'POST',
  path: string,
  options: { query?: Record<string, string>; body?: unknown } = {},
): Promise<T> => {
  const deadline = Date.now() + RETRY_BUDGET_MS;
  for (let attempt = 1; ; attempt += 1) {
    const response = await outbound.request(call.handle, {
      method,
      path,
      ...(options.query ? { query: options.query } : {}),
      headers: options.body
        ? { accept: 'application/json', 'content-type': 'application/json' }
        : { accept: 'application/json' },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (response.status >= 400) {
      const failure = serverFailure(response);
      if (!retryableRead(method, response.status, attempt)) throw failure;
      // Nothing to wait on, or a wait past the budget: report it now rather
      // than holding the host's read open.
      const wait = retryAfterMs(response.headers);
      if (wait === null || Date.now() + wait > deadline) throw failure;
      await sleep(wait);
      continue;
    }
    if (response.status === 204 || response.body.trim() === '') return undefined as T;
    try {
      return JSON.parse(response.body) as T;
    } catch {
      throw new CallError('Jira answered with something other than JSON.', 502, { code: 'JIRA_MALFORMED' });
    }
  }
};

const orNull = async <T,>(request: Promise<T>): Promise<T | null> => {
  try {
    return await request;
  } catch (error) {
    if (error instanceof CallError && error.status === 404) return null;
    throw error;
  }
};

const seg = encodeURIComponent;

const textOf = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const itemUrl = (instance: string, key: string): string => `${instance.replace(/\/+$/, '')}/browse/${seg(key)}`;

const personOf = (person: JiraPerson | null | undefined): TrackerProviderPerson | null => {
  if (!person || typeof person !== 'object') return null;
  const name = textOf(person.displayName) ?? textOf(person.emailAddress);
  const avatar = textOf(person.avatarUrls?.['48x48']) ?? textOf(person.avatarUrls?.['24x24']);
  return {
    name: name === null ? null : truncate(name, 256),
    avatarUrl: avatar === null ? null : truncate(avatar, 2_048),
  };
};

const stateOf = (status: JiraStatus | undefined): TrackerProviderItemSummary['state'] => {
  if (!status || typeof status !== 'object') return null;
  const id = textOf(status.id);
  const name = textOf(status.name);
  if (!name) return null;
  return {
    id,
    name: truncate(name, 256),
    category: mapStatusCategory(status.statusCategory),
  };
};

type JiraProject = { id?: unknown; key?: unknown; name?: unknown };

const containerOf = (project: JiraProject | null | undefined): TrackerProviderContainer | null => {
  if (!project || typeof project !== 'object') return null;
  const key = textOf(project.key);
  const id = key ?? textOf(project.id);
  const name = textOf(project.name);
  if (!id || !name) return null;
  return { id, key, name: truncate(name, 256) };
};

const labelsOf = (labels: unknown): TrackerProviderItemSummary['labels'] => {
  if (!Array.isArray(labels)) return [];
  return labels.flatMap((value) => {
    if (typeof value !== 'string' || value.trim() === '') return [];
    const name = truncate(value, 256);
    return [{ id: truncate(value, 1_024), name, color: null }];
  }).slice(0, 100);
};

const summaryOf = (call: Call, issue: JiraIssue): TrackerProviderItemSummary | null => {
  const key = textOf(issue.key) ?? (issue.id === undefined ? null : String(issue.id));
  if (!key) return null;
  const fields = issue.fields ?? {};
  const title = textOf(fields.summary) ?? '(no summary)';
  return {
    id: truncate(key, 1_024),
    identifier: truncate(key, 128),
    title: truncate(title, 4_096),
    url: itemUrl(call.instance, key),
    state: stateOf(fields.status),
    priority: fields.priority ? mapPriorityName(fields.priority.name) : 'none',
    labels: labelsOf(fields.labels),
    assignee: personOf(fields.assignee),
    container: containerOf(fields.project),
    updatedAt: textOf(fields.updated),
  };
};

const progressOf = (children: TrackerProviderItemSummary[], more: boolean): TrackerProviderItem['progress'] => {
  if (children.length === 0) return null;
  const done = children.filter((child) => child.state?.category === 'done').length;
  return { total: children.length, done, more };
};

const descriptionOf = (issue: JiraIssue, instance: string): string | null => {
  const markdown = adfToMarkdown(issue.fields?.description, { baseUrl: instance });
  return markdown === '' ? null : truncate(markdown, 262_144);
};

const commentOf = (comment: JiraComment, instance: string): TrackerProviderComment | null => {
  const id = comment.id === undefined ? null : String(comment.id);
  if (!id) return null;
  return {
    id: truncate(id, 1_024),
    body: truncate(adfToMarkdown(comment.body, { baseUrl: instance }), 65_536),
    createdAt: textOf(comment.created),
    author: personOf(comment.author),
  };
};

const ISSUE_FIELDS = 'summary,status,priority,labels,assignee,reporter,project,updated,description,parent,subtasks,issuetype';
const LIST_FIELDS = 'summary,status,priority,labels,assignee,project,updated';

const EPIC_FIELD_TTL_MS = 5 * 60 * 1000;
const epicFieldCache = new Map<string, { id: string | null; expiresAt: number }>();

// The host refuses a tracker answer over 2 MB; leave room for the description
// and the item around the comments.
const COMMENTS_BYTE_BUDGET = 1_000_000;

/**
 * The Epic Link custom field id for a site, discovered once. A site without
 * the field answers null quickly instead of failing every detail read.
 */
const epicLinkField = async (call: Call): Promise<string | null> => {
  const cached = epicFieldCache.get(call.instance);
  if (cached && cached.expiresAt > Date.now()) return cached.id;
  let id: string | null = null;
  try {
    id = epicLinkFieldId(await api<unknown>(call, 'GET', '/rest/api/3/field'));
  } catch {
    id = null;
  }
  epicFieldCache.set(call.instance, {
    id,
    // A missing field is cheap to recheck; a found one is stable.
    expiresAt: Date.now() + (id === null ? 60_000 : EPIC_FIELD_TTL_MS),
  });
  return id;
};

const loadIssue = async (call: Call, id: string, extraFields: readonly string[] = []): Promise<JiraIssue | null> => {
  const fields = [...new Set([...ISSUE_FIELDS.split(','), ...extraFields])].join(',');
  return orNull(api<JiraIssue>(call, 'GET', `/rest/api/3/issue/${seg(id)}`, { query: { fields } }));
};

/** The epic key a company-managed Epic Link holds, whether string or object. */
const epicLinkOf = (value: unknown): string | null => {
  const direct = textOf(value);
  if (direct) return isIssueKey(direct) ? direct : null;
  if (typeof value !== 'object' || value === null) return null;
  const key = textOf((value as { key?: unknown }).key);
  return key && isIssueKey(key) ? key : null;
};

const loadItem = async (call: Call, id: string, withComments: boolean): Promise<TrackerProviderItem | null> => {
  const epicFieldId = await epicLinkField(call);
  const extraFields = epicFieldId ? [epicFieldId] : [];
  const issue = await loadIssue(call, id, extraFields);
  if (!issue) return null;
  const summary = summaryOf(call, issue);
  if (!summary) return null;

  const item: TrackerProviderItem = {
    ...summary,
    description: descriptionOf(issue, call.instance),
  };

  const fields = issue.fields ?? {};
  let parent = fields.parent ? summaryOf(call, fields.parent) : null;
  if (!parent && epicFieldId) {
    const epicKey = epicLinkOf(fields[epicFieldId]);
    if (epicKey && epicKey.toUpperCase() !== summary.identifier.toUpperCase()) {
      const epic = await loadIssue(call, epicKey, extraFields);
      parent = epic ? summaryOf(call, epic) : null;
    }
  }
  if (parent) item.parent = parent;

  const children: TrackerProviderItemSummary[] = [];
  const seen = new Set<string>();
  for (const child of fields.subtasks ?? []) {
    const value = summaryOf(call, child);
    if (!value || seen.has(value.id)) continue;
    seen.add(value.id);
    children.push(value);
  }

  // Native (team-managed) epics use `parent`, company-managed ones the Epic
  // Link field; the combined query answers either.
  let moreChildren = false;
  if (isEpicIssueType(fields.issuetype)) {
    const answer = await api<JiraSearch>(call, 'GET', '/rest/api/3/search/jql', {
      query: {
        jql: epicChildrenJql(summary.identifier, epicFieldId),
        maxResults: '100',
        fields: LIST_FIELDS,
      },
    });
    for (const child of answer.issues ?? []) {
      const value = summaryOf(call, child);
      if (!value || seen.has(value.id) || value.id === summary.id) continue;
      seen.add(value.id);
      children.push(value);
    }
    moreChildren = textOf(answer.nextPageToken) !== null || answer.isLast === false;
  }

  const shown = children.slice(0, 100);
  if (shown.length > 0) item.children = shown;
  const truncated = moreChildren || children.length > shown.length;
  if (truncated) item.childrenMore = true;
  const progress = progressOf(shown, truncated);
  if (progress) item.progress = progress;

  if (withComments) {
    const answer = await api<{ comments?: JiraComment[] }>(
      call,
      'GET',
      `/rest/api/3/issue/${seg(summary.identifier)}/comment`,
      { query: { maxResults: '100', orderBy: '-created' } },
    );
    const comments = (answer.comments ?? []).flatMap((comment) => {
      const value = commentOf(comment, call.instance);
      return value ? [value] : [];
    }).reverse(); // newest first from Jira, chronological in the preview
    // Keep the preview inside the host's response budget: drop the oldest
    // comments first, so the recent conversation survives.
    const byteLength = (comment: TrackerProviderComment): number => Buffer.byteLength(comment.body, 'utf8');
    let total = comments.reduce((sum, comment) => sum + byteLength(comment), 0);
    let first = 0;
    while (first < comments.length - 1 && total > COMMENTS_BYTE_BUDGET) {
      total -= byteLength(comments[first] as TrackerProviderComment);
      first += 1;
    }
    item.comments = comments.slice(first);
  }

  return item;
};

const PRIORITY_TTL_MS = 5 * 60 * 1000;
const priorityCache = new Map<string, { names: string[]; expiresAt: number }>();

const sitePriorities = async (call: Call): Promise<string[]> => {
  const cached = priorityCache.get(call.instance);
  if (cached && cached.expiresAt > Date.now()) return cached.names;
  const answer = await api<Array<{ name?: unknown }>>(call, 'GET', '/rest/api/3/priority');
  const names = Array.isArray(answer)
    ? answer.flatMap((priority) => (typeof priority?.name === 'string' ? [priority.name] : []))
    : [];
  priorityCache.set(call.instance, { names, expiresAt: Date.now() + PRIORITY_TTL_MS });
  return names;
};

type Handlers = {
  [M in TrackerProviderMethod]: (call: Call, input: TrackerProviderInputs[M]) => Promise<TrackerProviderDataByMethod[M]>;
};

const handlers: Handlers = {
  'auth.probe': async (call) => {
    let response: SourceControlOutboundResponse;
    try {
      response = await outbound.request(call.handle, {
        method: 'GET',
        path: '/rest/api/3/serverInfo',
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      return {
        supported: false,
        message: `${call.instance} could not be reached: ${error instanceof Error ? error.message : 'unknown error'}`,
      };
    }

    // A private Jira Cloud site answers an anonymous REST call with a redirect
    // to its sign-in page. The host relays a redirect's status but not its
    // Location header, so the status alone is what the probe can read.
    if (response.status === 401 || response.status === 403 || (response.status >= 300 && response.status < 400)) {
      return { supported: true, message: 'Jira is reachable; sign in to connect the account.' };
    }
    if (response.status !== 200) {
      return { supported: false, message: `${call.instance} answered ${response.status} to /rest/api/3/serverInfo.` };
    }

    let info: { deploymentType?: unknown } | null;
    try {
      info = JSON.parse(response.body) as { deploymentType?: unknown };
    } catch {
      info = null;
    }
    if (!info || typeof info !== 'object') {
      return { supported: false, message: `${call.instance} is not a Jira Cloud site.` };
    }
    if (info.deploymentType === 'Cloud') return { supported: true };
    return {
      supported: false,
      message: `${call.instance} reports ${textOf(info.deploymentType) ?? 'an unknown deployment'}; only Jira Cloud is supported.`,
    };
  },

  'auth.verify': async (call) => {
    const info = await api<{ deploymentType?: unknown }>(call, 'GET', '/rest/api/3/serverInfo');
    if (info && typeof info.deploymentType === 'string' && info.deploymentType !== 'Cloud') {
      throw new CallError(`Only Jira Cloud is supported; ${call.instance} reports ${info.deploymentType}.`, 400, { code: 'UNSUPPORTED_SITE' });
    }

    const me = await api<JiraPerson>(call, 'GET', '/rest/api/3/myself');
    const id = textOf(me.accountId);
    if (!id) throw new CallError('Jira answered no account id for this credential.', 502, { code: 'JIRA_MALFORMED' });

    // A credential that can read no project cannot fill the board. Refuse it
    // here, where the message is shown, instead of leaving an empty board that
    // looks connected. Read-only access is fine: the write permissions are
    // proven by the action that needs them, not at connect.
    const projects = await api<{ values?: unknown }>(call, 'GET', '/rest/api/3/project/search', {
      query: { action: 'browse', maxResults: '1' },
    });
    if (!Array.isArray(projects.values) || projects.values.length === 0) {
      throw new CallError(
        'This Jira account cannot browse any project. Add it to a project, or check the token scopes, then connect again.',
        403,
        { code: 'NO_PROJECT_ACCESS' },
      );
    }

    const login = textOf(me.emailAddress) ?? textOf(me.displayName);
    const account: TrackerProviderDataByMethod['auth.verify']['account'] = { id, login };
    const name = textOf(me.displayName);
    if (name) account.name = name;
    const avatarUrl = textOf(me.avatarUrls?.['48x48']) ?? textOf(me.avatarUrls?.['24x24']);
    if (avatarUrl) account.avatarUrl = avatarUrl;
    return { account };
  },

  'items.list': async (call, input) => {
    const filters = {
      state: input.state,
      people: input.people,
      priority: input.priority,
      containerId: input.containerId,
      ...(input.query === undefined ? {} : { query: input.query }),
    };
    const jqlFor = (names: readonly string[]) => {
      try {
        return buildJql(filters, names);
      } catch (error) {
        throw new CallError(error instanceof Error ? error.message : 'Jira filter is not valid.', 400, { code: 'INVALID' });
      }
    };

    // Validate the filters before a priority lookup; an invalid state or
    // project key should cost no request.
    jqlFor([]);
    const needsPriorities = input.priority !== 'all' && input.priority !== 'none';
    const priorityNames = needsPriorities ? await sitePriorities(call) : [];
    const { jql, matchesNothing } = jqlFor(priorityNames);
    if (matchesNothing) return { items: [], cursor: null, hasMore: false };

    const query: Record<string, string> = { jql, maxResults: '100', fields: LIST_FIELDS };
    if (input.cursor) query.nextPageToken = input.cursor;
    const answer = await api<JiraSearch>(call, 'GET', '/rest/api/3/search/jql', { query });
    const items = (answer.issues ?? []).flatMap((issue) => {
      const value = summaryOf(call, issue);
      return value ? [value] : [];
    });
    const next = textOf(answer.nextPageToken);
    const hasMore = next !== null && answer.isLast !== true;
    return { items, cursor: hasMore ? next : null, hasMore };
  },

  'items.get': async (call, input) => ({
    item: await loadItem(call, input.id, true),
  }),

  'items.updateState': async (call, input) => {
    const answer = await orNull(api<JiraTransitions>(
      call,
      'GET',
      `/rest/api/3/issue/${seg(input.id)}/transitions`,
    ));
    if (!answer) return { item: null };

    const transitions = Array.isArray(answer.transitions) ? answer.transitions : [];
    // `stateId` comes from `states.list`, so it is a status id: match the
    // transition that lands on it, never a transition id that happens to
    // share the number.
    const transition = transitions.find((entry) => String(entry.to?.id ?? '') === input.stateId);
    const transitionId = transition ? textOf(transition.id) : null;
    if (!transitionId) {
      throw new CallError(`Jira has no transition from this issue's current status to ${input.stateId}.`, 409, { code: 'NO_TRANSITION' });
    }

    await api(call, 'POST', `/rest/api/3/issue/${seg(input.id)}/transitions`, {
      body: { transition: { id: transitionId } },
    });
    return { item: await loadItem(call, input.id, false) };
  },

  'items.liveSummaries': async (call, input) => {
    const identifiers = [...new Set(input.identifiers
      .map((value) => value.trim())
      .filter((value) => isIssueKey(value))
      .map((value) => value.toUpperCase()))].slice(0, 50);
    if (identifiers.length === 0) return { items: [] };

    const jql = `key in (${identifiers.map((value) => `"${escapeJqlString(value)}"`).join(', ')})`;
    const answer = await api<JiraSearch>(call, 'GET', '/rest/api/3/search/jql', {
      query: { jql, maxResults: '50', fields: 'summary,status' },
    });
    const items = (answer.issues ?? []).flatMap((issue): TrackerProviderLiveSummary[] => {
      const key = textOf(issue.key);
      const status = issue.fields?.status;
      const name = textOf(status?.name);
      if (!key || !name) return [];
      return [{
        identifier: truncate(key.toUpperCase(), 128),
        title: truncate(textOf(issue.fields?.summary) ?? '(no summary)', 4_096),
        state: {
          name: truncate(name, 256),
          category: mapStatusCategory(status?.statusCategory) ?? 'todo',
        },
      }];
    });
    return { items };
  },

  'states.list': async (call, input) => {
    if (!isProjectKey(input.containerId)) {
      throw new CallError(`"${input.containerId}" is not a Jira project key.`, 400, { code: 'INVALID' });
    }
    const answer = await api<JiraProjectStatuses>(
      call,
      'GET',
      `/rest/api/3/project/${seg(input.containerId)}/statuses`,
    );
    const seen = new Set<string>();
    const states: TrackerProviderWorkflowState[] = [];
    for (const group of Array.isArray(answer) ? answer : []) {
      for (const status of group.statuses ?? []) {
        const id = textOf(status.id);
        const name = textOf(status.name);
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        states.push({
          id,
          name: truncate(name, 256),
          category: mapStatusCategory(status.statusCategory),
          position: states.length,
        });
        if (states.length >= 200) break;
      }
      if (states.length >= 200) break;
    }
    return { states };
  },

  'containers.list': async (call) => {
    const containers: TrackerProviderContainer[] = [];
    let startAt = 0;
    while (containers.length < 500) {
      const answer = await api<JiraProjectPage>(call, 'GET', '/rest/api/3/project/search', {
        query: { startAt: String(startAt), maxResults: '100' },
      });
      const values = Array.isArray(answer.values) ? answer.values : [];
      for (const project of values) {
        const key = textOf(project.key);
        const id = key ?? textOf(project.id);
        const name = textOf(project.name);
        if (!id || !name) continue;
        containers.push({ id: truncate(id, 1_024), key, name: truncate(name, 256) });
        if (containers.length >= 500) break;
      }
      if (values.length === 0) break;
      if (answer.isLast === true) break;
      startAt += values.length;
      // A short page is the last one even when the site omits `isLast`.
      if (values.length < 100) break;
    }
    return { containers };
  },

  'comments.create': async (call, input) => {
    let body: ReturnType<typeof markdownToAdf>;
    try {
      body = markdownToAdf(input.body);
    } catch {
      throw new CallError('The comment body is empty.', 400, { code: 'INVALID' });
    }

    const comment = await orNull(api<JiraComment>(
      call,
      'POST',
      `/rest/api/3/issue/${seg(input.identifier)}/comment`,
      { body: { body } },
    ));
    if (!comment) return { comment: null };
    const id = comment.id === undefined ? null : String(comment.id);
    if (!id) throw new CallError('Jira created the comment but answered no id.', 502, { code: 'JIRA_MALFORMED' });
    return { comment: { id: truncate(id, 1_024) } };
  },
};

const FIELD_NAME_TTL_MS = 5 * 60 * 1000;
const fieldNameCache = new Map<string, { names: Map<string, string> | null; expiresAt: number }>();

/**
 * A site's field display names, read once and kept for a few minutes. A failed
 * read is not fatal: the caller keeps the raw id. The read is forced through
 * the same outbound handle the failing call already holds.
 */
const fieldNamesFor = async (call: Call): Promise<Map<string, string> | null> => {
  const cached = fieldNameCache.get(call.instance);
  if (cached && cached.expiresAt > Date.now()) return cached.names;
  let names: Map<string, string> | null = null;
  try {
    names = jiraFieldNames(await api<unknown>(call, 'GET', '/rest/api/3/field'));
  } catch {
    names = null;
  }
  fieldNameCache.set(call.instance, {
    names,
    // A site that could not be read is worth retrying sooner than one that
    // simply has no custom fields.
    expiresAt: Date.now() + (names === null ? 60_000 : FIELD_NAME_TTL_MS),
  });
  return names;
};

const failureOf = (error: Error): TrackerProviderError => {
  const failure: TrackerProviderError = {
    message: truncate(error.message, TRACKER_PROVIDER_ERROR_MESSAGE_MAX) || 'Unexpected failure',
  };
  if (error instanceof TrackerOutboundError) {
    if (error.status >= 400 && error.status <= 599) failure.status = error.status;
    if (/^[A-Z_]{1,64}$/.test(error.code)) failure.code = error.code;
  } else if (error instanceof CallError) {
    if (error.status >= 400 && error.status <= 599) failure.status = error.status;
    if (error.code && /^[A-Z_]{1,64}$/.test(error.code)) failure.code = error.code;
  }
  return failure;
};

const answer = async <M extends TrackerProviderMethod>(
  method: M,
  call: Call,
  input: SourceControlJsonObject,
): Promise<TrackerProviderResult> => {
  try {
    // SAFETY: OpenChamber checked `input` for `method`; its shape is `TrackerProviderInputs[M]`.
    const data = await handlers[method](call, input as TrackerProviderInputs[M]);
    return { ok: true, data };
  } catch (error) {
    let failure = error instanceof Error ? error : new Error(String(error));
    if (failure instanceof CallError && failure.fields.length > 0) {
      const names = await fieldNamesFor(call);
      if (names) {
        failure = new CallError(explainFieldErrors(failure.message, failure.fields, names), failure.status, {
          code: failure.code,
        });
      }
    }
    return { ok: false, error: failureOf(failure) };
  }
};

const send = (
  res: http.ServerResponse,
  status: number,
  body: TrackerProviderResult | { ok: true } | { error: string },
): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req: http.IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => resolve(body));
  req.on('error', reject);
});

const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${serviceToken}`) {
    send(res, 401, { error: 'unauthorized' });
    return;
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/health') {
    send(res, 200, { ok: true });
    return;
  }
  if (url.pathname !== TRACKER_PROVIDER_PATH || req.method !== 'POST') {
    send(res, 404, { error: 'not-found' });
    return;
  }
  readBody(req).then(async (body) => {
    const request = readTrackerProviderRequest(body);
    if (!request) {
      send(res, 400, { error: 'not a tracker call this service understands' });
      return;
    }
    send(res, 200, await answer(
      request.method,
      { instance: request.session.instance, handle: request.session.handle },
      request.input,
    ));
  }).catch(() => send(res, 500, { error: 'could not read the request' }));
});

server.listen(port, '127.0.0.1');
