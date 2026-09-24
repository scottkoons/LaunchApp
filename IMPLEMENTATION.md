# Launch implementation and operations

Launch is Scott’s private task workspace: the familiar Electron-style monthly dashboard on desktop, with phone capture, personal/business separation, back burner, postponement and printable marketing reports. Liquid Display is the iPhone default and follows the system light/dark appearance, with native system typography and translucent navigation. The phone choice is stored in `launch-iphone-theme`; other devices retain `launch-theme` and their Space default. Space, Light, Dark, and all task views remain available. Other appearances use locally served DM Sans, with local Barlow/Bitter retained for secondary styles.

## Architecture

- React 19, TypeScript, vinext/Vite, Cloudflare Workers, D1 records and R2 original attachments; deployed through Sites.
- Sites authenticates the user before forwarding identity headers. Production is owner-private. Every database and file lookup is scoped to that authenticated owner. Do not expose the Worker outside its Sites identity dispatcher.
- IndexedDB holds the device cache, operation queue and pending file blobs. Transactional delta merges preserve saves from multiple tabs. Server operations use IDs and optimistic versions; conflicting fields require review. Sync runs while the app is open, on focus and on reconnect.
- Repeating tasks retain their original anchor and separate occurrence history. Only planned months produce future instances; the dashboard applies its own rolling window. Calendar, flat list and report ranges can reach later plans.
- The dashboard lists Postponed above On your radar. Shared drag handles move tasks between months and Postponed; floating drop targets avoid long scrolls. Postponing preserves deadlines. A month drop resumes the occurrence, moves its draft/final deadline gap together (clamping the final day to the target month), and keeps pins, report settings and recurrence identity. Command-Z reverses the whole move. Review/publication dates remain unchanged unless review is the only deadline.
- New business tasks default into reports. Explicit exclusions and recurring-series defaults survive sync. Personal content is excluded unless the user explicitly selects the personal-task option for that report.
- Printing generates a PDF locally, previews every page, then offers Print or Download. Report pages are portrait; calendars support one landscape month or two stacked portrait months. Saving a report online is optional and creates an immutable snapshot.
- ZIP backup includes records and original attachments. Restore is additive: existing IDs are not overwritten. It is an import/recovery tool, not an automatic historical rollback.

## Reproducible local checks

Use Node 22.13 or later and `npm ci` with the committed lockfile.

```sh
npm run check
npm run test:pdf
npm audit --audit-level=low
npm run build
```

`check` runs strict TypeScript (including unused locals/parameters), full application/UI lint, formatting, dependency/dead-code analysis and model/store tests. `test:pdf` writes long-note/crowded-calendar fixtures under ignored `outputs/` and verifies orientation.

For API integration checks, apply `drizzle/*.sql` to local D1 using `wrangler.local.json`, run `npm run dev`, then `npm run test:api` in another terminal. Tests default to `http://localhost:3000` and create local fixtures. **Never point them at production.** Local sign-in is supplied by the Sites development plugin.

`npm run db:generate` validates migration generation. The scoped esbuild override patches an advisory in the legacy Drizzle development-tool chain; migration generation was verified with this override. Do not run `npm audit fix --force` without checking proposed breaking changes.

## Release and recovery

1. Run the checks above; inspect browser workflows and the QA acceptance list.
2. Commit the validated source, push it to the configured Sites source repository and build from that exact commit.
3. Package with the Sites `package-site.sh` helper, save the version and deploy to the existing owner-private audience.
4. Verify the live dashboard and a report preview. Keep the previous successful version available for a code rollback.
5. A code rollback does not restore database history. Take a Launch backup before intentional bulk data changes. No schema or destructive production-data changes were required for the September 8 QA release.

The source ZIP excludes `.env*`, local databases, caches, uploaded documents and test output. It includes the source, lockfile, tests, migrations and this runbook. Runtime storage and identity remain hosted services.

## Product boundaries and device acceptance

- Phone dictation uses the iPhone keyboard microphone; desktop dictation can use Wispr Flow. No custom recording/transcription service is required.
- The offline shell supports saved task viewing and note/photo capture. It must have been opened online once. Device storage can be cleared or evicted by the browser; unsynced work has not reached the server.
- Closed-app/background upload, actual iPhone camera/keyboard behavior, installation and printer hardware need acceptance on Scott’s devices. Browser emulation cannot certify those capabilities.
- Apple/Google calendar handoff is currently an ICS copy, not automatic two-way sync.
- Outlook handoff opens a compose request. Attachments and final sending remain user-controlled.
- WebMCP capture is feature-detected and optional; it was not exercised by this QA environment.
- Very large histories and PDF previews still use device memory. The app suits a single user’s task/report workflow; it has not been load-tested as a multi-user service.

## Migration

`scripts/import-mission-control.py` reads the original SQLite database without modifying it, takes a consistent WAL-aware snapshot, and creates a Launch backup with available original attachments. Stable IDs make repeated imports additive. Original records remain in legacy metadata. The two identified business routines (reviews and DoorDash/UberEats) use Business/report-off rather than the old Personal flag. Keep migrated data outside the source repository.
