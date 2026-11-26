// service/main.ts
import http from "node:http";
// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = new WeakMap;
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending = timers.get(target);
    if (pending !== undefined)
      clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1000));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;
// node_modules/@openchamber/sdk/dist/manifest.js
var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);
// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = [
  "turn-finished",
  "turn-failed",
  "permission-asked",
  "question-asked",
  "turn-started",
  "session-created",
  "session-archived",
  "session-deleted"
];
var SESSION_EVENTS_IDLE_MS = 10 * 60000;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);
// node_modules/@openchamber/sdk/dist/service-host.js
var SERVICE_SCHEDULE_IDLE_MS = 10 * 60000;
var MENTIONS_IDLE_MS = 10 * 60000;
// node_modules/@openchamber/sdk/dist/file-editor.js
var patternExpressions = new Map;
// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 60000;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
var HOST_PUSH_TYPES = new Set([
  "workspace",
  "shells",
  "ready",
  "directory",
  "session",
  "connection",
  "settings",
  "session-lifecycle",
  "item",
  "resolve",
  "action",
  "service-event",
  "status-control-event",
  "popover-closed",
  "file-open",
  "file-snapshot",
  "file-saved",
  "generate-late",
  "microphone-audio",
  "microphone-ended"
]);
// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_IDLE_MS = 10 * 60000;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 60000;
var OPENCHAMBER_HOST_CALLBACK_URL = "OPENCHAMBER_HOST_CALLBACK_URL";
var postOutbound = async (url, handle, request, timeoutMs, fail) => {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${handle}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs + 5000)
    });
  } catch (error) {
    throw fail(`OpenChamber did not answer: ${error instanceof Error ? error.message : String(error)}`, "HOST_UNAVAILABLE", 0);
  }
  let answer;
  try {
    answer = Object(await response.json());
  } catch {
    throw fail("OpenChamber answered with something other than JSON", "HOST_UNAVAILABLE", response.status);
  }
  if (!response.ok) {
    const message = answer.error?.message;
    const code = answer.error?.code;
    throw fail(String(message) === message && message.length > 0 ? message : `OpenChamber refused the request (${response.status})`, String(code) === code && code.length > 0 ? code : "OUTBOUND_REFUSED", response.status);
  }
  if (!Number.isSafeInteger(answer.status) || String(answer.body) !== answer.body) {
    throw fail("OpenChamber relayed a malformed answer", "HOST_UNAVAILABLE", response.status);
  }
  const headers = {};
  for (const [name, text] of Object.entries(Object(answer.headers ?? {}))) {
    if (String(text) === text)
      headers[name] = text;
  }
  return { status: Number(answer.status), headers, body: answer.body };
};
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 60000;
var readNotificationsAccount = (account) => {
  if (account === null)
    return null;
  if (Object(account) !== account || account === undefined)
    return;
  const { id, login } = account;
  if (String(id) !== id || id.length === 0)
    return;
  if (login !== null && (String(login) !== login || login.length === 0))
    return;
  return { id, login };
};
var TRACKER_PROVIDER_PATH = "/tracker";
var TRACKER_PROVIDER_WIRE_VERSION = 1;
var TRACKER_PROVIDER_METHODS = [
  "auth.probe",
  "auth.verify",
  "items.list",
  "items.get",
  "items.updateState",
  "items.liveSummaries",
  "states.list",
  "containers.list",
  "comments.create"
];
var TRACKER_PROVIDER_ERROR_MESSAGE_MAX = 2000;
var TRACKER_PROVIDER_IDLE_MS = 10 * 60000;
var TRACKER_OUTBOUND_PATH = "/tracker/outbound";
var TRACKER_OUTBOUND_TIMEOUT_MS = 20000;
var isTrackerProviderMethod = (value) => TRACKER_PROVIDER_METHODS.some((method) => method === value);
var readTrackerProviderRequest = (body) => {
  let wire;
  try {
    const parsed = JSON.parse(body);
    if (Object(parsed) !== parsed || parsed === null)
      return null;
    wire = parsed;
  } catch {
    return null;
  }
  const { v, requestId, method, provider, session, input } = wire;
  if (v !== TRACKER_PROVIDER_WIRE_VERSION)
    return null;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (String(provider) !== provider || provider.length === 0)
    return null;
  if (String(method) !== method || !isTrackerProviderMethod(method))
    return null;
  if (Object(input) !== input || Array.isArray(input))
    return null;
  if (Object(session) !== session || session === null || session === undefined)
    return null;
  const { instance, handle } = session;
  if (String(instance) !== instance || instance.length === 0 || String(handle) !== handle || handle.length === 0)
    return null;
  const account = readNotificationsAccount(session.account);
  if (account === undefined)
    return null;
  return { v: TRACKER_PROVIDER_WIRE_VERSION, requestId, method, provider, session: { instance, handle, account }, input };
};

