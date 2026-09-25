# Changelog

Notable changes to Launch, newest first. Each entry lists what changed, why, and where, so a person or coding agent can pick up the context without rereading the code.

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

- **Streaming body limits** (`lib/body-limit.ts`). Request bodies are counted while they stream, so a chunked upload with no `Content-Length` cannot exhaust Worker memory. Every upload and JSON route uses `limitedBody`, `limitedForm` or `limitedText`. Import now returns 413 for an oversized batch.
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
- `npm test`: 142 of 142 pass. The production build and live API tests (`test:api`, `test:sync:api`) were not run.

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
