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
- Unclear instructions wait for correction. Photo text is source material;
  without separate instructions it becomes a literal note. New records only are
  supported; the interpreter cannot send messages or modify existing records.
- Agenda notes use one plain-text point per line. Existing agenda rendering
  displays these as bullets under the title.
- Undo compares content fingerprints so server timestamps do not block it.
  Subsequent edits block Undo to preserve changed records. Originals are retained
  in Completed notes after conversion; recordings remain playable attachments.

## Verification

`npm run check` covers validation, dates/DST, untrusted photo instructions,
provider failures, offline storage, operation replay, idempotency, and Undo.
Live synthetic voice and image requests and the browser capture flow were
verified locally, including permission denial, offline/reload recovery, and a
390-pixel phone viewport. Physical iPhone microphone behavior still needs a
device check after deployment.