class TrackerOutboundError extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "TrackerOutboundError";
    this.code = code;
    this.status = status;
  }
}
var createTrackerOutbound = ({ env }) => {
  const base = env[OPENCHAMBER_HOST_CALLBACK_URL];
  if (!base)
    throw new Error(`${OPENCHAMBER_HOST_CALLBACK_URL} is not set: only a service that provides "tracker" can reach a tracker's server.`);
  const url = `${base.replace(/\/+$/, "")}${TRACKER_OUTBOUND_PATH}`;
  return {
    request: (handle, request) => postOutbound(url, handle, request, TRACKER_OUTBOUND_TIMEOUT_MS, (message, code, status) => new TrackerOutboundError(message, code, status))
  };
};
var QUOTA_PROVIDER_IDLE_MS = 10 * 60000;
// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);
// service/adf.ts
var asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
var asNode = (value) => {
  const object = asObject(value);
  return object && typeof object.type === "string" ? object : null;
};
var asNodes = (value) => Array.isArray(value) ? value.flatMap((entry) => {
  const node = asNode(entry);
  return node ? [node] : [];
}) : [];
var stringAttr = (attrs, key) => {
  const value = attrs?.[key];
  return typeof value === "string" ? value : null;
};
var numberAttr = (attrs, key) => {
  const value = attrs?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};
