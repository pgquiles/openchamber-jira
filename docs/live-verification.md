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
| Extension version | 0.3.0 |
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

Use a 1440×900 viewport at 2× scale (the four site images are 2880×1800).
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

2026-11-26, OpenChamber 2.8.0 with extension 0.3.0 (folder install) against a
disposable Jira Cloud site. The test data was one team-managed software project
and one company-managed project for the screen-gated transition. Full evidence
is on [#12](https://github.com/pgquiles/openchamber-jira/issues/12); the four
captures live in `site/assets/screenshots/`.

- Checks 1–10 and 15 passed.
- Check 11 passed with a caveat: Jira rejected the transition as expected, but
  the message names the required field by its custom-field id
  (`customfield_10046`) and the host reports HTTP 500 rather than Jira's 400.
  Tracked in [#26](https://github.com/pgquiles/openchamber-jira/issues/26).
- Check 12 passed with a caveat: the ADF comment posted once, a second start
  was skipped as `already-posted`, and a non-public origin was skipped. The
  session link itself pointed at a placeholder origin, because the local
  deployment has no public URL.
- Check 13 exposed a gap: a revoked token makes Jira answer the issue search
  with an empty result, so the board goes empty while the account still reads
  connected and valid. The needs-attention state is the upstream token-health
  work in [#3](https://github.com/pgquiles/openchamber-jira/issues/3) and
  [openchamber#7648](https://github.com/openchamber/openchamber/issues/7648).
  Check 14 passed: reconnecting with a valid token restored the account and
  the board without reinstalling anything.

## Cleanup

- [ ] Disconnect the test account and remove the extension from the test
      profile.
- [ ] Revoke the test API token.
- [ ] Delete the test project or the disposable site.
- [ ] Keep the captures and the checklist; remove any local token files.
