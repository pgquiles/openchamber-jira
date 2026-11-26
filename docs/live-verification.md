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

Use a 1440×900 viewport at 2× scale (the current site images are 2880×1800 and
similar). Check every capture for tokens, email addresses, real project keys,
and unrelated sessions before committing it.

When all four images are replaced, remove the "preview with demo data" caption
and the demo-note paragraph from `site/index.html`, and remove the #12 item from
the roadmap sections.

## Recording the result

- Add the date, site type, OpenChamber version, and extension version to this
  file (or to the #12 thread).
- For every live-only failure, open an issue in this repository, link it from
  #12, and note whether it is extension-side or an upstream tracker-contract
  gap.
- Keep the checklist in the repository so the next release can repeat it.

## Cleanup

- [ ] Disconnect the test account and remove the extension from the test
      profile.
- [ ] Revoke the test API token.
- [ ] Delete the test project or the disposable site.
- [ ] Keep the captures and the checklist; remove any local token files.