var fenceFor = (code) => {
  const longest = Math.max(2, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  return "`".repeat(longest + 1);
};
var applyMarks = (value, marks) => {
  if (!marks || marks.length === 0)
    return value;
  const ordered = [...marks].sort((left, right) => (left.type === "link" ? 1 : 0) - (right.type === "link" ? 1 : 0));
  let result = value;
  for (const mark of ordered) {
    switch (mark.type) {
      case "strong":
        result = `**${result}**`;
        break;
      case "em":
        result = `*${result}*`;
        break;
      case "code":
        result = `\`${result}\``;
        break;
      case "strike":
        result = `~~${result}~~`;
        break;
      case "link": {
        const href = stringAttr(mark.attrs, "href");
        if (href)
          result = `[${result}](${href})`;
        break;
      }
      default:
        break;
    }
  }
  return result;
};
var inlineText = (nodes) => nodes.map(inlineNode).join("");
var inlineNode = (node) => {
  switch (node.type) {
    case "text":
      return applyMarks(node.text ?? "", node.marks);
    case "hardBreak":
      return `
`;
    case "mention": {
      const text = stringAttr(node.attrs, "text");
      if (text)
        return text;
      const name = stringAttr(node.attrs, "displayName");
      return name ? `@${name}` : "";
    }
    case "emoji":
      return stringAttr(node.attrs, "text") ?? stringAttr(node.attrs, "shortName") ?? "";
    case "inlineCard": {
      const url = stringAttr(node.attrs, "url");
      return url ? `[${url}](${url})` : "";
    }
    case "status":
    case "date":
      return stringAttr(node.attrs, "text") ?? "";
    default:
      return node.content ? inlineText(node.content) : "";
  }
};
var renderBlocks = (nodes, context) => {
  const blocks = [];
  for (const node of nodes) {
    const block = renderBlock(node, context);
    if (block !== null && block.trim() !== "")
      blocks.push(block);
  }
  return blocks;
};
var renderCell = (cell) => renderBlocks(asNodes(cell.content), { depth: 0 }).join(" ").replace(/\n+/g, " ").replace(/\|/g, "\\|").trim();
var renderBlock = (node, context) => {
  switch (node.type) {
    case "paragraph":
      return inlineText(asNodes(node.content));
    case "heading": {
      const level = Math.min(6, Math.max(1, numberAttr(node.attrs, "level") ?? 1));
      return `${"#".repeat(level)} ${inlineText(asNodes(node.content))}`;
    }
    case "codeBlock": {
      const language = stringAttr(node.attrs, "language") ?? "";
      const code = asNodes(node.content).map((child) => child.text ?? "").join("");
      const fence = fenceFor(code);
      return `${fence}${language}
${code}
${fence}`;
    }
    case "blockquote":
    case "panel": {
      const body = renderBlocks(asNodes(node.content), context).join(`

`);
      return body.split(`
`).map((line) => line ? `> ${line}` : ">").join(`
`);
    }
    case "rule":
      return "---";
    case "bulletList":
    case "orderedList":
      return renderList(node, context);
    case "taskList":
      return asNodes(node.content).map((item) => {
        const done = stringAttr(item.attrs, "state")?.toUpperCase() === "DONE";
        const content = asNodes(item.content);
        const inlineOnly = content.every((child) => [
          "text",
          "hardBreak",
          "mention",
          "emoji",
          "inlineCard",
          "status",
          "date"
        ].includes(child.type));
        const label = inlineOnly ? inlineText(content) : renderBlocks(content, { depth: context.depth }).join(" ");
        return `${"  ".repeat(context.depth)}- [${done ? "x" : " "}] ${label}`;
      }).join(`
`);
    case "table":
      return renderTable(node);
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return null;
    default:
      if (node.content)
        return renderBlocks(node.content, context).join(`

`);
      return null;
  }
};
var renderList = (node, context) => {
  const indent = "  ".repeat(context.depth);
  const ordered = node.type === "orderedList";
  const start = ordered ? numberAttr(node.attrs, "order") ?? 1 : 0;
  return asNodes(node.content).map((item, index) => {
    const marker = ordered ? `${start + index}. ` : "- ";
    const blocks = renderBlocks(asNodes(item.content), { depth: context.depth + 1 });
    if (blocks.length === 0)
      return `${indent}${marker.trimEnd()}`;
    const lines = [];
    blocks.forEach((block, blockIndex) => {
      block.split(`
`).forEach((line, lineIndex) => {
        if (blockIndex === 0 && lineIndex === 0)
          lines.push(`${indent}${marker}${line}`);
        else if (blockIndex === 0)
          lines.push(`${indent}${" ".repeat(marker.length)}${line}`);
        else
          lines.push(line);
      });
    });
    return lines.join(`
`);
  }).join(`
`);
};
var renderTable = (node) => {
  const rows = asNodes(node.content);
  if (rows.length === 0)
    return "";
  const first = asNodes(rows[0]?.content);
  const header = `| ${first.map(renderCell).join(" | ")} |`;
  const divider = `| ${first.map(() => "---").join(" | ")} |`;
  const body = rows.slice(1).map((row) => `| ${asNodes(row.content).map(renderCell).join(" | ")} |`);
  return [header, divider, ...body].join(`
`);
};
function adfToMarkdown(value) {
  const root = asObject(value);
  if (!root || root.type !== "doc")
    return "";
  const markdown = renderBlocks(asNodes(root.content), { depth: 0 }).join(`

`);
  return markdown.replace(/\n{3,}/g, `

`).trim();
}
var INLINE_LINK = /^\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/;
var INLINE_STRONG_STAR = /^\*\*([\s\S]+?)\*\*/;
var INLINE_STRONG_UNDERSCORE = /^__([\s\S]+?)__/;
var INLINE_STRIKE = /^~~([\s\S]+?)~~/;
var INLINE_CODE = /^`([^`]+)`/;
var INLINE_EM_STAR = /^\*([^*\n]+)\*/;
var INLINE_EM_UNDERSCORE = /^_([^_\n]+)_/;
var markText = (nodes, mark) => nodes.flatMap((node) => node.type === "text" ? [{ ...node, marks: [...node.marks ?? [], mark] }] : [node]);
var parseInline = (source) => {
  const nodes = [];
  let plain = "";
  let index = 0;
  const flush = () => {
    if (plain !== "") {
      nodes.push({ type: "text", text: plain });
      plain = "";
    }
  };
  while (index < source.length) {
    const rest = source.slice(index);
    const link = rest.match(INLINE_LINK);
    if (link) {
      flush();
      const href = link[2] ?? "";
      nodes.push(...markText(parseInline(link[1] ?? ""), { type: "link", attrs: { href } }));
      index += link[0].length;
      continue;
    }
    const strong = rest.match(INLINE_STRONG_STAR) ?? rest.match(INLINE_STRONG_UNDERSCORE);
    if (strong) {
      flush();
      nodes.push(...markText(parseInline(strong[1] ?? ""), { type: "strong" }));
      index += strong[0].length;
      continue;
    }
    const strike = rest.match(INLINE_STRIKE);
    if (strike) {
      flush();
      nodes.push(...markText(parseInline(strike[1] ?? ""), { type: "strike" }));
      index += strike[0].length;
      continue;
    }
    const code = rest.match(INLINE_CODE);
    if (code) {
      flush();
      nodes.push({ type: "text", text: code[1] ?? "", marks: [{ type: "code" }] });
      index += code[0].length;
      continue;
    }
    const em = rest.match(INLINE_EM_STAR) ?? rest.match(INLINE_EM_UNDERSCORE);
    if (em) {
      flush();
      nodes.push(...markText(parseInline(em[1] ?? ""), { type: "em" }));
      index += em[0].length;
      continue;
    }
    const char = source[index] ?? "";
    if (char === "`" || char === "*" || char === "_" || char === "~" || char === "[") {
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
var isFence = (line) => line.match(/^\s*(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/);
var isHeading = (line) => line.match(/^(#{1,6})\s+(.*?)\s*$/);
var isRule = (line) => /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
var isQuote = (line) => /^\s*>\s?/.test(line);
var isBullet = (line) => line.match(/^(\s*)[-*+]\s+(.*)$/);
var isOrdered = (line) => line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
var startsBlock = (line) => isFence(line) !== null || isHeading(line) !== null || isRule(line) || isQuote(line) || isBullet(line) !== null || isOrdered(line) !== null;
var parseList = (lines, startIndex, ordered) => {
  const first = ordered ? isOrdered(lines[startIndex] ?? "") : isBullet(lines[startIndex] ?? "");
  const baseIndent = first?.[1]?.length ?? 0;
  const order = ordered ? Number(first?.[2] ?? 1) : 0;
  const items = [];
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const match = ordered ? isOrdered(line) : isBullet(line);
    if (!match || (match[1]?.length ?? 0) !== baseIndent)
      break;
    const textLine = ordered ? match[3] ?? "" : match[2] ?? "";
    const contentLines = [textLine];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      if (next.trim() === "") {
        const following = lines[index + 1] ?? "";
        const followingMatch = ordered ? isOrdered(following) : isBullet(following);
        if (!followingMatch || (followingMatch[1]?.length ?? 0) !== baseIndent)
          break;
        index += 1;
        continue;
      }
      const nested = ordered ? isOrdered(next) : isBullet(next);
      if (nested && (nested[1]?.length ?? 0) === baseIndent)
        break;
      contentLines.push(next.replace(new RegExp(`^\\s{0,${baseIndent + 2}}`), ""));
      index += 1;
    }
    const content = parseBlocks(contentLines);
    items.push({ type: "listItem", content: content.length > 0 ? content : [{ type: "paragraph", content: [] }] });
  }
  const node = ordered ? { type: "orderedList", attrs: { order }, content: items } : { type: "bulletList", content: items };
  return { node, next: index };
};
var parseBlocks = (lines) => {
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      index += 1;
      continue;
    }
    const fence = isFence(line);
    if (fence) {
      const marker = fence[1] ?? "```";
      const language = fence[2] ?? "";
      const code = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trimStart().startsWith(marker)) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length)
        index += 1;
      const joined = code.join(`
`);
      const node = { type: "codeBlock", content: joined === "" ? [] : [{ type: "text", text: joined }] };
      if (language !== "")
        node.attrs = { language };
      blocks.push(node);
      continue;
    }
    const heading = isHeading(line);
    if (heading) {
      blocks.push({
        type: "heading",
        attrs: { level: (heading[1] ?? "#").length },
        content: parseInline(heading[2] ?? "")
      });
      index += 1;
      continue;
    }
    if (isRule(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }
    if (isQuote(line)) {
      const quoted = [];
      while (index < lines.length && isQuote(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
        index += 1;
      }
      const content = parseBlocks(quoted);
      blocks.push({ type: "blockquote", content: content.length > 0 ? content : [{ type: "paragraph", content: [] }] });
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
    const content = [];
    let hardBreakNext = false;
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (current.trim() === "")
        break;
      if (content.length > 0 && startsBlock(current))
        break;
      if (content.length > 0)
        content.push(hardBreakNext ? { type: "hardBreak" } : { type: "text", text: " " });
      content.push(...parseInline(current.replace(/\s{2,}$/, "")));
      hardBreakNext = /\s{2,}$/.test(current);
      index += 1;
    }
    blocks.push({ type: "paragraph", content });
  }
  return blocks;
};
function markdownToAdf(markdown) {
  const source = markdown.replace(/\r\n?/g, `
`);
  if (source.trim() === "")
    throw new Error("comment body is empty");
  return { type: "doc", version: 1, content: parseBlocks(source.split(`
`)) };
}

