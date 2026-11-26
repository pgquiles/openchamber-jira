import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import {
  OPENCHAMBER_HOST_CALLBACK_URL,
  SOURCE_CONTROL_OUTBOUND_METHODS,
  TRACKER_OUTBOUND_PATH,
  TRACKER_PROVIDER_PATH,
  isTrackerProviderWriteMethod,
  type TrackerProviderDataByMethod,
  type TrackerProviderInputs,
  type TrackerProviderMethod,
} from '@openchamber/sdk';
import { trackerProviderSchemasV1 as schemas } from '@openchamber/sdk/schemas';

import { startFakeJira, type FakeJira } from './fixtures/fake-jira.ts';

// Runs the checked-in service bundle the way OpenChamber does: a loopback port
// and bearer, a callback listener that plays OpenChamber's outbound proxy (handle
// → Jira origin, Basic credential, allowed methods), and a fake Jira Cloud behind
// it. Every answer is parsed with the SDK's tracker schemas.

const serviceEntry = fileURLToPath(new URL('../service/main.js', import.meta.url));
const PROVIDER = 'ext-jira-tracker';
const READ_ONLY: readonly string[] = ['GET'];
const ACCOUNT = { id: 'acc-1', login: 'mona@example.com' };
const LIST: TrackerProviderInputs['items.list'] = { state: 'open', people: 'any', priority: 'all', containerId: null };

type Grant = { origin: string; token: string | null; email: string; methods: readonly string[] };
type CallOptions<M extends TrackerProviderMethod> = {
  token: string | null;
  account?: { id: string; login: string | null } | null;
  input?: TrackerProviderInputs[M];
  methods?: readonly string[];
  origin?: string;
};

let jira: FakeJira;
let serverDeployment: FakeJira;
let authRequired: FakeJira;
let redirectServer: ReturnType<typeof Bun.serve>;
let htmlServer: ReturnType<typeof Bun.serve>;
let service: ChildProcess;
let servicePort = 0;
const serviceToken = randomBytes(16).toString('hex');
const handles = new Map<string, Grant>();
let callback: ReturnType<typeof Bun.serve>;

const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(Number(typeof address === 'object' && address ? address.port : 0)));
  });
});

const startService = async (): Promise<{ service: ChildProcess; port: number }> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const port = await freePort();
    const child = spawn('node', [serviceEntry], {
      env: {
        PATH: process.env.PATH,
        OPENCHAMBER_SERVICE_PORT: String(port),
        OPENCHAMBER_SERVICE_TOKEN: serviceToken,
        [OPENCHAMBER_HOST_CALLBACK_URL]: `http://127.0.0.1:${callback.port}`,
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${serviceToken}` } });
        if (response.ok) return { service: child, port };
      } catch {
        // not listening yet
      }
      await new Promise((resolve) => { setTimeout(resolve, 25); });
    }
    child.kill();
    if (!stderr.includes('EADDRINUSE')) throw new Error(`service did not start:\n${stderr}`);
  }
  throw new Error('service could not find a free port');
};

beforeAll(async () => {
  jira = await startFakeJira();
  serverDeployment = await startFakeJira({ deploymentType: 'Server' });
  authRequired = await startFakeJira({ requireAuth: true });
  redirectServer = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => new Response(null, { status: 302, headers: { location: '/login.jsp?permissionViolation=true' } }),
  });
  htmlServer = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => new Response('<html>Not Jira</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
  });

  callback = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      if (new URL(request.url).pathname !== TRACKER_OUTBOUND_PATH) {
        return Response.json({ error: { message: 'not found', code: 'NOT_FOUND' } }, { status: 404 });
      }
      const grant = handles.get((request.headers.get('authorization') ?? '').replace(/^Bearer /, ''));
      if (!grant) {
        return Response.json({ error: { message: 'Unknown handle', code: 'HANDLE_UNKNOWN' } }, { status: 403 });
      }
      const outbound = await request.json() as {
        method: string;
        path: string;
        query?: Record<string, string>;
        headers?: Record<string, string>;
        body?: string;
      };
      if (!grant.methods.includes(outbound.method)) {
        return Response.json({
          error: { message: `A read's handle sends GET; ${outbound.method} is refused`, code: 'METHOD_NOT_ALLOWED' },
        }, { status: 403 });
      }
      const target = new URL(outbound.path, grant.origin);
      if (target.origin !== grant.origin) {
        return Response.json({ error: { message: 'Off the instance', code: 'OFF_ORIGIN' } }, { status: 403 });
      }
      for (const [key, value] of Object.entries(outbound.query ?? {})) target.searchParams.set(key, value);
      const headers = new Headers(outbound.headers as Record<string, string> | undefined);
      if (grant.token !== null) {
        headers.set('authorization', `Basic ${Buffer.from(`${grant.email}:${grant.token}`).toString('base64')}`);
      }
      let answer: Response;
      try {
        answer = await fetch(target, {
          method: outbound.method,
          headers,
          body: outbound.body,
          redirect: 'manual',
        });
      } catch {
        return Response.json({
          error: { message: 'The forge did not answer', code: 'FORGE_UNREACHABLE' },
        }, { status: 502 });
      }
      // The host relays content-type and a few numeric headers, never Location.
      return Response.json({
        status: answer.status,
        headers: { 'content-type': answer.headers.get('content-type') ?? '' },
        body: await answer.text(),
      });
    },
  });

  ({ service, port: servicePort } = await startService());
});

