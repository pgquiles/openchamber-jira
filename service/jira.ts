import type { TrackerProviderPriority, TrackerProviderStateCategory } from '@openchamber/sdk';

export type JiraListFilters = {
  state: string;
  people: 'any' | 'me' | 'created';
  priority: 'all' | TrackerProviderPriority;
  containerId: string | null;
  query?: string;
};

export type JqlResult = {
  jql: string;
  /** True when the filter names a priority this site does not have. */
  matchesNothing: boolean;
};

const normalize = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

const STATUS_CATEGORIES: Record<string, TrackerProviderStateCategory> = {
  new: 'todo',
  'to do': 'todo',
  todo: 'todo',
  open: 'todo',
  indeterminate: 'in-progress',
  'in-flight': 'in-progress',
  'in progress': 'in-progress',
  'in-progress': 'in-progress',
  started: 'in-progress',
  done: 'done',
  complete: 'done',
  completed: 'done',
  closed: 'done',
};

export const mapStatusCategory = (category: unknown): TrackerProviderStateCategory | null => {
  if (typeof category !== 'object' || category === null) return null;
  const record = category as { key?: unknown; name?: unknown };
  for (const candidate of [record.key, record.name]) {
    if (typeof candidate !== 'string') continue;
    const mapped = STATUS_CATEGORIES[normalize(candidate)];
    if (mapped) return mapped;
  }
  return null;
};

const PRIORITIES: Record<string, TrackerProviderPriority> = {
  highest: 'urgent',
  blocker: 'urgent',
  critical: 'urgent',
  urgent: 'urgent',
  p1: 'urgent',
  '1': 'urgent',
  high: 'high',
  major: 'high',
  p2: 'high',
  '2': 'high',
  medium: 'medium',
  normal: 'medium',
  p3: 'medium',
  '3': 'medium',
  low: 'low',
  lowest: 'low',
  minor: 'low',
  trivial: 'low',
  p4: 'low',
  p5: 'low',
  '4': 'low',
  '5': 'low',
};

export const mapPriorityName = (name: unknown): TrackerProviderPriority => {
  if (typeof name !== 'string') return 'none';
  return PRIORITIES[normalize(name)] ?? 'none';
};

