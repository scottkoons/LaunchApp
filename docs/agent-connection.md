# Grok Bot connection

In Launch Settings, create a Grok Bot connection. For an MCP client with private
HTTP header settings, import the generated JSON there. Grok Bot 0.47.0's
Authorize card supports OAuth, not these fixed headers; its visible Add MCP
Server form belongs to team sharing. Scott's private connection instead uses
Grok Bot's secure secret cards and a persistent stdio proxy, as recorded in
[Grok Bot setup](grok-bot-setup.md). Keep credentials out of ordinary chat.

The remote streamable HTTP endpoint is `/api/mcp`. Every tool is scoped to the
account that created the connection.

| Tool                                      | What it does                                                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_launch_context`                      | Connection, date and time (America/Denver), and open task counts: due today, overdue, by color, with the color legend.                                                                                      |
| `list_tasks`                              | Filters: `workspace`, `status` (open, done, postponed, all; default open), `due_on`, `due_before`, `due_after`, `due_from`, `due_to`, `overdue`, `color`, `urgency`, `query`, `include_trash`.              |
| `list_notes`                              | Filters: `workspace`, `query`, `updated_since`, `include_archived`, `include_trash`.                                                                                                                        |
| `list_agenda_items`                       | Filters: `workspace`, `meeting_date`, `from`, `to`, `include_discussed`, `include_trash`.                                                                                                                   |
| `get_item`                                | One task, note or agenda item by id, including Trash.                                                                                                                                                       |
| `search_items`                            | `query` across titles and notes, with optional `types` and `workspace`.                                                                                                                                     |
| `add_task`, `add_note`, `add_agenda_item` | Create, as before. The receipt now also includes the full `item`.                                                                                                                                           |
| `update_task`                             | Change `title`, `notes`, `workspace`, `status` (open, done, postponed), `due_date` (null clears), `due_time`, reminder (`reminder_date` and `reminder_time`, or `clear_reminder`), `important` or `pinned`. |
| `update_note`                             | Change `title`, `notes`, `workspace` or `archived`.                                                                                                                                                         |
| `update_agenda_item`                      | Change `title`, `notes`, `meeting_date`, `discussed` or `important`.                                                                                                                                        |
| `delete_item`                             | Moves an item to Trash (soft delete).                                                                                                                                                                       |
| `restore_item`                            | Brings an item back from Trash.                                                                                                                                                                             |

Agents cannot permanently delete items; that stays a manual action in Launch.

List tools return `{ items, count, next_cursor }` with a default `limit` of 50
(maximum 200). Pass `next_cursor` back as `cursor` for the next page.

Every item has the same shape:

- **Identity:** `id`, `type` (task, note or agenda), `version`, and `url` (a
  link that opens the item in Launch).
- **Content:** `title`, `notes`, `workspace` and `status`. Task status is
  open, done or postponed. A note is open or archived; an agenda item is open
  or discussed.
- **Flags and history:** `important`, `pinned`, `in_trash`, `created_at`,
  `updated_at` and `completed_at`.
- **Tasks also have:** `urgency`, `color`, `next_date`, `due_date` (Final),
  `due_time`, `draft_date`, `review_date`, `planned_date`, `draft_done`,
  `final_done` and `recurring`.
- **Agenda items also have:** `meeting_date` and `bullets`, one per nonempty
  notes line.
- **Reminder:** `reminder` is `{ at, date, time, time_zone, dismissed }` when a
  reminder is set.

Task dates filter on `next_date`: the next unfinished draft, review or final
date, else the planned date. It is the date the Launch dashboard shows.

### Colors

Colors are computed from `urgency` exactly as the Launch UI draws them, using
today in America/Denver and the Launch setting `soon_days` (default 2):

| Color  | Urgency | Meaning                                                                   |
| ------ | ------- | ------------------------------------------------------------------------- |
| red    | overdue | The next unfinished milestone is before today.                            |
| yellow | soon    | The next unfinished milestone is today or within `soon_days` after today. |
| blue   | future  | The next unfinished milestone is later than that.                         |
| green  | done    | The task is completed.                                                    |
| gray   | paused  | The task is postponed.                                                    |
| none   | none    | An open task with no date.                                                |

### Writes

Writes change only the fields passed. They use the same validation and version
check as device sync, and Launch picks them up on its next sync like a change
from another device.

- **Version check:** pass `expected_version` from your last read to refuse the
  change if the item changed since (error code `conflict`).
- **Error shape:** every error is `{"error":{"code","message"}}`. The codes
  are `not_found`, `validation`, `conflict` and `unavailable`.
- **Revocation:** writes also require the connection to still be active, so
  disconnecting in Launch Settings stops writes immediately.

### Creating items

Only explicitly requested items should be created. Business and America/Denver
are the defaults; personal items can be requested. A single task deadline is
saved in Final. Each nonempty agenda notes line renders as a bullet under its
title.

Use a unique `request_id` per new item, retaining the same arguments and ID for
retries. The server checks durable receipts to prevent duplicate creation,
including concurrent requests. Conflicting reuse fails. Launch syncs from the
same account database on focus and every 15 seconds while open.

Reads return the records stored for the account. Future occurrences of
repeating tasks appear once Launch has planned them, which happens when the app
syncs.

Reminders are saved with an absolute instant and IANA time zone. They appear
inside Launch while it is open. Background phone notifications also require
the phone-alert service to be configured and the user to enable Phone alerts in
Launch Settings on that device. A saved receipt does not confirm delivery or
device permissions. The connector does not add email or SMS delivery.
Clock-change ambiguities and nonexistent times are
rejected instead of silently moving an alarm.

## Authentication and revocation

Two independent headers are required for this private Sites deployment:

- `OAI-Sites-Authorization` passes the existing private Sites gateway.
- `Authorization` carries the dedicated Launch connection token. Only its
  SHA-256 hash is stored, mapped to the signed-in owner's account. The gateway
  credential alone does not provide an app identity or access to records.

The setup API requires the normal signed-in browser identity. Never accept a
caller-provided owner ID. All existing browser APIs retain their sign-in checks.
Disconnect in Launch Settings revokes that connection for reads and writes,
including writes racing with revocation. Previously saved items remain intact.

The owner configures `LAUNCH_SITES_GATEWAY_TOKEN` as a Sites secret with the
existing gateway bearer value from Sites (without `Bearer `). Preserve other
runtime variables. Do not rotate the Sites bypass token as a routine setup step.
If it is deliberately rotated, update this secret, redeploy, and recreate the
Grok Bot configuration. Neither header belongs in Git or logs.

For local development use a harmless placeholder for
`LAUNCH_SITES_GATEWAY_TOKEN`; local Sites sign-in supplies a simulated owner.
Production never uses that simulated identity. Run `npm test` to exercise the
official MCP client against the endpoint and the actual migration schema in
SQLite. Run `npm run typecheck` and the Sites build before deployment.