afterAll(async () => {
  service?.kill();
  callback?.stop(true);
  redirectServer?.stop(true);
  htmlServer?.stop(true);
  await Promise.all([jira?.close(), serverDeployment?.close(), authRequired?.close()]);
});

let requests = 0;

const call = async <M extends TrackerProviderMethod>(method: M, {
  token, account = null, input, methods, origin,
}: CallOptions<M>) => {
  const handle = randomBytes(16).toString('base64url');
  handles.set(handle, {
    origin: origin ?? jira.origin,
    token,
    email: jira.email,
    methods: methods ?? (isTrackerProviderWriteMethod(method) ? SOURCE_CONTROL_OUTBOUND_METHODS : READ_ONLY),
  });
  try {
    const response = await fetch(`http://127.0.0.1:${servicePort}${TRACKER_PROVIDER_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        requestId: `req-${requests += 1}`,
        method,
        provider: PROVIDER,
        session: { instance: origin ?? jira.origin, handle, account },
        input: input ?? {},
      }),
    });
    expect(response.status).toBe(200);
    return schemas.envelope.parse(await response.json());
  } finally {
    handles.delete(handle);
  }
};

const read = async <M extends TrackerProviderMethod>(method: M, input: TrackerProviderInputs[M]) => {
  const result = await call(method, { token: 'jira-token', account: ACCOUNT, input });
  if (!result.ok) throw new Error(`${method} failed: ${result.error.message}`);
  const parsed = schemas.data[method].safeParse(result.data);
  if (!parsed.success) throw new Error(`${method} does not match its schema: ${parsed.error.message}`);
  // SAFETY: `schemas.data[method]` is the schema of this method's answer.
  return parsed.data as TrackerProviderDataByMethod[M];
};

const lastRequest = (path: string, method?: string) => [...jira.requests].reverse()
  .find((request) => request.path === path && (method === undefined || request.method === method));

describe('account', () => {
  test('probes Jira Cloud without a credential', async () => {
    expect(await call('auth.probe', { token: null })).toEqual({ ok: true, data: { supported: true } });
  });

  test('treats a sign-in redirect or a 401 as a Jira the user can connect', async () => {
    const redirect = await call('auth.probe', { token: null, origin: `http://127.0.0.1:${redirectServer.port}` });
    expect(redirect.ok && redirect.data.supported).toBe(true);

    const needsAuth = await call('auth.probe', { token: null, origin: authRequired.origin });
    expect(needsAuth.ok && needsAuth.data.supported).toBe(true);
  });

  test('refuses a Jira Server deployment and a server that is not Jira', async () => {
    const server = await call('auth.probe', { token: null, origin: serverDeployment.origin });
    expect(server.ok).toBe(true);
    expect(server.ok && server.data.supported).toBe(false);
    expect(server.ok && server.data.message).toContain('Cloud');

    const html = await call('auth.probe', { token: null, origin: `http://127.0.0.1:${htmlServer.port}` });
    expect(html.ok && html.data.supported).toBe(false);
  });

  test('answers unsupported for a site it cannot reach', async () => {
    const unreachable = await call('auth.probe', { token: null, origin: 'http://127.0.0.1:1' });
    expect(unreachable.ok && unreachable.data.supported).toBe(false);
    expect(unreachable.ok && unreachable.data.message).toContain('could not be reached');
  });

  test('verifies who the credential belongs to', async () => {
    const verified = await call('auth.verify', { token: 'jira-token' });
    expect(verified.ok && schemas.data['auth.verify'].parse(verified.data)).toEqual({
      account: {
        id: 'acc-1',
        login: 'mona@example.com',
        name: 'Mona Lisa',
        avatarUrl: 'https://avatar.example/mona.png',
      },
    });
  });

  test('reports a wrong token as an authentication failure', async () => {
    const refused = await call('auth.verify', { token: 'wrong-token' });
    expect(refused).toMatchObject({ ok: false, error: { status: 401 } });
  });

  test('refuses to verify a Jira Server deployment', async () => {
    const refused = await call('auth.verify', { token: 'jira-token', origin: serverDeployment.origin });
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error.message).toContain('Cloud');
  });
});

