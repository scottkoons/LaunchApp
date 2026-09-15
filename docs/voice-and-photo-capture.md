# Voice and photo capture

Capture now records up to three minutes of audio, extracts text from photos,
and follows directions to create notes, tasks, and agenda items. Records use
the currently selected Business or Personal workspace.

## Connection

`OPENAI_API_KEY` belongs in the ignored `.env.local` file for local development.
The production Worker needs the same environment variable configured as a
server secret before publishing this feature. Never put the key in a `VITE_`
variable, source code, hosting JSON, or a browser setting. Local configuration
does not configure the deployed site.

The authenticated `/api/capture` route calls `gpt-4o-mini-transcribe` for audio
and `gpt-4.1-mini` for vision and structured interpretation. Requests carry only
the selected capture, its instructions, and its capture time/zone. Unrelated
records and contacts are not sent. Provider Responses use `store: false`.
Processing is limited to 60 requests per account per hour and 12 MB per input.

## Saving and recovery

- Originals are saved through the existing offline file/note store before AI
  processing. Transcripts are saved before interpretation. Processing failures
  leave the capture available to retry.
- Offline captures show **Process**. Reconnect and open Capture to process them.
  Keep the app open during recording; browser suspension can interrupt audio.
- Relative dates use the time zone and instant when the capture was made.
  A single task deadline uses Final. A date alone does not invent a timed reminder.
- Say “remind me,” “set an alarm,” “notify me,” or “alert me” with a date/time
  or duration. “In half an hour” and “in an hour and a half” use elapsed minutes
  from the recording's start, preserving seconds and daylight-saving transitions.
  Processing later does not move the trigger. Past triggers stay available for
  correction instead of silently scheduling a different time.
- A reminder-only capture has a planned day, without a false deadline. An explicit
  task deadline remains in Final even if its reminder is earlier. The saved
  capture shows the reminder's local date/time and zone and offers Edit and Undo.
  Missing times and unsupported location/event/repeating triggers ask for
  clarification. Alerts appear inside Launch. Background phone alerts require
  a connected reminder service and Phone alerts enabled in Settings on the
  receiving device. See [phone alerts](phone-alerts.md) for service setup.
- Unclear instructions wait for correction. Photo text is source material;
  without separate instructions it becomes a literal note. New records only are
  supported; the interpreter cannot send messages or modify existing records.
- Agenda notes use one plain-text point per line. Existing agenda rendering
  displays these as bullets under the title.
- Undo compares content fingerprints so server timestamps do not block it.
  Subsequent edits block Undo to preserve changed records. Originals are retained
  in Completed notes after conversion; recordings remain playable attachments.

## Verification

Attachment uploads and transcription requests materialize a fresh in-memory
Blob before building multipart data. This works around
[WebKit bug 319985](https://bugs.webkit.org/show_bug.cgi?id=319985), where a
disk-backed File restored from IndexedDB can send a zero-byte request on iOS.
The September 14 production logs showed repeated zero-length `/api/files`
requests returning 400, while nearby transcription requests succeeded.
Uploads retain their original IDs and queued data until acknowledged, so
pending recordings retry after the update without creating duplicates.
Byte-length checks stop incomplete reads before sending; tests cover binary
multipart contents, filenames, MIME types, and uploading after an offline
restart. A physical iPhone retry is still needed to confirm recovery there.

Audio playback separately requires [HTTP byte-range support on iPhone](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/CreatingVideoforSafarioniPhone/CreatingVideoforSafarioniPhone.html).
Private file responses now serve bounded, open-ended, and suffix ranges with
206, Content-Range and the exact Content-Length; HEAD omits the body and invalid
offsets return 416. Authentication and permanent-deletion checks apply first.
Pending recordings play from a fresh memory-backed Blob, then switch to the
uploaded file when sync finishes. Playback failures offer Reload recording;
they do not discard the transcript or prevent reminder clarification. The
file playback API test verifies actual response bytes and authentication,
and the offline-restart test verifies the separate playback Blob.
`worker.ts` preserves the length at the final response boundary using
Cloudflare's FixedLengthStream; framework wrappers can otherwise turn the
recording into a chunked transfer even when the route specifies its length.
After building, run `npx wrangler dev --config dist/server/wrangler.json --port 8787 --persist-to .wrangler/state`,
then `npm run test:playback`. This test uses only local fixtures and refuses
non-local URLs. Physical iPhone playback still needs a device check.

`npm run check` covers validation, dates/DST, untrusted photo instructions,
provider failures, offline storage, operation replay, idempotency, and Undo.
Live synthetic voice and image requests and the browser capture flow were
verified locally, including permission denial, offline/reload recovery, and a
390-pixel phone viewport. Physical iPhone microphone behavior still needs a
device check after deployment.

## Personal checklist and due times

Personal To-Dos combines existing tasks and notes without migrating or deleting records. New Personal captures are notes with optional due and reminder fields. Converted source captures remain stored but are omitted from the checklist to avoid displaying the same action twice. Completion is shared across the checklist, capture, and reminder alert.

The phone navigation has three destinations: Capture in the current workspace, Today in Business, and To-Dos in Personal.

Timed actions store `dueAt` and `dueZone` separately from `reminderAt` and `reminderZone`. Capture plans can include `dueLocal` as well as a date. Explicit reminder times are retained even when later than the due time. Relative advance warnings use the due time; conflicting instructions should request clarification. The visible reminder shows remaining or elapsed minutes. Background phone alerts use the same saved reminder time after the service and receiving device are connected.
