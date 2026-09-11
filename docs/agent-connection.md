# Grok Bot connection

In Launch Settings, create a Grok Bot connection. In Grok Bot's MCP settings,
choose Add MCP Server, switch to JSON, and paste the generated configuration.
Keep this configuration in the connector's settings, not in an agent chat.

The remote streamable HTTP endpoint is `/api/mcp`. It provides `add_task`,
`add_note`, `add_agenda_item`, and `get_launch_context`. Only explicitly requested
items should be saved. Business and America/Denver are the defaults; personal
items can be requested. A single task deadline is saved in Final. Each nonempty
agenda notes line renders as a bullet under its title.

Use a unique `request_id` per item, retaining the same arguments and ID for
retries. The server checks durable receipts to prevent duplicate creation,
including concurrent requests. Conflicting reuse fails. Agents can retrieve an
item's current receipt by repeating its original creation request; they cannot
list, edit, or delete other records. Launch syncs from the same account database
on focus and every 15 seconds while open.

Reminders are saved with an absolute instant and IANA time zone. They appear
inside Launch while it is open. This connector does not add background push,
email, or SMS delivery. Clock-change ambiguities and nonexistent times are
rejected instead of silently moving an alarm.

## Authentication and revocation

Two independent headers are required for this private Sites deployment:

- `OAI-Sites-Authorization` passes the existing private Sites gateway.
- `Authorization` carries the dedicated Launch connection token. Only its
  SHA-256 hash is stored, mapped to the signed-in owner's account. The gateway
  credential alone does not provide an app identity or access to records.

The setup API requires the normal signed-in browser identity. Never accept a
caller-provided owner ID. All existing browser APIs retain their sign-in checks.
Disconnect in Launch Settings revokes that connection, including new writes
racing with revocation. Previously saved items remain intact.

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