describe('items.list', () => {
  test('lists the signed-in user’s active issues, newest first', async () => {
    const page = await read('items.list', LIST);
    expect(page.items.map((item) => item.identifier)).toEqual(['PROJ-5', 'OPS-1', 'PROJ-1']);
    expect(page).toMatchObject({ cursor: null, hasMore: false });
    expect(lastRequest('/rest/api/3/search/jql')?.query.jql)
      .toBe('statusCategory != Done AND assignee = currentUser() ORDER BY updated DESC');
    expect(lastRequest('/rest/api/3/search/jql')?.query.fields)
      .toContain('summary,status,priority,labels,assignee,project,updated');
  });

  test('maps a Jira issue to the neutral item shape', async () => {
    const page = await read('items.list', { ...LIST, query: 'Login fails on Safari' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: 'PROJ-1',
      identifier: 'PROJ-1',
      title: 'Login fails on Safari',
      url: `${jira.origin}/browse/PROJ-1`,
      state: { id: '3', name: 'In Progress', category: 'in-progress' },
      priority: 'urgent',
      labels: [
        { id: 'bug', name: 'bug', color: null },
        { id: 'frontend', name: 'frontend', color: null },
      ],
      assignee: { name: 'Mona Lisa', avatarUrl: 'https://avatar.example/mona.png' },
      container: { id: 'PROJ', key: 'PROJ', name: 'Project X' },
      updatedAt: '2026-11-20T09:12:00.000+0000',
    });
    expect('provider' in (page.items[0] ?? {})).toBe(false);
  });

  test('maps each declared state filter to a Jira status category', async () => {
    expect((await read('items.list', { ...LIST, state: 'all' })).items.map((item) => item.identifier))
      .toEqual(['PROJ-5', 'OPS-1', 'PROJ-1', 'PROJ-3', 'PROJ-4']);
    expect((await read('items.list', { ...LIST, state: 'todo' })).items.map((item) => item.identifier))
      .toEqual(['PROJ-5', 'OPS-1']);
    expect((await read('items.list', { ...LIST, state: 'in-progress' })).items.map((item) => item.identifier))
      .toEqual(['PROJ-1']);
    expect((await read('items.list', { ...LIST, state: 'done' })).items.map((item) => item.identifier))
      .toEqual(['PROJ-3', 'PROJ-4']);
  });

  test('scopes any and me to the assignee and created to the reporter', async () => {
    expect((await read('items.list', { ...LIST, people: 'me' })).items.map((item) => item.identifier))
      .toEqual(['PROJ-5', 'OPS-1', 'PROJ-1']);
    expect((await read('items.list', { ...LIST, people: 'created' })).items.map((item) => item.identifier))
      .toEqual(['PROJ-5', 'PROJ-2']);
  });

  test('filters by priority using the site’s own priority names, and remembers them', async () => {
    const high = await read('items.list', { ...LIST, priority: 'high' });
    expect(high.items.map((item) => item.identifier)).toEqual(['OPS-1']);
    expect(high.items[0]?.priority).toBe('high');
    const afterFirst = jira.requests.filter((request) => request.path === '/rest/api/3/priority').length;
    expect(afterFirst).toBeGreaterThan(0);

    const urgent = await read('items.list', { ...LIST, priority: 'urgent' });
    expect(urgent.items.map((item) => item.identifier)).toEqual(['PROJ-1']);
    expect(jira.requests.filter((request) => request.path === '/rest/api/3/priority').length).toBe(afterFirst);
  });

  test('searches summaries and issue keys', async () => {
    expect((await read('items.list', { ...LIST, query: 'safari' })).items.map((item) => item.identifier))
      .toEqual(['PROJ-1']);
    expect((await read('items.list', { ...LIST, query: 'PROJ-1' })).items.map((item) => item.identifier))
      .toEqual(['PROJ-1']);
  });

  test('narrows to a project container', async () => {
    expect((await read('items.list', { ...LIST, containerId: 'OPS' })).items.map((item) => item.identifier))
      .toEqual(['OPS-1']);
  });

  test('follows Jira’s next page token', async () => {
    jira.setPageSize(2);
    try {
      const first = await read('items.list', LIST);
      expect(first.items.map((item) => item.identifier)).toEqual(['PROJ-5', 'OPS-1']);
      expect(first.hasMore).toBe(true);
      expect(first.cursor).not.toBeNull();

      const second = await read('items.list', { ...LIST, cursor: first.cursor ?? undefined });
      expect(second.items.map((item) => item.identifier)).toEqual(['PROJ-1']);
      expect(second).toMatchObject({ cursor: null, hasMore: false });
    } finally {
      jira.setPageSize(100);
    }
  });
});

