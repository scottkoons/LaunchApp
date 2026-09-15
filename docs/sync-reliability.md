# Sync reliability

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

These checks validate the synchronization paths with controlled connections;
they cannot inspect unsent data still held on a user's physical phone.