// service/jira.ts
var normalize = (value) => value.trim().toLowerCase().replace(/\s+/g, " ");
var STATUS_CATEGORIES = {
  new: "todo",
  "to do": "todo",
  todo: "todo",
  open: "todo",
  indeterminate: "in-progress",
  "in-flight": "in-progress",
  "in progress": "in-progress",
  "in-progress": "in-progress",
  started: "in-progress",
  done: "done",
  complete: "done",
  completed: "done",
  closed: "done"
};
var mapStatusCategory = (category) => {
  if (typeof category !== "object" || category === null)
    return null;
  const record = category;
  for (const candidate of [record.key, record.name]) {
    if (typeof candidate !== "string")
      continue;
    const mapped = STATUS_CATEGORIES[normalize(candidate)];
    if (mapped)
      return mapped;
  }
  return null;
};
var PRIORITIES = {
  highest: "urgent",
  blocker: "urgent",
  critical: "urgent",
  urgent: "urgent",
  p1: "urgent",
  "1": "urgent",
  high: "high",
  major: "high",
  p2: "high",
  "2": "high",
  medium: "medium",
  normal: "medium",
  p3: "medium",
  "3": "medium",
  low: "low",
  lowest: "low",
  minor: "low",
  trivial: "low",
  p4: "low",
  p5: "low",
  "4": "low",
  "5": "low"
};
var mapPriorityName = (name) => {
  if (typeof name !== "string")
    return "none";
  return PRIORITIES[normalize(name)] ?? "none";
};
var priorityFilterNames = (priority, available) => {
  if (priority === "all" || priority === "none")
    return [];
  const seen = new Set;
  const names = [];
  for (const name of available) {
    if (mapPriorityName(name) !== priority)
      continue;
    const key = normalize(name);
    if (seen.has(key))
      continue;
    seen.add(key);
    names.push(name);
  }
  return names;
};
var escapeJqlString = (value) => value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
var ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
var PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
var isIssueKey = (value) => ISSUE_KEY.test(value);
var isProjectKey = (value) => PROJECT_KEY.test(value);
var EPIC_LINK_SCHEMA = "com.pyxis.greenhopper.jira:gh-epic-link";
var epicLinkFieldId = (fields) => {
  if (!Array.isArray(fields))
    return null;
  const typed = fields;
  const bySchema = typed.find((field) => typeof field?.id === "string" && field.schema?.custom === EPIC_LINK_SCHEMA);
  if (bySchema)
    return bySchema.id;
  const byName = typed.find((field) => typeof field?.id === "string" && typeof field?.name === "string" && field.name.trim().toLowerCase() === "epic link" && /^customfield_\d+$/.test(field.id));
  return byName ? byName.id : null;
};
var epicChildrenJql = (key, fieldId) => {
  const escaped = escapeJqlString(key);
  const conditions = [`parent = "${escaped}"`];
  const custom = fieldId?.match(/^customfield_(\d+)$/);
  if (custom)
    conditions.push(`cf[${custom[1]}] = "${escaped}"`);
  return `${conditions.join(" OR ")} ORDER BY updated DESC`;
};
var isEpicIssueType = (type) => {
  if (typeof type !== "object" || type === null)
    return false;
  const record = type;
  if (typeof record.name === "string" && normalize(record.name) === "epic")
    return true;
  return typeof record.hierarchyLevel === "number" && record.hierarchyLevel >= 1;
};
var stateCondition = (state) => {
  switch (state) {
    case "open":
      return "statusCategory != Done";
    case "all":
      return null;
    case "todo":
      return 'statusCategory = "To Do"';
    case "in-progress":
      return 'statusCategory = "In Progress"';
    case "done":
      return "statusCategory = Done";
    default:
      throw new Error(`unknown state filter "${state}"`);
  }
};
var peopleCondition = (people) => {
  switch (people) {
    case "any":
      return null;
    case "created":
      return "reporter = currentUser()";
    case "me":
    default:
      return "assignee = currentUser()";
  }
};
var buildJql = (input, priorityNames) => {
  const conditions = [];
  if (input.containerId !== null) {
    if (!PROJECT_KEY.test(input.containerId))
      throw new Error(`"${input.containerId}" is not a Jira project key`);
    conditions.push(`project = "${escapeJqlString(input.containerId)}"`);
  }
  const state = stateCondition(input.state);
  if (state)
    conditions.push(state);
  const people = peopleCondition(input.people);
  if (people)
    conditions.push(people);
  if (input.priority === "none") {
    conditions.push("priority is EMPTY");
  } else if (input.priority !== "all") {
    const names = priorityFilterNames(input.priority, priorityNames);
    if (names.length === 0)
      return { jql: "", matchesNothing: true };
    conditions.push(`priority in (${names.map((name) => `"${escapeJqlString(name)}"`).join(", ")})`);
  }
  const query = input.query?.trim() ?? "";
  if (query !== "") {
    const escaped = escapeJqlString(query);
    conditions.push(isIssueKey(query) ? `(key = "${escaped}" OR summary ~ "${escaped}")` : `summary ~ "${escaped}"`);
  }
  const where = conditions.length === 0 ? ["project is not EMPTY"] : conditions;
  return { jql: `${where.join(" AND ")} ORDER BY updated DESC`, matchesNothing: false };
};

