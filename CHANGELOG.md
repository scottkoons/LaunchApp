# Changelog

Notable changes to Launch, newest first. Each entry lists what changed, why, and where, so a person or coding agent can pick up the context without rereading the code.

## 2026-09-25: Full read and write connector for agents (Grok Bot)

Branch `claude/launch-mcp-crud`, stacked on the sync branch (pull request #2). The Launch MCP connector (`/api/mcp`) was create-only (`get_launch_context`, `add_task`, `add_note`, `add_agenda_item`), so agents could not answer "what is due today", "what is overdue" or "what is in yellow", or change or remove anything.

### Added

- **Read tools** (`lib/agent-crud.ts`):
  - `list_tasks`, `list_notes`, `list_agenda_items`, `get_item` and `search_items`.
  - They cover workspace, status, date, overdue, color and urgency, and text filters, and page with `limit` (default 50) and `next_cursor`.
  - Every item has one shape (id, type, version, status, dates, reminder, trash state, timestamps and a `url` deep link).
- **Write tools:**
  - `update_task`, `update_note` and `update_agenda_item` change only the fields passed and return the saved item.
  - `delete_item` moves an item to Trash; `restore_item` brings it back. Permanent deletion stays manual in Launch.
  - Writes use sync validation, the optimistic version check (`expected_version` refuses stale changes) and an atomic revocation check.
- **Colors:** `color` and `urgency` match the Launch UI exactly: red overdue, yellow soon (within the `soonDays` setting, default 2), blue future, green done, gray postponed.
- **Context:** `get_launch_context` also returns counts for due today, overdue and each color, plus the color legend.
- **Create results:** `add_task`, `add_note` and `add_agenda_item` receipts now include the full `item`.
- **Error shape:** every tool error is `{"error":{"code","message"}}` with the codes `not_found`, `validation`, `conflict` and `unavailable`.
- **Deep links:** Launch opens `/?item=<id>` (as it already did `?reminder=`) in `app/launch.tsx`.
- **Docs:** `docs/agent-connection.md` documents every tool, field and color; `docs/grok-bot-setup.md` lists the new tools.

### Tests

- `tests/agent-mcp.test.ts` gains an end-to-end MCP client test over the real migration schema. It covers counts; today, overdue, yellow and this-week queries; paging; owner isolation; notes, agenda and search; mark done, due date and time changes, and moving to personal; a stale `expected_version`; reminder set and clear; note and agenda updates; error codes; trash and restore without removing the row; the full item on create; and writes refused after disconnect.

### Known and not changed

- **Repeating tasks:** reads return stored records. Future occurrences of repeating tasks appear after Launch plans them during its normal sync.
- **Tags and projects:** Launch has no tags or projects, so none are exposed.
- **Grok Bot discovery:** after deploying, refresh or reconnect the Launch connector in Grok Bot so it discovers the new tools.

## 2026-09-25: Reliable cross-device sync

Goal: the cloud is the shared copy, a change on either device reaches the other automatically, and Scott only sees a conflict when the same field of the same item really was changed on both devices before either heard about the other. Design notes are in `docs/sync-reliability.md`.

### Root causes found

- **Missing versus empty values.** `mergePatch` compared fields with `JSON.stringify`, so a field that was never set (`undefined`) and the same field written as `''`, `null`, `false` or `[]` (by undo, restore, migrations or defaults) looked like two different edits. A device with an older copy then raised false conflicts, most visibly on `completedAt`.
- **The same action on both devices.** Completing, trashing or dismissing a reminder on both devices recorded two timestamps and was reported as a conflict.
- **Whole-field lists and maps.** `files` and `monthlyNotes` (and `fileLabels`) were compared as a single value, so adding different attachments, or editing different months' notes, on two devices always conflicted. Applying one side could also overwrite the other month's note.
- **Conflicts never cleared.** A flagged change stayed until resolved by hand, even after the other device settled it.
- **"Keep this version" replaced the whole base.** It re-based every field on the server copy, which could overwrite the other device's newer values for fields this device did not change, and for list and map fields.
- **One unreadable attachment made the app look permanently unsynced.** A saved original that iPhone storage could no longer read (`The saved attachment could not be read`) retried on every pass and wrote into the single global sync error. That error outranked every other status and also blocked backups, saving reports online and permanent deletion.
- **Internal field names in the UI** ("Another device changed completedAt, status").

### Behavior changes

- **Field-level three-way merge** (`lib/model.ts`, `mergePatch` and the shared `mergeFields`):
  - A field conflicts only when both devices changed it from the same starting value to different values.
  - Missing and empty values are the same state; `includeNotesInReport` is the one field where missing means true.
  - Object comparison ignores key order.
  - `files` and `excludedDates` merge as sets, so additions and removals from both devices combine.
  - `monthlyNotes` and `fileLabels` merge per entry and conflict only on the same entry.
  - `completedAt`, `deletedAt` and `reminderAcknowledgedAt` keep the first recorded time when both devices took the same action.
  - `order` is last-writer-wins.
  - A replayed creation only fills empty fields and never undoes later changes.
  - Fields a change did not modify are never overwritten.
- **Local display uses the same merge.** `pendingRecord` (`lib/sync-records.ts`) overlays only fields this device actually changed, combined the way the server will combine them. The existing protections are unchanged.
- **Conflicts re-check themselves** (`lib/client-store.ts`, `pushChanges`):
  - Each conflict saves the server version and the other device's values.
  - It is not resent every pass. It is checked again once the server copy changes, and conflicts saved by the previous version of Launch are re-checked once.
  - Conflicts the new merge no longer considers conflicts clear without any prompt.
- **Safer resolution** (`keepMine` and `takeTheirs` in `lib/model.ts`):
  - "Keep this device's version" re-bases only the conflicting fields, and keeps map entries only this device changed.
  - "Use the other device's version" drops only the conflicting changes. The rest of the same edit, and later queued edits to the item, still sync.
- **Attachment recovery** (`lib/client-store.ts`, `lib/upload-blob.ts`):
  - A read failure raises `UnreadableAttachmentError`, distinct from network trouble. A missing blob is treated the same way.
  - After three failed reads, or a "too large" refusal, the upload stops retrying and is marked with a plain-language `problem`. Other server refusals are retried, because Safari can send an empty upload.
  - A stopped upload gets one more attempt each time Launch opens, or on "Try again".
  - "Remove attachment" removes only that file's reference, from queued changes, local records and (when needed) the server copy. The item and every other change are kept.
  - One bad attachment no longer sets the global error or blocks unrelated items.
- **Sync status** (`SyncState` in `lib/client-store.ts`) distinguishes connecting, offline, syncing, pending, synced, conflict, attachment and error:
  - Only conflict, attachment and error show the "Review sync" banner.
  - Timeouts, network failures, 5xx replies and non-JSON replies are quiet connection trouble ("Can't reach Launch · saved on this device"), retried automatically.
  - A change the server refuses names the item.
  - Waiting attachments are described as attachments.
- **Plain-language review UI** (`lib/sync-status.ts`, `app/launch.tsx`):
  - Conflicts read like "This task was marked complete on your other device." or "It was renamed “…” on your other device."
  - An attachment problem names the file and the items it belongs to, with Try again and Remove attachment actions.
  - Buttons read "Keep this device's version" and "Use the other device's version".
  - The upload hint appears only while something is uploading.
- **Pending-work checks** use `store.unsyncedReason()` for backup, saving a report online and permanent deletion, which explains what to fix.

### Tests

- `tests/sync-devices.test.ts` (new, in `npm test`) runs two independent device stores through a fake server that applies the real merge, validation, versions and receipts. It covers create, edit and edit back; completion and deletion in both directions and on both devices at once; a stale completion after a reopen; stale edits to different fields, attachments and month notes; genuine same-field conflicts, their wording and both resolutions; a conflict that clears itself; offline edit then reconnect; attachment upload; unreadable and missing attachments, including recovery and the startup retry; reminder fields; and old saved conflicts.
  - Against the previous merge, tests 4, 4b, 5, 6 and the saved-conflict re-check fail. They pass with this change.
- `tests/sync-api.test.ts` gains a second test running the same Mac and iPhone scenarios against the real Worker with local D1 and R2, including attachments, an unreadable attachment and reminders.
- `tests/store.test.ts`: a timeout now reports the quiet `offline` state instead of an error.

### Known and not changed

- **Attachments on the same item wait together.** A good attachment added in the same change as a bad one uploads, but its reference on that item waits until the bad one is removed. Other items are unaffected.
- **Settings records.** A device that saves a setting before its first sync can create a second settings record, because settings use a random ID.
- **Banner styling.** The "Review sync" banner text has low contrast in the dark theme; its styling was not changed here.

## 2026-09-25: Code review fixes

Branch `claude/codebase-review-wzqyia`, pull request #1. A full review found no cross-account data exposure; the fixes below address offline data safety, time zones, error handling and request limits.

### Data safety

- **Offline edits could be lost** (`lib/client-store.ts`, `persist()`). The saved snapshot advanced before the IndexedDB write finished, so a failed write (for example, full device storage) was treated as saved by the next write and dropped. The snapshot now advances only after the write succeeds.
- **"Discard mine" removed too much** (`lib/client-store.ts`, `resolve()`). Discarding one conflict dropped every queued change for that item, including unrelated edits such as a new attachment. Only the conflicting fields are discarded now.
- **Sync receipt was not atomic** (`app/api/sync/route.ts`). The record write and its idempotency receipt now run in one D1 batch, and the receipt is stored only when that exact record body was written.
- **Orphaned R2 files** (`app/api/files/route.ts`, `app/api/reports/[id]/pdf/route.ts`, `keepStoredFile()` in `lib/server.ts`). When the row insert is skipped because the ID was permanently deleted, the stored object is removed and the route returns 410.

### Correctness

- **Server dates use Denver, not UTC** (`zonedDay()` in `lib/model.ts`). Workers run in UTC, so evening requests used tomorrow's date. Report status dates and recurrence planning now use America/Denver. `makeReport()` takes an optional `today` argument.
- **Fall-back reminder times** (`reminderInstant()` in `lib/capture-intent.ts`). A time that occurs twice at the November clock change resolves to its first occurrence instead of being rejected, matching the reminder picker. Skipped spring-forward times are still rejected.
- **Error responses** (`failure()` in `lib/server.ts`). Storage and runtime faults return 500 with a generic message and are logged. Parser errors from malformed requests return a generic 400. Intentional validation messages still return 400 as before.

### Hardening and user experience

- **Streaming body limits** (`lib/body-limit.ts`). Request bodies are counted while they stream, so a chunked upload with no `Content-Length` cannot exhaust Worker memory. Every upload and JSON route uses `limitedBody`, `limitedForm` or `limitedText`. An oversized body is drained, not cancelled, because cancelling midway broke the next request on the local Workers runtime. Import now returns 413 for an oversized batch.
- **Keyboard shortcuts** (`app/launch.tsx`). "n" ignores Cmd, Ctrl and Alt and does nothing while a dialog is open. Ctrl/Cmd+T is intercepted only when a task will be added.
- **Notification taps** (`public/sw.js`). Only controlled windows are navigated; otherwise a new window opens. Shell cache bumped to `launch-shell-v24`.
- **Safe storage and error boundary** (`lib/local-storage.ts`, `app/error.tsx`). `localStorage` access goes through `readLocal`, `writeLocal` and `removeLocal`, which never throw. A new app error boundary offers Try again and Reload.
- **Smaller fixes:**
  - Import counts only rows actually inserted (returns `imported` and `skipped`) and requires string IDs.
  - Phone alert text names the day when it differs from the alert day.
  - The reference import size message is accurate.
  - `scripts/import-mission-control.py` no longer crashes on a recurring root with no due date.

### Tests

- `tests/review-fixes.test.ts` adds regression tests for the lost save, discard mine, Denver dates and streaming limits. The first two fail on the previous code.
- `tests/capture.test.ts` now expects the first occurrence for 1:30am on 2026-11-01.
- `npm test`: 142 of 142 pass.
- `npm run build` succeeds. The live suites `test:api` (7 of 7), `test:sync:api` and `test:playback` pass against local D1 and the built Worker.
- Manual checks on the built Worker: malformed JSON returns 400 `Invalid request.`; 23 MB chunked and declared uploads return 413, and the next upload still succeeds; a 15 MB upload is accepted.

### Known and not changed

- `public/offline.js` reuses the last account after sign out. The app has no sign-out control and has one user.
- Sign-in trusts the Sites identity headers. The Worker must never be reachable outside the Sites gateway.
- `app/api/agent-connections` returns a site-wide gateway token. This is acceptable only while the site has one user.

### Suggested next work

1. Split `app/launch.tsx` (about 2,400 lines) into view components and hooks.
2. Split `app/globals.css` (about 6,800 lines) by feature and remove unused rules.
3. Move records, the sync queue and pending uploads into separate IndexedDB stores.
4. Add an indexed reminder time column and incremental sync instead of scanning every record.
5. Prune old `operations` rows on a schedule.
6. Add React hooks and accessibility lint rules, and validate every route's input with zod.
7. Upgrade `wrangler` and `@cloudflare/vite-plugin` to clear the development-only `sharp` audit advisories.
