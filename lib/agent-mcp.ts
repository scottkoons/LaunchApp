import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { agentSchemas, type AgentAction } from './agent-actions';
import { authenticateAgent, saveAgentItem } from './agent-store';
import { localTime } from './capture-intent';
import {
  AgentToolError,
  agentSummary,
  readAgentItems,
  readSchemas,
  writeAgentItem,
  writeSchemas,
  type ReadTool,
  type WriteTool,
} from './agent-crud';

// Every tool error has the same shape: {"error":{"code","message"}}.
function toolError(error: unknown, retry: string): CallToolResult {
  const code =
    error instanceof AgentToolError
      ? error.code
      : error instanceof Error && error.name === 'ZodError'
        ? 'validation'
        : 'unavailable';
  const raw = error instanceof Error ? error.message : '';
  const message =
    !raw || raw.startsWith('D1_')
      ? `Launch storage is unavailable. ${retry}`
      : raw;
  return {
    isError: true,
    content: [
      { type: 'text', text: JSON.stringify({ error: { code, message } }) },
    ],
  };
}
function toolResult(value: object): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export async function agentMcp(request: Request, db: D1Database) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return new Response('Origin rejected', { status: 403 });
  const connection = await authenticateAgent(db, request);
  if (!connection)
    return Response.json(
      { error: 'Connect Launch using an active Launch agent token.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  if (request.method !== 'POST')
    return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  if (Number(request.headers.get('content-length') || 0) > 100000)
    return new Response('Request too large', { status: 413 });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 100000)
    return new Response('Request too large', { status: 413 });
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return Response.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Invalid JSON' },
      },
      { status: 400 },
    );
  }
  const siteOrigin = new URL(request.url).origin;
  const server = new McpServer(
    { name: 'Launch', version: '1.0.0' },
    {
      instructions:
        'Read, create, update and trash tasks, quick notes, and meeting agenda items in the connected Launch account. Default to the business workspace and America/Denver time zone when creating. Reads return live Launch items; never invent items, and use the ids they return. Only create or change items the user asks for. Use one stable request_id per new item and reuse it on retries. A single task date is its Final deadline. Task colors match the Launch UI: red overdue, yellow due soon (within soon_days), blue later, green done, gray postponed; get_launch_context explains them and gives counts. delete_item moves an item to Trash (restore_item brings it back); permanent deletion is only available inside Launch. Pass expected_version from your last read to avoid overwriting a newer change. Call get_launch_context when resolving relative dates; today and tomorrow are also accepted directly. Ask for a reminder time if missing. Reminders appear inside Launch. Background phone alerts require the user to enable Phone alerts in Launch Settings on that device and a connected reminder service. A saved reminder does not confirm that phone alerts are enabled or delivered. Confirm success only after the tool returns the saved item.',
    },
  );
  server.registerTool(
    'get_launch_context',
    {
      title: 'Get Launch date and connection',
      description:
        'Check the connection and current date/time before resolving dates. Also returns open task counts (due today, overdue, by UI color) and what each color means.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return toolResult({
          connected: true,
          connection: connection.name,
          now: new Date().toISOString(),
          local_time: localTime(new Date().toISOString(), 'America/Denver'),
          time_zone: 'America/Denver',
          default_workspace: 'business',
          reminder_delivery:
            'Inside Launch; background delivery requires Phone alerts enabled on the device and a connected reminder service. Device status is not checked by this tool.',
          ...(await agentSummary(db, connection, siteOrigin)),
        });
      } catch (error) {
        return toolError(error, 'Retry shortly.');
      }
    },
  );
  const readDescriptions: Record<ReadTool, string> = {
    list_tasks:
      'List tasks with filters. Dates filter on next_date (the next unfinished draft, review or final date, else the planned date), the same date the Launch dashboard shows. status defaults to open. color/urgency match the UI (yellow = due soon). Paged: limit (default 50) and next_cursor.',
    list_notes:
      'List quick notes, newest first. Archived and trashed notes are excluded unless requested. Paged.',
    list_agenda_items:
      'List meeting agenda items in agenda order. Discussed items are excluded unless include_discussed. Filter by meeting_date or from/to. Paged.',
    get_item: 'Get one task, note or agenda item by id, including Trash.',
    search_items:
      'Search titles and notes across tasks, notes and agenda items, newest first. Paged.',
  };
  for (const tool of Object.keys(readSchemas) as ReadTool[])
    server.registerTool(
      tool,
      {
        description: readDescriptions[tool],
        inputSchema: readSchemas[tool],
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async (args: unknown): Promise<CallToolResult> => {
        try {
          return toolResult(
            await readAgentItems(db, connection, tool, args, siteOrigin),
          );
        } catch (error) {
          return toolError(error, 'Retry shortly.');
        }
      },
    );
  const writeDescriptions: Record<WriteTool, string> = {
    update_task:
      'Change a task by id. Only the fields you pass change. status: open, done or postponed. due_date null clears the Final deadline. Set a reminder with reminder_date and reminder_time, or clear_reminder. Returns the saved item.',
    update_note:
      'Change a quick note by id: title, notes, workspace, or archived. Returns the saved item.',
    update_agenda_item:
      'Change an agenda item by id: title, notes (one bullet per line), meeting_date (null clears), discussed, important. Returns the saved item.',
    delete_item:
      'Move a task, note or agenda item to Trash by id (soft delete; restore_item undoes it). Permanent deletion is only available inside Launch. Returns the item with in_trash true.',
    restore_item: 'Restore an item from Trash by id. Returns the saved item.',
  };
  for (const tool of Object.keys(writeSchemas) as WriteTool[])
    server.registerTool(
      tool,
      {
        description: writeDescriptions[tool],
        inputSchema: writeSchemas[tool],
        annotations: {
          readOnlyHint: false,
          destructiveHint: tool === 'delete_item',
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args: unknown): Promise<CallToolResult> => {
        try {
          return toolResult({
            saved: true,
            item: await writeAgentItem(db, connection, tool, args, siteOrigin),
          });
        } catch (error) {
          return toolError(error, 'Retry the same change shortly.');
        }
      },
    );
  const descriptions = {
    add_task:
      'Save a task to Launch. A due date goes in Final. Can also set an explicitly requested reminder. Returns the saved item after durable account sync.',
    add_note:
      'Save a quick note to Launch, preserving its title and line breaks.',
    add_agenda_item:
      'Save a meeting agenda item to Launch. The title is the heading; each nonempty notes line appears as its own bullet point beneath it.',
  };
  for (const action of Object.keys(agentSchemas) as AgentAction[]) {
    server.registerTool(
      action,
      {
        description: descriptions[action],
        inputSchema: agentSchemas[action],
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (args: unknown): Promise<CallToolResult> => {
        try {
          const saved = await saveAgentItem(db, connection, action, args);
          // Keep the original receipt fields and add the full item.
          const item = await readAgentItems(
            db,
            connection,
            'get_item',
            { id: saved.id },
            siteOrigin,
          );
          return toolResult({ ...saved, item });
        } catch (error) {
          return toolError(error, 'Retry with the same request_id.');
        }
      },
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request, { parsedBody });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } finally {
    await server.close();
  }
}
