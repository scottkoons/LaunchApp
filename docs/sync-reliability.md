# Sync reliability

## Model

Launch is a single-user app used on an iPhone and a Mac. The cloud (D1 and R2
behind the Worker) holds the shared copy. Each device saves changes locally
first (IndexedDB), queues them as operations (`patch` plus the `base` values
the change started from), and syncs on open, focus, reconnect and every 15
seconds while open. Every sync pass sends queued operations, then pulls the
latest cloud copy.

## Merging and conflicts

`mergePatch` in `lib/model.ts` merges each queued operation into the cloud
record field by field (three-way: base, this device, cloud):

- **Fields this change did not modify are never overwritten.** A device with
  an older copy therefore never conflicts on fields it did not touch.
- **Missing and empty are the same state.** A missing value, `''`, `null`,
  `false`, `[]` and `{}` compare equal. The exception is
  `includeNotesInReport`, where missing means true. Object key order is
  ignored.
- **A conflict** is reported only when the same field was changed on both
  devices, from the same starting value, to different values.
- **Lists and maps merge.** `files` and `excludedDates` merge as sets.
  `monthlyNotes` and `fileLabels` merge per entry and conflict only on the same
  entry.
- **Same action on both devices.** When both devices completed, trashed or
  dismissed a reminder, the first recorded time stands and there is no
  conflict (`completedAt`, `deletedAt`, `reminderAcknowledgedAt`).
- **Display order** (`order`) is last-writer-wins.
- **A replayed creation** of a record that already exists only fills empty
  fields.

The same merge (`pendingFields`) decides how a device shows its own pending
changes over an incoming record, so the phone shows what the cloud will hold.

A genuine conflict stores the cloud version and the other device's values on
the operation:

- It is not resent every pass. It is re-checked when the cloud copy changes,
  since the other device may have settled it.
- **Review sync** explains it in plain language (`lib/sync-status.ts`), for
  example "This task was marked complete on your other device."
- "Keep this device's version" re-bases only the conflicting fields.
- "Use the other device's version" drops only the conflicting changes.

## Attachments

Record changes and a refresh run before attachment uploads. A failed attachment
stays queued on its original device and no longer prevents unrelated completions
or deletions from reaching other devices. Operations that reference pending files,
and later operations for that same record, wait for those files. After uploading,
sync sends newly eligible records and refreshes again.
If a record changes during an upload, sync interrupts that upload to send the
change promptly. The original bytes and file ID remain queued for a safe retry.

Incoming records supply the current server fields; only queued fields overlay
them. A conflicting title or note no longer hides a completion or deletion made
elsewhere. Stale creation replay cannot visually clear completion, archive, or
trash state. Explicit undo/restore operations based on that state still work.
Pending edits remain available for conflict review rather than being discarded.
Late refreshes and replayed acknowledgements cannot replace a newer confirmed
record version. Permanent-deletion tombstones still remove the record entirely.

Version-race responses without named field conflicts retry the same operation ID
up to three times. Old generic `Record` conflicts retry too. Named conflicts are
saved on the current queue entry, including when another operation's persistence
has replaced the in-memory objects. One record's conflict does not block others.

Changes queued during a refresh get another immediate pass, bounded to three
passes. Returning to a visible page, focus, page restoration, reconnecting, and
the existing 15-second timer all trigger sync. Status says Syncing changes while
requests run, and All changes synced only after an error-free refresh with no
queued operations or uploads. Keep Launch open until that confirmation before
expecting another device to reflect a just-made change.

`tests/sync.test.ts` exercises two independent device caches against one server,
blocked uploads, saved originals after restart, completion/deletion conflicts,
stale creation replay, deliberate restores, old and new version races, and edits
made during an in-flight refresh, including refreshes older than a successful
write acknowledgement. The store and trash suites cover shared tabs,
permanent-deletion replay protection, conflict resolution, and Undo.

After a build, run the packaged Worker locally with
`npx wrangler dev --config dist/server/wrangler.json --port 8787 --persist-to .wrangler/state`,
then `npm run test:sync:api`. This uses two independent IndexedDB caches and a
fresh local account against the actual D1-backed API, checking completion,
deletion, conflicting edits, reconnect, restart, and deliberate restoration.

An attachment whose saved bytes cannot be read back from device storage
(`UnreadableAttachmentError`: a read error, a missing blob, or a size mismatch)
is retried on the next two passes, then marked with a `problem` and stops
retrying:

- **What it affects.** It does not set the global sync error and does not
  block unrelated items. Review sync names the file and the items it belongs
  to.
- **What the user can do.** "Try again" retries it, and Launch also retries
  once each time it opens. "Remove attachment" removes only that file's
  reference; the item and every other change keep syncing.
- **Server refusals.** The server refusing an upload is retried the same way,
  because Safari can send an empty upload. A "too large" refusal stops
  immediately.
- **Connection trouble.** Network failures never mark an upload as a problem.

## Status

The sync indicator (`SyncState` in `lib/client-store.ts`) is one of:

| State      | Meaning                                                               |
| ---------- | --------------------------------------------------------------------- |
| connecting | Before the first sync.                                                |
| offline    | Offline, or Launch cannot be reached; everything retries by itself.   |
| syncing    | A sync pass is running.                                               |
| pending    | Changes or attachments are waiting to send.                           |
| synced     | "All changes synced".                                                 |
| conflict   | A genuine conflict needs a choice.                                    |
| attachment | An attachment could not be uploaded.                                  |
| error      | Sign-in is needed, or the server refused a change; the item is named. |

Only conflict, attachment and error show the "Review sync" banner.

## Tests

`tests/sync-devices.test.ts` runs two device stores (Mac and iPhone) through
every required scenario against a fake server that applies the real merge.
The second test in `tests/sync-api.test.ts` repeats them against the packaged
Worker.

These checks validate the synchronization paths with controlled connections;
they cannot inspect unsent data still held on a user's physical phone.
