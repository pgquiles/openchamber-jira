# openchamber-jira

A Jira Cloud tracker for [OpenChamber](https://openchamber.dev). It adds Jira
wherever OpenChamber expects a tracker: a **Jira** tab on the issues board, a
**Link Jira Issue** action in the composer, issue previews, state changes,
session comments, and project mapping. OpenChamber draws that UI itself; the
extension does not add a separate rail panel.

The extension talks to Jira REST API v3 with the Atlassian account's email and
an API token. OpenChamber keeps the token; the extension's service never sees
it and reaches Jira only through OpenChamber's outbound proxy.

- Website and documentation: <https://pgquiles.github.io/openchamber-jira/>
- Issues and roadmap: <https://github.com/pgquiles/openchamber-jira/issues>
- Latest ZIP: <https://github.com/pgquiles/openchamber-jira/releases/latest/download/openchamber-jira.zip>

Requires OpenChamber **2.8.0** or newer, and a Jira **Cloud** site. Jira Server
and Data Center are refused.

## Install

1. Download `openchamber-jira.zip` from the
   [latest release](https://github.com/pgquiles/openchamber-jira/releases/latest),
   or build it from a checkout (development machines only):

   ```bash
   npm install
   npm run verify
   npm run zip
   ```

   `npm run verify` type-checks, rebuilds `service/main.js`, runs the tests,
   and runs `openchamber-guest-check`.

2. Open **Settings → Extensions** in OpenChamber.

3. Paste the absolute path of this folder, or the path of
   `openchamber-jira.zip`, into **Folder, ZIP, or URL** and choose **Add**.

4. Allow the extension when OpenChamber asks. It asks to run a local service
   (the tracker service) and to connect to an external service (Jira).

A folder install runs from the folder and picks up changes on reload. A ZIP is
copied into OpenChamber's data folder.

## Connect Jira

1. Create an API token at
   <https://id.atlassian.com/manage-profile/security/api-tokens>.
   A classic token is simplest. A scoped token needs `read:jira-work`,
   `write:jira-work`, and `read:jira-user`.
2. In **Settings → Integrations → Extension accounts**, find the **Jira** card.
3. Fill in:
   - **Jira site**: `https://your-company.atlassian.net` (no path, no trailing
     slash)
   - **Username**: your Atlassian account email. The card's label is the neutral
     one OpenChamber uses for Basic auth; Jira calls this field the user name.
   - **Token**: the API token from step 1.
4. Choose **Connect**.

The extension checks `/rest/api/3/serverInfo` first, then identifies the account
through `/rest/api/3/myself`. A private site that redirects an unauthenticated
request to its sign-in page is still recognized as Jira Cloud.

### Jira permissions

The token acts as your Jira user. For the features below, your account needs:

| Feature | Jira permission |
| --- | --- |
| Find issues, read details, projects and statuses | Browse projects |
| Change an issue's status | Transition issues |
| Post session comments | Add comments |

Only issues you can see in Jira appear in OpenChamber.

## Where Jira appears in OpenChamber

OpenChamber 2.8.0 draws tracker UI itself. This extension does **not** add a
separate Jira rail panel. The Jira card in Settings holds only the connection
and its optional mapping; it is not the issue list. The list is on the **issues
board**, and the picker is in the **composer**.

| Where | How to get there | What it shows |
| --- | --- | --- |
| Issues board | `Ctrl+K` then `B` (`Cmd+K` then `B` on macOS), or the Command Palette → **Show or hide issues and PRs** | Choose **Jira** in the source menu at the top. The board opens on the repository tab when the project is a Git repository; the Jira tab is beside it. It remembers the tab you chose. |
| Composer | Click the **+** (Add attachment) button at the bottom-left of the composer → **Link Jira Issue** | The Jira picker: search, people, state, priority, and project filters. The `@` menu is OpenChamber's file mention picker; it does not list Jira issues. |
| Issue detail | Select an issue on the board, or open a `https://your-site.atlassian.net/browse/KEY-123` link | Description, comments, parent and children, and the available transitions, in the Tracker panel or tab. |
| Settings | **Settings → Integrations → Extension accounts → Jira** | Connect or disconnect the site, choose project mapping, and turn session comments on or off. It is not the issue list. |

The Jira tab and the composer action appear only while the account is
connected. If the board is already open, choose **Jira** from its source menu.
An issue linked from the composer stays on the session as a chip with its live
state.

## Authentication and SSO

This extension uses HTTP Basic auth: your Atlassian account email plus an API
token. **SSO does not block this.** Atlassian API tokens authenticate even when
the organization enforces SAML single sign-on or two-step verification, and
Atlassian does not ask for an extra identity check when an SSO user creates a
token.

What an organization can still change:

- **API token policy.** An organization admin can block members from creating
  or using user API tokens, or cap their lifetime, through an Atlassian Guard
  authentication policy. When that is on, Jira answers 401/403 and the
  extension cannot override it. The account needs an exception, a service
  account, or OAuth.
- **Expiry and revocation.** New tokens expire after one year by default, and
  admins can revoke them earlier. Reconnect with a fresh token when Jira starts
  answering 401.
- **Scopes.** A scoped token needs `read:jira-work`, `write:jira-work` and
  `read:jira-user`. A classic token works too, with the user's full access.
- **Product access.** The account must still be a licensed Jira user with
  permission to browse the projects.

Atlassian's current guidance discourages integrations that collect and store
personal API tokens. For a company rollout, an organization-approved service
account is the simplest interim step. OAuth 2.0 three-legged authorization is
the durable replacement; see the roadmap below for why it is not a one-line
manifest change for Jira.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| 401 after connecting | Token expired, was revoked, or API token access is blocked by policy. Create a new token and reconnect. |
| 403 on connect | The account lacks `read:jira-user` (scoped token), or Jira denied the call. Check scopes and site permissions. |
| Empty picker | The default view is **open issues you can see**; check the state filter, project access, and that the Jira account is the one you expect. Choose **Assigned to me** to narrow it to your queue. |
| Connected, but no issues show | Open the **issues board** (`Ctrl/Cmd+K` then `B`) and choose the **Jira** tab, or use **+ → Link Jira Issue** in the composer. Settings shows only the connection and mapping. Typing `@` opens file mentions, not Jira. |
| 429 | Jira rate-limited the site. Wait for the `Retry-After` interval; the extension surfaces the error rather than retrying silently. |
| “Only Jira Cloud is supported” | The URL points at Jira Server or Data Center. |
| A transition fails | The workflow screen requires fields the tracker contract cannot fill. Complete that step in Jira. |


## What it supports

- **Listing and search** through JQL (`/rest/api/3/search/jql`), most recently
  updated first, on the **Jira** tab of the issues board and in the composer
  picker. The default is open issues you can see; choose **Assigned to me** for
  your own queue. Search matches summaries and issue keys.
- **State filters** `open`, `all`, `todo`, `in-progress`, `done`, mapped to
  Jira status categories. `canceled` is not offered because Jira has no native
  canceled category; canceled statuses report as `done`.
- **People filters** for issues assigned to you, created by you, or anyone you can see.
- **Priority filters** using the site's own priority names. `none` means the
  priority field is empty. The priority list is cached per site for five
  minutes.
- **Labels** and **projects as containers**, keyed by project key so the
  container id works directly in JQL.
- **Details**: Markdown description converted from Atlassian Document Format,
  up to 100 comments, parent and children, and a done/total count.
- **Children**: native sub-tasks and parent, plus team-managed epic children and
  company-managed **Epic Link** children. The Epic Link field is discovered by
  its custom-field schema, so localized field names still work. A child list
  Jira truncates is marked rather than silently shortened.
- **State changes** through the issue's available transitions. The extension
  finds the transition whose destination is the requested status.
- **Session comments** posted as valid ADF, with the session link kept as a
  link mark.

## Limits and known behavior

- Jira **Cloud** only.
- Comments are read in one page of up to 100 per issue. If the newest comments
  still exceed OpenChamber's response size, the oldest ones are left out.
- The picker reads up to 100 issues per page; more pages are available through
  Jira's next page token.
- Transition screens that demand extra fields (resolution, comment, custom
  fields) cannot be completed through the tracker contract. Jira's own error is
  shown instead of guessing values.
- Rate limits (HTTP 429) and other Jira errors are surfaced as-is, not retried.
- The extension does not create, edit, or delete issues, and does not handle
  attachments. Images embedded in a description are left out of the Markdown.
- Project mapping and session comments are optional OpenChamber features; turn
  them on from the Jira account card after connecting.

## Roadmap

Ordered by what unlocks the most:

1. **OAuth 2.0 3LO** for organizations that block personal API tokens
   ([#1](https://github.com/pgquiles/openchamber-jira/issues/1)). Jira's 3LO
   tokens are sent to `api.atlassian.com/ex/jira/{cloudId}`, not directly to
   the site origin, so this needs an upstream way to resolve the cloud id and
   reach that gateway (or a small relay) in addition to the `auth.oauth` block.
2. **Create and edit issues** — new items, assignee, priority, labels, and
   description edits
   ([#2](https://github.com/pgquiles/openchamber-jira/issues/2)). OpenChamber's
   tracker contract currently exposes state changes and comments only, so this
   starts upstream.
3. **Token health** — expiry, missing scopes, and a specific needs-attention
   state ([#3](https://github.com/pgquiles/openchamber-jira/issues/3)).
4. **Richer Jira content**: show images and attachments as links, render panels
   and expandos, keep mentions readable, and surface sprint/story points where
   the contract allows
   ([#5](https://github.com/pgquiles/openchamber-jira/issues/5),
   [#6](https://github.com/pgquiles/openchamber-jira/issues/6)).
5. **Rate-limit handling**: honor `Retry-After`, coalesce duplicate reads, and
   back off on 429 without hiding the failure from the user
   ([#4](https://github.com/pgquiles/openchamber-jira/issues/4)).
6. **CI and releases**: GitHub Actions for typecheck, tests, guest check, ZIP
   artifact, and tagged releases
   ([#10](https://github.com/pgquiles/openchamber-jira/issues/10)).
7. **Multiple Jira sites per OpenChamber** through `multipleAccounts`, useful for
   contractors and shared workstations
   ([#9](https://github.com/pgquiles/openchamber-jira/issues/9)).
8. **Live verification and real screenshots** against a disposable Jira Cloud
   site ([#12](https://github.com/pgquiles/openchamber-jira/issues/12)).

The website lives in `site/` and deploys to GitHub Pages from `main` through
`.github/workflows/pages.yml`.

## Development

```bash
npm install
npm run typecheck   # tsc
npm test            # rebuild the bundle, then bun test (adf, jira, service contract)
npm run build       # bundle service/main.ts -> service/main.js
npm run check       # openchamber-guest-check .
npm run verify      # all of the above
npm run zip         # openchamber-jira.zip
```

Layout:

| Path | Purpose |
| --- | --- |
| `package.json` | Extension manifest and scripts |
| `service/main.ts` | Tracker service: handlers, Jira calls, HTTP server |
| `service/adf.ts` | Atlassian Document Format ↔ Markdown |
| `service/jira.ts` | Status/priority mapping, JQL, key checks, epic helpers |
| `service/main.js` | Built bundle; this is what OpenChamber runs |
| `test/fixtures/fake-jira.ts` | Jira Cloud stand-in for contract tests |
| `test/service.test.ts` | End-to-end service tests through a proxy that enforces the contract |
| `test/adf.test.ts`, `test/jira.test.ts` | Unit tests |

The contract tests spawn the built `service/main.js`, send `POST /tracker`
requests with the service bearer, and play OpenChamber's outbound proxy in
front of a fake Jira. Read requests go through GET-only handles; writes use
POST. That is how the tests catch a method the real host would refuse.

Rebuild after changing `service/*.ts`; OpenChamber runs the bundled
`service/main.js`, not the TypeScript sources.
