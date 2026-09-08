# Launch production QA — September 8, 2026

## Scope and conclusion

Reviewed application, API, offline storage, recurrence, reports, file handling, dependencies, UI primitives, formatting and production output. This report records evidence rather than a guarantee that all bugs have been found. Physical iPhone and printer acceptance remain separate from automated/browser checks.

No known unresolved P0 or P1 issue remains in the paths tested in this pass. The changes preserve the existing dashboard layout and single-user workflow.

## Findings addressed

| Severity | Finding                                                                                          | Resolution / evidence                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Two tabs could overwrite each other’s offline queues and pending photos.                         | One IndexedDB write transaction merges each writer’s changes; regression covers independent notes/photos, disjoint edits, restart and eventual sync.     |
| P1       | Long-running recurrence stopped at historical generation caps.                                   | Iterate from the requested period while preserving original weekly/month-end/quarterly anchors; old-anchor regression tests.                             |
| P1       | Invalid repeat weekdays, anchors or monthly-note structures could break generation.              | Validate nested repeat values, dates and note entries; reject invalid input.                                                                             |
| P2       | A second sync caller returned before the active sync completed.                                  | Callers share the active promise; concurrent-call regression.                                                                                            |
| P2       | Rapid capture/save actions or pending file selection could duplicate a save or omit attachments. | Save guards, disabled controls during saves and file staging, isolated account/workspace draft keys.                                                     |
| P2       | Offline fallback used separate read/write transactions and accepted duplicate save clicks.       | Atomic append, save guard, storage error handling and updated service-worker cache.                                                                      |
| P2       | Explicitly opted-in personal report snapshots could not be restored from backup.                 | Restore validates the snapshot’s explicit report option; API regression checks accepted and rejected cases.                                              |
| P2       | Events crossing a month boundary could disappear from report calendars.                          | Include overlapping events and render every covered day; regression test.                                                                                |
| P2       | Space/Light theme controls had insufficient text contrast.                                       | Adjusted foregrounds and Light accent; automated scans repeated after transitions settle.                                                                |
| P2       | Four moderate development dependency advisories.                                                 | Scoped patched esbuild resolution; full/runtime dependency audits and migration generation checks.                                                       |
| P3       | Unused starter components, exports and packages obscured the actual app.                         | Removed 53 unreachable files, unused component functions/exports and eight direct dependencies; strict unused checks and Knip retained as release gates. |
| P3       | PDF generation code loaded with the dashboard.                                                   | Lazy-load report tools; production build emits separate report/PDF chunks.                                                                               |
| P3       | UI primitives were omitted from lint; several configuration/offline files were unformatted.      | Expanded lint to all retained code and formatted all matched files.                                                                                      |
| P3       | Backup requests could wait indefinitely.                                                         | Added bounded network timeouts to backup/restore requests.                                                                                               |

## Release gates

- Strict TypeScript, all retained source/UI lint, formatting and dead-code checks.
- 37 model/store regression tests.
- 4 API integration tests, including auth, owner-scoped files, idempotency, conflicts, report defaults, restore and malformed requests.
- PDF fixtures with long notes and crowded calendars: one-month layout has only landscape calendar pages; two-month layout stays portrait.
- Full and production-only dependency audits: zero reported vulnerabilities at audit time.
- Migration generation: no schema change required.
- Production build and archive verification.
- Browser checks: business task report default, invalid deadline rejection, successful save, delayed completion, Command-Z restore, pinning, PDF page preview, phone-sized capture and workspace draft separation. Offline capture with a photo also survived reconnect and synced successfully.
- Automated axe scans after theme transitions: zero detected violations on the checked Space, Light and Dark dashboard states; zero on the 390 × 844 capture screen, with no horizontal overflow.
- PDF preview rendered eight pages and exposed Print; generated fixtures verified eight pages with two landscape calendar pages, and seven portrait pages for the stacked two-month option.

## Interface review

Scores describe this bounded review; they are not WCAG certification or a field-performance benchmark.

| Dimension           | Score / 4 | Assessment                                                                                                              |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| Accessibility       | 3         | Keyboard workflows, labels and automated WCAG scans; screen-reader and real-device checks remain.                       |
| Performance         | 3         | Fewer dependencies, lazy report loading and batched recurrence inserts; very large history/PDF load is not benchmarked. |
| Theming             | 3         | Space, Dark and Light preserve the requested design; contrast fixes and shared tokens.                                  |
| Responsive behavior | 3         | Phone capture checked at 390 × 844; physical iPhone/keyboard/camera still require acceptance.                           |
| Visual consistency  | 4         | Original monthly task layout, date pills, icon navigation and Launch identity retained.                                 |

**16/20 — Good.** This is a functional production release with explicit device acceptance boundaries, not a claim of perfect software.

## Remaining acceptance / operational limits

- **P2, device acceptance:** install on Scott’s actual iPhone; dictate with the keyboard microphone, take a camera photo, disable connectivity, capture, reopen online and confirm desktop sync.
- **P2, printer acceptance:** print both calendar arrangements on the actual printer; verify mixed orientation and paper settings. Browser PDF generation/preview and page dimensions are checked separately.
- **P3, scale:** histories are retained and full record snapshots sync while open. Very large attachment backups/PDFs can consume substantial browser memory; no enterprise-scale load test was performed.
- **P3, optional integrations:** ICS is a calendar copy, Outlook is a compose handoff, and optional WebMCP was not exercised. These are documented product boundaries.

Test fixtures use local development storage only. Production source archives contain no task database, private attachments or environment credentials. See `IMPLEMENTATION.md` for repeatable checks, deployment and recovery steps.
