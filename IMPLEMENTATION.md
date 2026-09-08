# Launch implementation

Private, single-editor web app built from Scott’s agreed workflow. Brand: retro rocket; Space, Dark, and Light themes. Typography: Bitter + Barlow, locally served.

## Included

- Account-scoped D1 records and R2 attachments, private Sites access and server-side authentication.
- Offline outbox, local draft recovery, file retry, idempotent operations, and explicit conflict review; 15-second refresh while open.
- Task list by month, flat list, calendar, manual reordering and column sorting; independent milestones; completion history and Trash.
- Back burner and postponed tasks with original deadlines retained.
- Weekly weekday selection, monthly and quarterly recurrence with month-end clamping, separate occurrence history, bounded future horizon, stop-future action.
- Text/dictation/photo capture, privacy defaults, conversion to tasks and discussion items.
- Reference board; companies, contacts and primary delivery contact; mailto handoff to the default email app.
- Server-filtered marketing reports, independent ranges, PDF downloads, immutable snapshots and PDF files, calendar appendices.
- Full ZIP backup/import including original files. Import adds missing records without replacing existing ones.
- Installable PWA manifest, standalone mode, offline capture fallback, phone Capture/Today/Browse navigation.

## Deliberate boundaries

- Device speech recognition is optional and browser dependent. Phone keyboard dictation is the fallback. No app-owned audio recording or cloud transcription service.
- Apple/Google calendar integration currently uses ICS downloads. No automatic external calendar sync or two-way editing.
- Outlook compose handoff does not attach files automatically or confirm sending.
- Background sync while the PWA is closed is not promised; leave it open to upload.
- Mission Control SQLite migration is supported by `scripts/import-mission-control.py`. It reads the source without writes, takes a consistent WAL-aware snapshot, and creates a Launch backup ZIP with original attachments. Data stays outside the source repository. Stable IDs make retries additive; completion timestamps, report flags, dates, and legacy metadata are retained. Already-routed Telegram captures are archived. Known business routines use Business/report-off instead of the old Personal flag.
- WebMCP capture action is feature detected; no supported live validation context was available.

## Sources

- Speech recognition support: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
- Fonts: https://github.com/google/fonts/tree/main/ofl/barlow and https://github.com/google/fonts/tree/main/ofl/bitter

## Local development

Run `npm install`, apply `drizzle/*.sql` to the local D1 binding using the provided `wrangler.local.json`, then `npm run dev`. The Sites plugin provides local sign-in at `/signin-with-chatgpt?return_to=/`. Production identity comes from the private Sites dispatcher.

Source tests: `npm test`. Type check: `npx tsc --noEmit`. Build: `npm run build`.

## Lint configuration

Vendored UI primitives are excluded from application lint. Image optimization rules are disabled because attachments are authenticated originals and the brand assets are pre-sized. Auth links intentionally use full document navigation. React Compiler checks are disabled because this application does not enable that compiler. Hook correctness, TypeScript checking, and accessibility checks remain enabled.

## Validation

- TypeScript and application lint pass.
- Model/storage tests cover privacy, completion ranges, month-end and weekday recurrence, milestone urgency, conflict merging, ICS escaping, offline note/photo recovery, dashboard grouping, and imported recurrence boundaries.
- Authenticated local API tests cover durable writes, retry idempotency, conflict responses, report exclusions, immutable report records, file roundtrips, anonymous access rejection, and origin checks.
- Both PDF calendar layouts were generated with crowded days and long notes and inspected as rendered pages. Overflow is preserved in a labeled details appendix.
- The production bundle builds with D1/R2 metadata and migration files. Local test records are not included in production data.
- Browser interaction QA and physical phone dictation/camera/install testing have not been performed. These remain acceptance checks on the user’s actual devices.
- Runtime dependencies were updated to address the high-severity advisories from the scaffold. Four moderate advisories remain in the development-only Drizzle migration-tool dependency chain; no forced downgrade was applied.