// service/main.ts
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var serviceToken = process.env.OPENCHAMBER_SERVICE_TOKEN ?? "";
if (!port || !serviceToken) {
  console.error("OPENCHAMBER_SERVICE_PORT and OPENCHAMBER_SERVICE_TOKEN are required");
  process.exit(1);
}
var outbound = createTrackerOutbound({ env: process.env });

class CallError extends Error {
  status;
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}
var truncate = (value, max) => value.length <= max ? value : value.slice(0, max);
var jiraMessage = (response) => {
  try {
    const parsed = JSON.parse(response.body);
    const messages = [];
    if (Array.isArray(parsed.errorMessages)) {
      messages.push(...parsed.errorMessages.filter((value) => typeof value === "string"));
    }
    if (parsed.errors && typeof parsed.errors === "object" && !Array.isArray(parsed.errors)) {
      for (const [field, value] of Object.entries(parsed.errors)) {
        if (typeof value === "string")
          messages.push(`${field}: ${value}`);
      }
    }
    if (messages.length > 0)
      return messages.join(" ");
  } catch {}
  return response.body.trim().slice(0, 300);
};
var serverFailure = (response) => {
  if (response.status === 401)
    return new CallError("Jira refused the credential (401).", 401);
  const detail = jiraMessage(response);
  const verb = response.status === 429 ? "Jira rate-limited the request" : "Jira answered";
  return new CallError(`${verb} ${response.status}${detail ? `: ${detail}` : "."}`, response.status);
};
var api = async (call, method, path, options = {}) => {
  const response = await outbound.request(call.handle, {
    method,
    path,
    ...options.query ? { query: options.query } : {},
    headers: options.body ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" },
    ...options.body ? { body: JSON.stringify(options.body) } : {}
  });
  if (response.status >= 400)
    throw serverFailure(response);
  if (response.status === 204 || response.body.trim() === "")
    return;
  try {
    return JSON.parse(response.body);
  } catch {
    throw new CallError("Jira answered with something other than JSON.", 502);
  }
};
var orNull = async (request) => {
  try {
    return await request;
  } catch (error) {
    if (error instanceof CallError && error.status === 404)
      return null;
    throw error;
  }
};
var seg = encodeURIComponent;
var textOf = (value) => typeof value === "string" && value !== "" ? value : null;
var itemUrl = (instance, key) => `${instance.replace(/\/+$/, "")}/browse/${seg(key)}`;
var personOf = (person) => {
  if (!person || typeof person !== "object")
    return null;
  const name = textOf(person.displayName) ?? textOf(person.emailAddress);
  const avatar = textOf(person.avatarUrls?.["48x48"]) ?? textOf(person.avatarUrls?.["24x24"]);
  return {
    name: name === null ? null : truncate(name, 256),
    avatarUrl: avatar === null ? null : truncate(avatar, 2048)
  };
};
var stateOf = (status) => {
  if (!status || typeof status !== "object")
    return null;
  const id = textOf(status.id);
  const name = textOf(status.name);
  if (!name)
    return null;
  return {
    id,
    name: truncate(name, 256),
    category: mapStatusCategory(status.statusCategory)
  };
};
var containerOf = (project) => {
  if (!project || typeof project !== "object")
    return null;
  const key = textOf(project.key);
  const id = key ?? textOf(project.id);
  const name = textOf(project.name);
  if (!id || !name)
    return null;
  return { id, key, name: truncate(name, 256) };
};
var labelsOf = (labels) => {
  if (!Array.isArray(labels))
    return [];
  return labels.flatMap((value) => {
    if (typeof value !== "string" || value.trim() === "")
      return [];
    const name = truncate(value, 256);
    return [{ id: truncate(value, 1024), name, color: null }];
  }).slice(0, 100);
};
var summaryOf = (call, issue) => {
  const key = textOf(issue.key) ?? (issue.id === undefined ? null : String(issue.id));
  if (!key)
    return null;
  const fields = issue.fields ?? {};
  const title = textOf(fields.summary) ?? "(no summary)";
  return {
    id: truncate(key, 1024),
    identifier: truncate(key, 128),
    title: truncate(title, 4096),
    url: itemUrl(call.instance, key),
    state: stateOf(fields.status),
    priority: fields.priority ? mapPriorityName(fields.priority.name) : "none",
    labels: labelsOf(fields.labels),
    assignee: personOf(fields.assignee),
    container: containerOf(fields.project),
    updatedAt: textOf(fields.updated)
  };
};
var progressOf = (children, more) => {
  if (children.length === 0)
    return null;
  const done = children.filter((child) => child.state?.category === "done").length;
  return { total: children.length, done, more };
};
var descriptionOf = (issue) => {
  const markdown = adfToMarkdown(issue.fields?.description);
  return markdown === "" ? null : truncate(markdown, 262144);
};
var commentOf = (comment) => {
  const id = comment.id === undefined ? null : String(comment.id);
  if (!id)
    return null;
  return {
    id: truncate(id, 1024),
    body: truncate(adfToMarkdown(comment.body), 65536),
    createdAt: textOf(comment.created),
    author: personOf(comment.author)
  };
};
var ISSUE_FIELDS = "summary,status,priority,labels,assignee,reporter,project,updated,description,parent,subtasks,issuetype";
var LIST_FIELDS = "summary,status,priority,labels,assignee,project,updated";
var EPIC_FIELD_TTL_MS = 5 * 60 * 1000;
var epicFieldCache = new Map;
var COMMENTS_BYTE_BUDGET = 1e6;
var epicLinkField = async (call) => {
  const cached = epicFieldCache.get(call.instance);
  if (cached && cached.expiresAt > Date.now())
    return cached.id;
  let id = null;
  try {
    id = epicLinkFieldId(await api(call, "GET", "/rest/api/3/field"));
  } catch {
    id = null;
  }
  epicFieldCache.set(call.instance, {
    id,
    expiresAt: Date.now() + (id === null ? 60000 : EPIC_FIELD_TTL_MS)
  });
  return id;
};
var loadIssue = async (call, id, extraFields = []) => {
  const fields = [...new Set([...ISSUE_FIELDS.split(","), ...extraFields])].join(",");
  return orNull(api(call, "GET", `/rest/api/3/issue/${seg(id)}`, { query: { fields } }));
};
var epicLinkOf = (value) => {
  const direct = textOf(value);
  if (direct)
    return isIssueKey(direct) ? direct : null;
  if (typeof value !== "object" || value === null)
    return null;
  const key = textOf(value.key);
  return key && isIssueKey(key) ? key : null;
};
var loadItem = async (call, id, withComments) => {
  const epicFieldId = await epicLinkField(call);
  const extraFields = epicFieldId ? [epicFieldId] : [];
  const issue = await loadIssue(call, id, extraFields);
  if (!issue)
    return null;
  const summary = summaryOf(call, issue);
  if (!summary)
    return null;
  const item = {
    ...summary,
    description: descriptionOf(issue)
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
  if (parent)
    item.parent = parent;
  const children = [];
  const seen = new Set;
  for (const child of fields.subtasks ?? []) {
    const value = summaryOf(call, child);
    if (!value || seen.has(value.id))
      continue;
    seen.add(value.id);
    children.push(value);
  }
  let moreChildren = false;
  if (isEpicIssueType(fields.issuetype)) {
    const answer = await api(call, "GET", "/rest/api/3/search/jql", {
      query: {
        jql: epicChildrenJql(summary.identifier, epicFieldId),
        maxResults: "100",
        fields: LIST_FIELDS
      }
    });
    for (const child of answer.issues ?? []) {
      const value = summaryOf(call, child);
      if (!value || seen.has(value.id) || value.id === summary.id)
        continue;
      seen.add(value.id);
      children.push(value);
    }
    moreChildren = textOf(answer.nextPageToken) !== null || answer.isLast === false;
  }
  const shown = children.slice(0, 100);
  if (shown.length > 0)
    item.children = shown;
  const truncated = moreChildren || children.length > shown.length;
  if (truncated)
    item.childrenMore = true;
  const progress = progressOf(shown, truncated);
  if (progress)
    item.progress = progress;
  if (withComments) {
    const answer = await api(call, "GET", `/rest/api/3/issue/${seg(summary.identifier)}/comment`, { query: { maxResults: "100", orderBy: "-created" } });
    const comments = (answer.comments ?? []).flatMap((comment) => {
      const value = commentOf(comment);
      return value ? [value] : [];
    }).reverse();
    const byteLength = (comment) => Buffer.byteLength(comment.body, "utf8");
    let total = comments.reduce((sum, comment) => sum + byteLength(comment), 0);
    let first = 0;
    while (first < comments.length - 1 && total > COMMENTS_BYTE_BUDGET) {
      total -= byteLength(comments[first]);
      first += 1;
    }
    item.comments = comments.slice(first);
  }
  return item;
};
var PRIORITY_TTL_MS = 5 * 60 * 1000;
var priorityCache = new Map;
var sitePriorities = async (call) => {
  const cached = priorityCache.get(call.instance);
  if (cached && cached.expiresAt > Date.now())
    return cached.names;
  const answer = await api(call, "GET", "/rest/api/3/priority");
  const names = Array.isArray(answer) ? answer.flatMap((priority) => typeof priority?.name === "string" ? [priority.name] : []) : [];
  priorityCache.set(call.instance, { names, expiresAt: Date.now() + PRIORITY_TTL_MS });
  return names;
};
var handlers = {
  "auth.probe": async (call) => {
    let response;
    try {
      response = await outbound.request(call.handle, {
        method: "GET",
        path: "/rest/api/3/serverInfo",
        headers: { accept: "application/json" }
      });
    } catch (error) {
      return {
        supported: false,
        message: `${call.instance} could not be reached: ${error instanceof Error ? error.message : "unknown error"}`
      };
    }
    if (response.status === 401 || response.status === 403 || response.status >= 300 && response.status < 400) {
      return { supported: true, message: "Jira is reachable; sign in to connect the account." };
    }
    if (response.status !== 200) {
      return { supported: false, message: `${call.instance} answered ${response.status} to /rest/api/3/serverInfo.` };
    }
    let info;
    try {
      info = JSON.parse(response.body);
    } catch {
      info = null;
    }
    if (!info || typeof info !== "object") {
      return { supported: false, message: `${call.instance} is not a Jira Cloud site.` };
    }
    if (info.deploymentType === "Cloud")
      return { supported: true };
    return {
      supported: false,
      message: `${call.instance} reports ${textOf(info.deploymentType) ?? "an unknown deployment"}; only Jira Cloud is supported.`
    };
  },
  "auth.verify": async (call) => {
    const info = await api(call, "GET", "/rest/api/3/serverInfo");
    if (info && typeof info.deploymentType === "string" && info.deploymentType !== "Cloud") {
      throw new CallError(`Only Jira Cloud is supported; ${call.instance} reports ${info.deploymentType}.`, 400);
    }
    const me = await api(call, "GET", "/rest/api/3/myself");
    const id = textOf(me.accountId);
    if (!id)
      throw new CallError("Jira answered no account id for this credential.", 502);
    const login = textOf(me.emailAddress) ?? textOf(me.displayName);
    const account = { id, login };
    const name = textOf(me.displayName);
    if (name)
      account.name = name;
    const avatarUrl = textOf(me.avatarUrls?.["48x48"]) ?? textOf(me.avatarUrls?.["24x24"]);
    if (avatarUrl)
      account.avatarUrl = avatarUrl;
    return { account };
  },
  "items.list": async (call, input) => {
    const filters = {
      state: input.state,
      people: input.people,
      priority: input.priority,
      containerId: input.containerId,
      ...input.query === undefined ? {} : { query: input.query }
    };
    const jqlFor = (names) => {
      try {
        return buildJql(filters, names);
      } catch (error) {
        throw new CallError(error instanceof Error ? error.message : "Jira filter is not valid.", 400);
      }
    };
    jqlFor([]);
    const needsPriorities = input.priority !== "all" && input.priority !== "none";
    const priorityNames = needsPriorities ? await sitePriorities(call) : [];
    const { jql, matchesNothing } = jqlFor(priorityNames);
    if (matchesNothing)
      return { items: [], cursor: null, hasMore: false };
    const query = { jql, maxResults: "100", fields: LIST_FIELDS };
    if (input.cursor)
      query.nextPageToken = input.cursor;
    const answer = await api(call, "GET", "/rest/api/3/search/jql", { query });
    const items = (answer.issues ?? []).flatMap((issue) => {
      const value = summaryOf(call, issue);
      return value ? [value] : [];
    });
    const next = textOf(answer.nextPageToken);
    const hasMore = next !== null && answer.isLast !== true;
    return { items, cursor: hasMore ? next : null, hasMore };
  },
  "items.get": async (call, input) => ({
    item: await loadItem(call, input.id, true)
  }),
  "items.updateState": async (call, input) => {
    const answer = await orNull(api(call, "GET", `/rest/api/3/issue/${seg(input.id)}/transitions`));
    if (!answer)
      return { item: null };
    const transitions = Array.isArray(answer.transitions) ? answer.transitions : [];
    const transition = transitions.find((entry) => String(entry.to?.id ?? "") === input.stateId);
    const transitionId = transition ? textOf(transition.id) : null;
    if (!transitionId) {
      throw new CallError(`Jira has no transition from this issue's current status to ${input.stateId}.`, 409);
    }
    await api(call, "POST", `/rest/api/3/issue/${seg(input.id)}/transitions`, {
      body: { transition: { id: transitionId } }
    });
    return { item: await loadItem(call, input.id, false) };
  },
  "items.liveSummaries": async (call, input) => {
    const identifiers = [...new Set(input.identifiers.map((value) => value.trim()).filter((value) => isIssueKey(value)).map((value) => value.toUpperCase()))].slice(0, 50);
    if (identifiers.length === 0)
      return { items: [] };
    const jql = `key in (${identifiers.map((value) => `"${escapeJqlString(value)}"`).join(", ")})`;
    const answer = await api(call, "GET", "/rest/api/3/search/jql", {
      query: { jql, maxResults: "50", fields: "summary,status" }
    });
    const items = (answer.issues ?? []).flatMap((issue) => {
      const key = textOf(issue.key);
      const status = issue.fields?.status;
      const name = textOf(status?.name);
      if (!key || !name)
        return [];
      return [{
        identifier: truncate(key.toUpperCase(), 128),
        title: truncate(textOf(issue.fields?.summary) ?? "(no summary)", 4096),
        state: {
          name: truncate(name, 256),
          category: mapStatusCategory(status?.statusCategory) ?? "todo"
        }
      }];
    });
    return { items };
  },
  "states.list": async (call, input) => {
    if (!isProjectKey(input.containerId)) {
      throw new CallError(`"${input.containerId}" is not a Jira project key.`, 400);
    }
    const answer = await api(call, "GET", `/rest/api/3/project/${seg(input.containerId)}/statuses`);
    const seen = new Set;
    const states = [];
    for (const group of Array.isArray(answer) ? answer : []) {
      for (const status of group.statuses ?? []) {
        const id = textOf(status.id);
        const name = textOf(status.name);
        if (!id || !name || seen.has(id))
          continue;
        seen.add(id);
        states.push({
          id,
          name: truncate(name, 256),
          category: mapStatusCategory(status.statusCategory),
          position: states.length
        });
        if (states.length >= 200)
          break;
      }
      if (states.length >= 200)
        break;
    }
    return { states };
  },
  "containers.list": async (call) => {
    const containers = [];
    let startAt = 0;
    while (containers.length < 500) {
      const answer = await api(call, "GET", "/rest/api/3/project/search", {
        query: { startAt: String(startAt), maxResults: "100" }
      });
      const values = Array.isArray(answer.values) ? answer.values : [];
      for (const project of values) {
        const key = textOf(project.key);
        const id = key ?? textOf(project.id);
        const name = textOf(project.name);
        if (!id || !name)
          continue;
        containers.push({ id: truncate(id, 1024), key, name: truncate(name, 256) });
        if (containers.length >= 500)
          break;
      }
      if (values.length === 0)
        break;
      if (answer.isLast === true)
        break;
      startAt += values.length;
      if (values.length < 100)
        break;
    }
    return { containers };
  },
  "comments.create": async (call, input) => {
    let body;
    try {
      body = markdownToAdf(input.body);
    } catch {
      throw new CallError("The comment body is empty.", 400);
    }
    const comment = await orNull(api(call, "POST", `/rest/api/3/issue/${seg(input.identifier)}/comment`, { body: { body } }));
    if (!comment)
      return { comment: null };
    const id = comment.id === undefined ? null : String(comment.id);
    if (!id)
      throw new CallError("Jira created the comment but answered no id.", 502);
    return { comment: { id: truncate(id, 1024) } };
  }
};
var failureOf = (error) => {
  const failure = {
    message: truncate(error.message, TRACKER_PROVIDER_ERROR_MESSAGE_MAX) || "Unexpected failure"
  };
  if (error instanceof TrackerOutboundError) {
    if (error.status >= 400 && error.status <= 599)
      failure.status = error.status;
    if (/^[A-Z_]{1,64}$/.test(error.code))
      failure.code = error.code;
  } else if (error instanceof CallError) {
    failure.status = error.status;
  }
  return failure;
};
var answer = async (method, call, input) => {
  try {
    const data = await handlers[method](call, input);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: failureOf(error instanceof Error ? error : new Error(String(error))) };
  }
};
var send = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
var readBody = (req) => new Promise((resolve, reject) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => resolve(body));
  req.on("error", reject);
});
var server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${serviceToken}`) {
    send(res, 401, { error: "unauthorized" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/health") {
    send(res, 200, { ok: true });
    return;
  }
  if (url.pathname !== TRACKER_PROVIDER_PATH || req.method !== "POST") {
    send(res, 404, { error: "not-found" });
    return;
  }
  readBody(req).then(async (body) => {
    const request = readTrackerProviderRequest(body);
    if (!request) {
      send(res, 400, { error: "not a tracker call this service understands" });
      return;
    }
    send(res, 200, await answer(request.method, { instance: request.session.instance, handle: request.session.handle }, request.input));
  }).catch(() => send(res, 500, { error: "could not read the request" }));
});
server.listen(port, "127.0.0.1");
