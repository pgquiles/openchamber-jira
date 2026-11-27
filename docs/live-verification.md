# Live verification against Jira Cloud

This is the checklist for issue
[#12](https://github.com/pgquiles/openchamber-jira/issues/12): exercise the
extension against a real Jira Cloud site, record what happened, and replace the
website's demo previews with real captures.

Use a **disposable Jira Cloud site** (the free plan is enough) and a **test
project**. Do not capture a production site: public screenshots must not expose
real project names, issue keys, titles, people, or account data.

## Before starting

- [ ] Disposable Jira Cloud site created, with a test project and at least one
      issue, one sub-task, one child issue, and a comment.
- [ ] A test account with **Browse projects**, **Create issues**, **Add
      comments**, and **Transition issues** in the test project.
- [ ] An API token for that account, kept out of the repository and out of
      screenshots.
- [ ] A separate OpenChamber profile or data directory. OpenChamber 2.8.0 stores
      one Jira site per tracker, so using the normal profile would require
      replacing the existing connection.
- [ ] Extension installed from the folder or the release ZIP. Record the
      version and the commit or ZIP checksum.

Record the environment once:

| Field | Value |
| --- | --- |
| Jira deployment | Jira Cloud, free plan |
| Site | `https://<test-site>.atlassian.net` |
| Test project | |
| OpenChamber version | 2.8.0 |
| Extension version | 0.3.0 (full run); 0.3.1 (check 11); 0.3.2 (refusals); 0.3.3 (field-name lookup) |
| Date | |

## Checklist

| # | Check | Expected | Result | Notes / evidence |
| --- | --- | --- | --- | --- |
| 1 | Install and approve | The extension appears in Settings → Extensions; the local tracker service and the Jira connection can be approved. | | |
| 2 | Connect | The account card accepts site, Atlassian email, and API token; `serverInfo` and `myself` succeed; the account shows connected. | | |
| 3 | Board tab | The Jira tab lists the test project's issues, most recently updated first. | | |
| 4 | People filters | **Assigned to me**, **Created by me**, and **Anyone** return the expected sets. | | |
| 5 | Project scope | Selecting the test project narrows the list; clearing it widens it again. | | |
| 6 | Search | A summary word, an issue key, and a pasted issue URL each find the issue. | | |
| 7 | Pagination | A query with more than one page returns the next page without duplicates. | | |
| 8 | Issue detail | Summary, status, assignee, priority, project, labels, Markdown description, comments, parent, sub-tasks, and children render. | | |
| 9 | Epic Link | A company-managed Epic Link child appears under its parent; a team-managed epic child appears under its epic. | | |
| 10 | Simple transition | The state pill moves the issue through a transition with no screen; Jira shows the new status. | | |
| 11 | Transition with a screen | The attempt fails with Jira's error naming the required fields; the issue header still opens Jira to finish it. | | |
| 12 | Session comment | With session comments enabled, start or finish a session linked to the issue; the comment is posted as ADF with a working session link and can be read back in Jira. | | |
| 13 | Token revoked | Revoke the API token in Atlassian; the next call fails with 401 and the account needs attention. | | |
| 14 | Recovery | Connect a fresh token; the account recovers without reinstalling the extension. | | |
| 15 | Read-only comments | The issue detail shows comments but no composer; the only user-facing writes are state changes and session comments. | | |

## Screenshots

Capture these against the disposable site, with the test data only:

- [ ] Issues board, Jira tab, with the test project selected.
- [ ] Composer picker, open over a session, with the test issue visible.
- [ ] Issue panel, showing status, description, sub-tasks or children, comments,
      and the state control.
- [ ] Settings → Integrations → Extension accounts, with the test account card.

Use a 1440×900 viewport at 2× scale (the four site images are 2880×1800),
with OpenChamber set to its **light** theme to match the site.
Check every capture for tokens, email addresses, real project keys, and
unrelated sessions before committing it.

Replace all four images together, then remove any "demo data" caption or note
that described the old previews.

## Recording the result

- Add the date, site type, OpenChamber version, and extension version to this
  file (or to the #12 thread).
- For every live-only failure, open an issue in this repository, link it from
  #12, and note whether it is extension-side or an upstream tracker-contract
  gap.
- Keep the checklist in the repository so the next release can repeat it.

## Last run

2026-11-26, OpenChamber 2.8.0 against a disposable Jira Cloud site (folder
install). The test data was one team-managed software project and one
company-managed project for the screen-gated transition. Full evidence is on
[#12](https://github.com/pgquiles/openchamber-jira/issues/12); the four
captures live in `site/assets/screenshots/`.

The 0.3.0 run recorded checks 1–15. After
[#26](https://github.com/pgquiles/openchamber-jira/issues/26), the 0.3.1 build
re-ran check 11:

- Check 11 passed: the transition was refused with HTTP 400 and
  `{"error":"Jira answered 400: Gate check (customfield_10046): Gate check is required.","code":"JIRA_REJECTED"}`.
  The message names the field and keeps its id; the issue stayed In Progress.
  The 0.3.0 run had returned HTTP 500 with the raw id.
- Checks 1–10 and 15 passed (0.3.0).
- Check 12 passed with a caveat (0.3.0): the ADF comment posted once, a second
  start was skipped as `already-posted`, and a non-public origin was skipped.
  The session link itself pointed at a placeholder origin, because the local
  deployment has no public URL.
- Check 13 exposed a gap (0.3.0): a revoked token makes Jira answer the issue
  search with an empty result, so the board goes empty while the account still
  reads connected and valid. The needs-attention state is the upstream
  token-health work in
  [#3](https://github.com/pgquiles/openchamber-jira/issues/3) and
  [openchamber#7648](https://github.com/openchamber/openchamber/issues/7648).
  The 0.3.1 failure mapping keeps a direct 401, but the empty search still
  hides the revocation from the board.
- Check 14 passed (0.3.0): reconnecting with a valid token restored the account
  and the board without reinstalling anything.

After [#3](https://github.com/pgquiles/openchamber-jira/issues/3), the 0.3.2
build re-ran the refusal path on the same site:

- A workflow-state read for a project that does not exist answered HTTP 404 and
  `{"error":"Jira answered 404: No project could be found with key 'NOPE'. The issue or project may be gone, or this account cannot see it.","code":"JIRA_NOT_FOUND"}`.
  A real project answered 200 on the same route, so the copy did not change the
  success path.
- The connect-time no-project refusal and the scoped-401 copy are unit-tested
  only: the demo site has one account with access to a project, and Atlassian
  creates scoped tokens in its web UI, not through the API. The revoked-token
  behavior from check 13 is unchanged: the host still invalidates the account,
  but a revoked token's search returns an empty list rather than a 401.

On 2026-11-27, the 0.3.3 build re-ran the field-name part of check 11 for
[#33](https://github.com/pgquiles/openchamber-jira/issues/33) and corrected the
0.3.1 note above:

- A custom field added only to the Resolve Issue Screen (`customfield_10059`,
  "Fallback probe") stayed out of `/rest/api/3/field` while it was not
  associated with the project's field scheme — absent at 0 s and again at
  45 s, catalog size 89 both times. `/rest/api/3/field/search?query=customfield_10059`
  returned exactly that field, and a search for a non-existent id returned
  none.
- Associating it with the field scheme (the field-scheme API, not the
  deprecated field-configuration one) did not add it to `/field` at once;
  `/field` listed it afterwards (90 fields) and still listed it a minute after
  the required flag was cleared. Requiredness lives in the field scheme, so a
  field a transition screen requires is associated, and an associated field
  reaches `/field`.
- The 400 itself could not be repeated: none of OCT-3's transitions is wired to
  the Resolve Issue Screen any more, so the required field did not fail a
  transition. The 0.3.1 400 above remains the recorded evidence for that error
  path.
- The real bundle connected and moved an issue through Jira with a harness that
  plays OpenChamber's outbound proxy (handle to the site origin, Basic
  credential, method allow-list): `auth.verify` answered 200, and the Done and
  In Progress transitions answered 200.
- Cleanup: the probe field was removed from the screen, unrequired,
  unassociated and deleted; the catalog returned to 89 fields, no probe field
  matched `/field/search`, and OCT-3 was back In Progress.

So `#33`'s fallback does not repair a permanent Jira omission of
transition-only fields; that omission does not exist for a field a transition
can require. It covers an id the *cached* catalog lacks: `/field` is cached for
five minutes, and Jira needs a short time to list a newly associated field.
The 0.3.1 release note and the first version of #33 overstated the case.

## Cleanup

- [ ] Disconnect the test account and remove the extension from the test
      profile.
- [ ] Revoke the test API token.
- [ ] Delete the test project or the disposable site.
- [ ] Keep the captures and the checklist; remove any local token files.