describe('items.get', () => {
  test('reads description, comments, children and progress', async () => {
    const { item } = await read('items.get', { id: 'PROJ-1' });
    expect(item).toMatchObject({
      id: 'PROJ-1',
      identifier: 'PROJ-1',
      title: 'Login fails on Safari',
      description: 'Open Safari and retry the `login`.\n\n- clear cookies\n- retry',
      state: { id: '3', name: 'In Progress', category: 'in-progress' },
      comments: [{
        id: 'c-1',
        body: 'Reproduced on Safari 18.',
        createdAt: '2026-11-20T10:00:00.000+0000',
        author: { name: 'Octo Kettle', avatarUrl: 'https://avatar.example/octo.png' },
      }],
      children: [{
        id: 'PROJ-2',
        identifier: 'PROJ-2',
        title: 'Add a regression test for Safari',
        state: { id: '1', name: 'To Do', category: 'todo' },
      }],
      progress: { total: 1, done: 0, more: false },
    });
    expect(item?.parent).toBeUndefined();
    expect(lastRequest('/rest/api/3/issue/PROJ-1/comment')?.query.orderBy).toBe('-created');
  });

  test('answers a numeric Jira id as well as the issue key', async () => {
    const { item } = await read('items.get', { id: '10001' });
    expect(item?.identifier).toBe('PROJ-1');
  });

  test('reads the parent of a subtask', async () => {
    const { item } = await read('items.get', { id: 'PROJ-2' });
    expect(item?.parent).toMatchObject({
      id: 'PROJ-1',
      identifier: 'PROJ-1',
      title: 'Login fails on Safari',
      state: { id: '3', name: 'In Progress', category: 'in-progress' },
    });
    expect(item?.children).toBeUndefined();
  });

  test('answers null for an unknown issue', async () => {
    expect(await read('items.get', { id: 'PROJ-999' })).toEqual({ item: null });
  });

  test('reads a company-managed Epic Link as the parent', async () => {
    const { item } = await read('items.get', { id: 'PROJ-11' });
    expect(item?.parent).toMatchObject({
      id: 'PROJ-10',
      identifier: 'PROJ-10',
      title: 'Safari login epic',
      state: { id: '1', name: 'To Do', category: 'todo' },
    });
  });

  test('lists the children of a company-managed epic and their progress', async () => {
    const { item } = await read('items.get', { id: 'PROJ-10' });
    expect(item?.children?.map((child) => child.identifier)).toEqual(['PROJ-11', 'PROJ-12']);
    expect(item?.progress).toEqual({ total: 2, done: 1, more: false });
    expect(item?.childrenMore).toBeUndefined();
  });

  test('marks a truncated child list', async () => {
    jira.setPageSize(1);
    try {
      const { item } = await read('items.get', { id: 'PROJ-10' });
      expect(item?.children).toHaveLength(1);
      expect(item?.childrenMore).toBe(true);
      expect(item?.progress).toEqual({ total: 1, done: 0, more: true });
    } finally {
      jira.setPageSize(100);
    }
  });

  test('discovers the Epic Link field once per site', async () => {
    await read('items.get', { id: 'PROJ-1' });
    const before = jira.requests.filter((request) => request.path === '/rest/api/3/field').length;
    await read('items.get', { id: 'PROJ-11' });
    await read('items.get', { id: 'PROJ-12' });
    const after = jira.requests.filter((request) => request.path === '/rest/api/3/field').length;
    expect(after).toBe(before);
  });

  test('keeps the newest comments when the answer would be too large', async () => {
    const issue = jira.issues.get('PROJ-3');
    const saved = issue?.comments ?? [];
    const paragraphOf = (text: string) => ({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    if (issue) {
      issue.comments = Array.from({ length: 120 }, (_, index) => ({
        id: `big-${index}`,
        body: paragraphOf('x'.repeat(40_000)),
        authorId: 'acc-1',
        created: `2026-11-01T00:00:${String(index).padStart(2, '0')}.000+0000`,
      }));
    }
    try {
      const { item } = await read('items.get', { id: 'PROJ-3' });
      expect(item?.comments?.length).toBeLessThan(100);
      // Jira answered the newest page first; the oldest comments are gone and
      // the page is shown in chronological order.
      expect(item?.comments?.every((comment) => Number(comment.id.slice(4)) >= 20)).toBe(true);
      expect(item?.comments?.at(-1)?.id).toBe('big-119');
    } finally {
      if (issue) issue.comments = saved;
    }
  });
});

describe('states and containers', () => {
  test('flattens the project workflow statuses', async () => {
    const { states } = await read('states.list', { containerId: 'PROJ' });
    expect(states.map((state) => [state.id, state.name, state.category, state.position])).toEqual([
      ['1', 'To Do', 'todo', 0],
      ['3', 'In Progress', 'in-progress', 1],
      ['5', 'Done', 'done', 2],
      ['6', "Won't Do", 'done', 3],
    ]);
  });

  test('lists projects as containers keyed by project key', async () => {
    expect(await read('containers.list', {})).toEqual({
      containers: [
        { id: 'PROJ', key: 'PROJ', name: 'Project X' },
        { id: 'OPS', key: 'OPS', name: 'Operations' },
      ],
    });
  });
});

describe('live summaries', () => {
  test('answers the state of known identifiers and leaves out the rest', async () => {
    const { items } = await read('items.liveSummaries', { identifiers: ['PROJ-1', 'PROJ-999', 'proj-2'] });
    expect(items).toEqual([
      { identifier: 'PROJ-1', title: 'Login fails on Safari', state: { name: 'In Progress', category: 'in-progress' } },
      { identifier: 'PROJ-2', title: 'Add a regression test for Safari', state: { name: 'To Do', category: 'todo' } },
    ]);
  });
});

describe('comments.create', () => {
  test('writes the session comment as an ADF document with the link', async () => {
    const body = '[OpenChamber session completed](https://openchamber.example/?session=abc)';
    expect(await read('comments.create', { identifier: 'PROJ-1', body })).toEqual({ comment: { id: 'c-new-1' } });

    const request = lastRequest('/rest/api/3/issue/PROJ-1/comment', 'POST');
    const parsed = JSON.parse(request?.body ?? '{}') as {
      body?: { type?: string; content?: Array<{ type?: string; content?: Array<{ text?: string; marks?: unknown[] }> }> };
    };
    expect(parsed.body?.type).toBe('doc');
    expect(parsed.body?.content?.[0]?.type).toBe('paragraph');
    expect(parsed.body?.content?.[0]?.content?.[0]).toEqual({
      type: 'text',
      text: 'OpenChamber session completed',
      marks: [{ type: 'link', attrs: { href: 'https://openchamber.example/?session=abc' } }],
    });
  });

  test('answers null for an unknown issue', async () => {
    expect(await read('comments.create', { identifier: 'PROJ-999', body: 'hello' })).toEqual({ comment: null });
  });
});

describe('items.updateState', () => {
  test('finds the transition to the requested status and applies it', async () => {
    const { item } = await read('items.updateState', { id: 'PROJ-1', stateId: '5' });
    expect(item).toMatchObject({
      identifier: 'PROJ-1',
      state: { id: '5', name: 'Done', category: 'done' },
    });
    const request = lastRequest('/rest/api/3/issue/PROJ-1/transitions', 'POST');
    expect(JSON.parse(request?.body ?? '{}')).toEqual({ transition: { id: '22' } });
  });

  test('refuses a status the issue cannot reach', async () => {
    // PROJ-1 is Done now; Done has no transition to Won't Do (6).
    const refused = await call('items.updateState', {
      token: 'jira-token', account: ACCOUNT, input: { id: 'PROJ-1', stateId: '6' },
    });
    expect(refused).toMatchObject({ ok: false, error: { status: 409 } });
    expect(refused.ok === false && refused.error.message).toContain('transition');
  });

  test('answers null for an unknown issue', async () => {
    expect(await read('items.updateState', { id: 'PROJ-999', stateId: '5' })).toEqual({ item: null });
  });
});

describe('failures', () => {
  test('surfaces Jira’s rate limit instead of retrying silently', async () => {
    jira.failNext(429, 'Rate limit exceeded for this site.');
    const refused = await call('items.list', { token: 'jira-token', account: ACCOUNT, input: LIST });
    expect(refused).toMatchObject({ ok: false, error: { status: 429 } });
    expect(refused.ok === false && refused.error.message).toContain('Rate limit exceeded');
  });

  test('refuses a project key that could rewrite the query', async () => {
    const refused = await call('items.list', {
      token: 'jira-token',
      account: ACCOUNT,
      input: { ...LIST, containerId: 'PROJ" OR project = "OPS' },
    });
    expect(refused).toMatchObject({ ok: false, error: { status: 400 } });
  });

  test('refuses a container id that is not a project key when listing states', async () => {
    const refused = await call('states.list', {
      token: 'jira-token',
      account: ACCOUNT,
      input: { containerId: 'PROJ-1' },
    });
    expect(refused).toMatchObject({ ok: false, error: { status: 400 } });
  });

  test('refuses to create an empty comment', async () => {
    const refused = await call('comments.create', {
      token: 'jira-token',
      account: ACCOUNT,
      input: { identifier: 'PROJ-1', body: '   ' },
    });
    expect(refused).toMatchObject({ ok: false, error: { status: 400 } });
  });

  test('refuses a request without the service bearer', async () => {
    const response = await fetch(`http://127.0.0.1:${servicePort}${TRACKER_PROVIDER_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ v: 1 }),
    });
    expect(response.status).toBe(401);
  });

  test('answers 400 for a body that is not a tracker call', async () => {
    const response = await fetch(`http://127.0.0.1:${servicePort}${TRACKER_PROVIDER_PATH}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    expect(response.status).toBe(400);
  });
});
