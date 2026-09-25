# Grok Bot private Launch connection

Paired on September 11, 2026 with Dr. Doofenshmirtz, Scott's chief of staff.
The Launch card showed four tools. Dr. Doofenshmirtz verified
`get_launch_context` returned `connected: true`, connection `Grok Bot`, time zone
`America/Denver`, and default workspace `business`. The same check succeeded
after moving the proxy into durable storage. No test tasks or notes were added.

## Registered connection

- Private account connector: `Launch` (`user-Launch`).
- Transport: stdio on Grok Bot's shared computer.
- Command: `python3`.
- Arguments: `["/home/box/agent-data/launch-mcp/run_from_box_secrets.py"]`.
- Remote endpoint: `https://launch-scott-planner.scottkoons.chatgpt.site/api/mcp`.
- Tools (originally four): `get_launch_context`, `add_task`, `add_note`,
  `add_agenda_item`. Since the full read and write release, also `list_tasks`,
  `list_notes`, `list_agenda_items`, `get_item`, `search_items`,
  `update_task`, `update_note`, `update_agenda_item`, `delete_item` and
  `restore_item` (see [the API notes](agent-connection.md)). The proxy passes
  tools through unchanged; after deploying, refresh or reconnect the Launch
  connector in Grok Bot so it discovers the new tools.

The connector is registered to Scott's account and can be used by his other
agents. The proxy lives under `/home/box/agent-data`, outside temporary
`/workspace` storage. Normal app/computer restarts retain this setup. A full
computer reset may require restoring the proxy and entering the credentials
again. A restart was not performed during verification because other agents
were working on the same computer.

The source backup is
[`integrations/grok-bot/run_from_box_secrets.py`](../integrations/grok-bot/run_from_box_secrets.py).
It requires Python 3 and Node/npm (`npx`) on Grok Bot's computer, and pins its
transport dependency to the verified `mcp-remote@0.13.5`. Restore that script to
the registered path above if the computer is reset. Do not copy secret-store
files into this repository.

## Credentials

Grok Bot requested two masked secret cards. Codex entered the raw tokens,
without a `Bearer` prefix, directly into those fields:

- `LAUNCH_CONNECTION_TOKEN`: the dedicated Launch token.
- `OAI_SITES_AUTHORIZATION`: the existing private Sites gateway token.

Both cards confirmed that the values were saved securely. In this Grok Bot
version, the saved values did not appear in the worker process environment.
The proxy reads the two named card entries from Grok Bot's secret store inside
its process and adds the `Bearer` prefix to the two HTTP headers. It must never
print or copy secret-store contents into logs, chat, source files, or Git.
The wrapper uses literal environment placeholders in process arguments and
`--silent`, following [mcp-remote's header setup](https://github.com/punkpeye/mcp-remote#custom-headers).
The revised wrapper was verified against `get_launch_context` again. Local
credential-handling checks run with
`python3 -B -m unittest discover -s integrations/grok-bot -p 'test_*.py'`.

The OAuth Authorize card initially changed to Retry; it cannot collect these
headers. A generic Launch Add card opened a public Marketplace search and was
also not the installation path. Do not enable team sharing or publish a plugin
to work around either limitation.

## Use and verification

Ask an agent: "Add a task to Launch to call Sonos, due tomorrow."
The agent should use `add_task`, retain one unique `request_id` for retries of
that same item, and confirm the returned save receipt. Single task deadlines
go into Final. Notes and agenda items have their own creation tools.

After reinstalling or changing the connector, verify tool discovery and call
`get_launch_context` before reporting it connected. Only create records when
the user requests them. See [the API notes](agent-connection.md) for permissions,
idempotency, reminders, and revocation. Disconnecting the connection in Launch
Settings revokes its ability to read or change items.