/** The site's own priority names that belong to a neutral level. */
export const priorityFilterNames = (
  priority: 'all' | TrackerProviderPriority,
  available: readonly string[],
): string[] => {
  if (priority === 'all' || priority === 'none') return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of available) {
    if (mapPriorityName(name) !== priority) continue;
    const key = normalize(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
};

export const escapeJqlString = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export const isIssueKey = (value: string): boolean => ISSUE_KEY.test(value);

export const isProjectKey = (value: string): boolean => PROJECT_KEY.test(value);

const EPIC_LINK_SCHEMA = 'com.pyxis.greenhopper.jira:gh-epic-link';

export type JiraField = {
  id?: unknown;
  name?: unknown;
  schema?: { custom?: unknown };
};

/**
 * Find the custom field that holds a company-managed Epic Link. The schema
 * identifies it on any locale; the English name is a fallback for sites that
 * hide the schema.
 */
export const epicLinkFieldId = (fields: unknown): string | null => {
  if (!Array.isArray(fields)) return null;
  const typed = fields as JiraField[];
  const bySchema = typed.find((field) => (
    typeof field?.id === 'string' && field.schema?.custom === EPIC_LINK_SCHEMA
  ));
  if (bySchema) return bySchema.id as string;
  const byName = typed.find((field) => (
    typeof field?.id === 'string' && typeof field?.name === 'string' && field.name.trim().toLowerCase() === 'epic link'
    && /^customfield_\d+$/.test(field.id)
  ));
  return byName ? byName.id as string : null;
};

const CUSTOM_FIELD = /^customfield_\d+$/;

/** Jira's custom fields are the ones an error value does not name; system
 * fields such as `resolution` already read well. */
export const isCustomFieldId = (value: string): boolean => CUSTOM_FIELD.test(value);

/** The display name of every field a site reports, by id. Blank names and
 * names that only repeat the id are left out. */
export const jiraFieldNames = (fields: unknown): Map<string, string> => {
  const names = new Map<string, string>();
  if (!Array.isArray(fields)) return names;
  for (const field of fields as JiraField[]) {
    if (typeof field?.id !== 'string') continue;
    const name = typeof field.name === 'string' ? field.name.trim() : '';
    if (name === '' || name === field.id) continue;
    names.set(field.id, name);
  }
  return names;
};

/**
 * Rewrite the custom-field ids in a Jira error into the names the user sees,
 * keeping the id in parentheses so it stays searchable. System fields already
 * read well and are left alone.
 */
export const explainFieldErrors = (
  message: string,
  ids: readonly string[],
  names: ReadonlyMap<string, string>,
): string => {
  let explained = message;
  for (const id of ids) {
    if (!isCustomFieldId(id)) continue;
    const name = names.get(id);
    if (!name || name === id) continue;
    // split/join keeps a `$` in the name literal, unlike String.replace.
    explained = explained.split(`${id}: `).join(`${name} (${id}): `);
  }
  return explained;
};

/** The machine code OpenChamber's bridge needs to keep Jira's status. Codes
 * must match the SDK's [A-Z_]{1,64} rule, so none may carry a digit. */
export const failureCode = (status: number): string => {
  if (status === 401) return 'JIRA_UNAUTHORIZED';
  if (status === 403) return 'JIRA_FORBIDDEN';
  if (status === 404) return 'JIRA_NOT_FOUND';
  if (status === 409) return 'JIRA_CONFLICT';
  if (status === 429) return 'JIRA_RATE_LIMITED';
  if (status >= 500) return 'JIRA_UPSTREAM';
  return 'JIRA_REJECTED';
};

/**
 * An epic's children: native `parent` covers team-managed projects and the
 * Epic Link custom field covers company-managed ones. Both are asked in one
 * query so a site where either applies answers in a single page.
 */
export const epicChildrenJql = (key: string, fieldId: string | null): string => {
  const escaped = escapeJqlString(key);
  const conditions = [`parent = "${escaped}"`];
  const custom = fieldId?.match(/^customfield_(\d+)$/);
  if (custom) conditions.push(`cf[${custom[1]}] = "${escaped}"`);
  return `${conditions.join(' OR ')} ORDER BY updated DESC`;
};

/** Epics are the issue type named "Epic" or above the base hierarchy level. */
export const isEpicIssueType = (type: unknown): boolean => {
  if (typeof type !== 'object' || type === null) return false;
  const record = type as { name?: unknown; hierarchyLevel?: unknown };
  if (typeof record.name === 'string' && normalize(record.name) === 'epic') return true;
  return typeof record.hierarchyLevel === 'number' && record.hierarchyLevel >= 1;
};

const stateCondition = (state: string): string | null => {
  switch (state) {
    case 'open':
      return 'statusCategory != Done';
    case 'all':
      return null;
    case 'todo':
      return 'statusCategory = "To Do"';
    case 'in-progress':
      return 'statusCategory = "In Progress"';
    case 'done':
      return 'statusCategory = Done';
    default:
      throw new Error(`unknown state filter "${state}"`);
  }
};

const peopleCondition = (people: JiraListFilters['people']): string | null => {
  switch (people) {
    case 'any':
      return null;
    case 'created':
      return 'reporter = currentUser()';
    case 'me':
    default:
      return 'assignee = currentUser()';
  }
};

/** Build the JQL for a picker read. An empty jql means no issue can match. */
export const buildJql = (input: JiraListFilters, priorityNames: readonly string[]): JqlResult => {
  const conditions: string[] = [];

  if (input.containerId !== null) {
    if (!PROJECT_KEY.test(input.containerId)) throw new Error(`"${input.containerId}" is not a Jira project key`);
    conditions.push(`project = "${escapeJqlString(input.containerId)}"`);
  }

  const state = stateCondition(input.state);
  if (state) conditions.push(state);

  const people = peopleCondition(input.people);
  if (people) conditions.push(people);

  if (input.priority === 'none') {
    conditions.push('priority is EMPTY');
  } else if (input.priority !== 'all') {
    const names = priorityFilterNames(input.priority, priorityNames);
    if (names.length === 0) return { jql: '', matchesNothing: true };
    conditions.push(`priority in (${names.map((name) => `"${escapeJqlString(name)}"`).join(', ')})`);
  }

  const query = input.query?.trim() ?? '';
  if (query !== '') {
    const escaped = escapeJqlString(query);
    conditions.push(isIssueKey(query)
      ? `(key = "${escaped}" OR summary ~ "${escaped}")`
      : `summary ~ "${escaped}"`);
  }

  // /search/jql refuses a bare ORDER BY as an unbounded query. Every issue
  // belongs to a project, so this clause matches everything and keeps the
  // request legal when no filter was chosen.
  const where = conditions.length === 0 ? ['project is not EMPTY'] : conditions;
  return { jql: `${where.join(' AND ')} ORDER BY updated DESC`, matchesNothing: false };
};
