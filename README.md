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
   or clone the repository and use that folder:

   ```bash
   git clone https://github.com/pgquiles/openchamber-jira
   ```

   A checkout needs no build: OpenChamber runs the committed
   `service/main.js`. The npm scripts are for development only; see
   [Development](#development) to run the tests or rebuild the bundle.

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

### More than one account on the same site

The manifest declares `multipleAccounts`, so once the first account is connected
the card offers **Add account**. The new credential is verified against the same
site and becomes the active account; the board's account picker and the card
switch between them. Each account keeps its own token and permissions, which
suits a shared workstation or a personal account plus a service account.

A second **site** is not possible in OpenChamber 2.8.0. The host stores one
instance per tracker and, once an account exists, neither asks for a site nor
accepts a different one. **Add account** therefore checks the credential against
the site already connected: a user who is not a member there gets 401, and a
user who is a member gets an account on the wrong site. This needs the host to
keep an instance per account
([openchamber#7653](https://github.com/openchamber/openchamber/issues/7653)),
tracked as [#9](https://github.com/pgquiles/openchamber-jira/issues/9). To move
to another site, disconnect every account; the site field comes back.

### Jira permissions

The token acts as your Jira user. For the features below, your account needs:

| Feature | Jira permission |
| --- | --- |
| Find issues, read details, projects and statuses | Browse projects |
| Change an issue's status | Transition issues |
| Post session comments | Add comments |

Only issues you can see in Jira appear in OpenChamber.

Connecting needs **Browse projects** somewhere on the site. An account that can
see no project is refused at connect, with the fix, instead of being connected
to a board that stays empty. A read-only token connects: **Transition issues**
and **Add comments** are checked by the action that needs them, so only that
action fails, with a message naming the missing permission or scope.

## Where Jira appears in OpenChamber

OpenChamber 2.8.0 draws tracker UI itself. This extension does **not** add a
separate Jira rail panel. The Jira card in Settings holds only the connection
and its optional mapping; it is not the issue list. The list is on the **issues
board**, and the picker is in the **composer**.

| Where | How to get there | What it shows |
| --- | --- | --- |
| Issues board | `Ctrl+K` then `B` (`Cmd+K` then `B` on macOS), or the Command Palette → **Show or hide issues and PRs** | Choose **Jira** in the source menu at the top. The board opens on the repository tab when the project is a Git repository; the Jira tab is beside it. It remembers the tab you chose. |
| Composer | Click the **+** (Add attachment) button at the bottom-left of the composer → **Link Jira Issue** | The Jira picker: search, people, state, priority, and project filters. The `@` menu is OpenChamber's file mention picker; it does not list Jira issues. |
| Issue detail | Select an issue on the board, or open a `https://your-site.atlassian.net/browse/KEY-123` link | Description, comments, parent and children, and the available state changes, in the Tracker panel or tab. |
| Settings | **Settings → Integrations → Extension accounts → Jira** | Connect or disconnect an account, add another account on the same site, choose project mapping, and turn session comments on or off. It is not the issue list. |

The Jira tab and the composer action appear only while the account is
connected. If the board is already open, choose **Jira** from its source menu.
An issue linked from the composer stays on the session as a chip with its live
state.

**Changing state.** Open the issue from the **issues board**. The composer
picker's preview is for choosing an issue and is read-only, so it has no state
menu. In the board's detail (the side preview or the issue tab), the state pill
in the header is a menu. Pick another workflow state and the extension resolves
the issue's available transition. If Jira asks for fields the transition needs,
the change fails with Jira's own 400 error, which names the missing fields
(a custom field by display name and id, so it stays searchable); finish that
step in Jira from the issue's header link.

**Comments are read-only.** OpenChamber 2.8.0 shows an issue's comments but
draws no composer for tracker items. The tracker contract's `comments.create`
is wired only to the optional **Session comments** setting, which posts a
session summary when a session starts, finishes, or fails. Adding a comment of
your own from the detail view is a host-side gap, tracked upstream in
[openchamber#7641](https://github.com/openchamber/openchamber/issues/7641);
the extension already implements the write.

**No rail panel (proposed in #16).** The right rail is OpenChamber's strip of
panel icons beside the chat (Git, Files, Terminal, and any extension with a
panel page). This extension's `contributes.panel` has no `entry`, so it draws
no rail icon and no Jira rail panel. The tracker contract provides the board
tab, the composer picker, and the detail view.

A rail panel — "Assigned to me" with issue rows — would be an extra extension
page. A guest page cannot read tracker items today: the tracker API is
host-side, and the site credential and session handle never reach the
extension. It needs an upstream guest tracker read path, or a host-drawn panel.
The design and a sketch are tracked in
[issue #16](https://github.com/pgquiles/openchamber-jira/issues/16); it is not
part of 0.3.3.

The board's project picker is also drawn by OpenChamber. In 2.8.0 it had no
scrollbar on a site with hundreds of projects, so projects past the first
screenful could not be reached. That is an OpenChamber bug, fixed in
[2.8.1](https://github.com/openchamber/openchamber/releases/tag/v2.8.1) by
[#7430](https://github.com/openchamber/openchamber/pull/7430). On 2.8.0, use
the composer picker, which has its own project filter and search. Tracked as
[issue #15](https://github.com/pgquiles/openchamber-jira/issues/15), closed
when 2.8.1 shipped.

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
  admins can revoke them earlier. After a revocation Jira's search answers with
  an empty result rather than 401, so a board that stops listing issues is the
  usual symptom; create a new token and reconnect.
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
| 401 after connecting | The token was revoked or expired, or a scoped token is missing a scope. Jira publishes no expiry for a personal API token, so the extension cannot warn before it lapses; the error says which case it can see. Create a token with the scope or reconnect. |
| A board that worked now lists nothing | The token was revoked or expired after connecting. Jira answers a search with an empty result for an invalid credential, so the account can still read **Connected**; the board and the picker go empty. Create a new token and reconnect. |
| 403 on connect | Jira denied the call. If the message says the account cannot browse any project, add it to one (or check the token scopes) and connect again. A read-only token is accepted. |
| 404 on an issue or project | The issue or project moved or was deleted, or this account cannot see it. Check the key in Jira and the account's project access. A project that disappeared from the board's picker no longer grants access to the account. |
| Empty picker | The default view is **open issues you can see**; check the state filter, project access, and that the Jira account is the one you expect. Choose **Assigned to me** to narrow it to your queue. |
| Connected, but no issues show | Open the **issues board** (`Ctrl/Cmd+K` then `B`) and choose the **Jira** tab, or use **+ → Link Jira Issue** in the composer. Settings shows only the connection and mapping. Typing `@` opens file mentions, not Jira. |
| Can't reach a project in the board's project picker | OpenChamber 2.8.0 draws that menu without a scrollbar when a site has many projects. This is a host bug, not the extension; it is fixed on OpenChamber `main` by [#7430](https://github.com/openchamber/openchamber/pull/7430) and ships in the next release. On 2.8.0, use the composer's **+ → Link Jira Issue** picker, which has its own project filter and search. |
| No comment box in the issue detail | Read-only by host design in 2.8.0: comments are shown, but no tracker comment composer is drawn. `comments.create` is used only by **Session comments**. Tracked upstream in [openchamber#7641](https://github.com/openchamber/openchamber/issues/7641). |
| Can't change status in the composer picker's preview | Expected: that preview only selects and links. Open the issue from the **issues board**; its detail has the state menu. |
| 429 | Jira rate-limited the site. The extension waits for `Retry-After` on reads (up to 3 attempts, 10 s total) and shows Jira's message with the reset time when it gives up. Writes are not retried. |
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
  up to 100 comments (shown read-only, see above), parent and children, and a
  done/total count. Media and attachments become links, panels and expandos
  keep their tone or title, and status lozenges render as bold text.
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
- The issue detail shows comments read-only in OpenChamber 2.8.0; a user
  comment composer for tracker items is a host gap
  ([openchamber#7641](https://github.com/openchamber/openchamber/issues/7641)).
  The extension implements `comments.create`; OpenChamber currently calls it
  only for session comments.
- The board's project picker is drawn by OpenChamber and had no scrollbar on
  2.8.0 with long container lists. The extension returns the projects, but
  cannot style that menu. Fixed upstream in
  [#7430](https://github.com/openchamber/openchamber/pull/7430) and shipped in
  OpenChamber 2.8.1; tracked as
  [#15](https://github.com/pgquiles/openchamber-jira/issues/15).
- The picker reads up to 100 issues per page; more pages are available through
  Jira's next page token.
- Transition screens that demand extra fields (resolution, comment, custom
  fields) cannot be completed through the tracker contract. Jira's own error is
  shown instead of guessing values; it names the fields (a custom field by
  display name and id), and the issue header opens the item in Jira to finish
  the step.
- Field names for that error come from `/rest/api/3/field`, cached for five
  minutes per site. When the cached catalog does not have an id Jira named, the
  extension asks `/field/search` for the exact id, one id at a time, up to ten
  per failure, and keeps the raw id if the lookup fails. A *renamed* field is
  not covered: an id the catalog already knows keeps its old name until the
  cache expires
  ([#34](https://github.com/pgquiles/openchamber-jira/issues/34)).
- Reads that Jira rate-limits (429, or 503 with `Retry-After`) are retried, up
  to three attempts and 10 seconds total. Writes are never retried, so a
  comment or transition cannot be duplicated; when the retries run out, the
  error names the reset time. Duplicate reads are also coalesced by
  OpenChamber's read cache.
- The extension does not create, edit, or delete issues, and does not upload
  attachments. Creating and editing need the tracker contract to grow, tracked
  as [#2](https://github.com/pgquiles/openchamber-jira/issues/2) and upstream
  [openchamber#7647](https://github.com/openchamber/openchamber/issues/7647).
  Inline media and attachments in a description appear as links to Jira's
  attachment endpoint; media that is not an attachment opens only in Jira. A
  panel or expando keeps its tone or title, and an ADF node the converter does
  not know appears as `[nodeType]` rather than disappearing.
- Project mapping and session comments are optional OpenChamber features; turn
  them on from the Jira account card after connecting.
- Several accounts can be connected to the same Jira site and switched from the
  board or the account card. Several **sites** cannot: OpenChamber 2.8.0 stores
  one instance per tracker, so the site field disappears after the first account
  ([openchamber#7653](https://github.com/openchamber/openchamber/issues/7653)).

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
   starts upstream in
   [openchamber#7647](https://github.com/openchamber/openchamber/issues/7647).
3. **Token health** — expiry, missing scopes, and a specific needs-attention
   state ([#3](https://github.com/pgquiles/openchamber-jira/issues/3)).
4. **Jira rail panel** — assigned issues, filters, and one selected issue in
   the right rail, with the board a click away
   ([#16](https://github.com/pgquiles/openchamber-jira/issues/16)). Needs a
   guest tracker read path upstream; the sketch is in
   [`docs/mockups/rail-panel.png`](docs/mockups/rail-panel.png).
5. **More Jira fields**: surface sprint, story points, due date, and
   components where the tracker contract allows
   ([#6](https://github.com/pgquiles/openchamber-jira/issues/6)).
6. **Several Jira sites per OpenChamber** — several accounts on one site work
   now; a second site needs the host to store an instance per account
   ([#9](https://github.com/pgquiles/openchamber-jira/issues/9),
   [openchamber#7653](https://github.com/openchamber/openchamber/issues/7653)).

The 15-point [live verification checklist](docs/live-verification.md) was run
against a disposable Jira Cloud site with OpenChamber 2.8.0. The 0.3.0 run
recorded the full checklist, 0.3.1 re-ran check 11 after
[#26](https://github.com/pgquiles/openchamber-jira/issues/26) (Jira's 400 now
reaches the client with the required field's name and id), and 0.3.2 re-ran the
refusal path for [#3](https://github.com/pgquiles/openchamber-jira/issues/3):
a missing project answered HTTP 404 with the new "gone or not visible" copy.
0.3.3 measured what `/rest/api/3/field` actually omits after
[#33](https://github.com/pgquiles/openchamber-jira/issues/33) and corrected the
0.3.1 note: a field stays out of the catalog while it is not associated with
the project's field scheme, and reaches the catalog once it is, which is what a
transition that requires it needs. The exact-id `/field/search` fallback covers
the window in between and the extension's own five-minute cache.
Results are on [#12](https://github.com/pgquiles/openchamber-jira/issues/12),
and the checklist stays in the repository for the next release.

The website lives in `site/` and deploys to GitHub Pages from `main` through
`.github/workflows/pages.yml`. The extension has its own CI: every pull request
and push to `main` runs the verification suite, fails on a stale
`service/main.js`, and uploads the ZIP; a `v*` tag publishes a GitHub Release
with that ZIP attached.

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

CI runs the same steps on every pull request and push to `main`, after building
once and failing if the checked-in bundle changed. The `verify` check is the one
`main` requires.

Rebuild after changing `service/*.ts`; OpenChamber runs the bundled
`service/main.js`, not the TypeScript sources.
