import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { agentSchemas, type AgentAction } from './agent-actions';
import { authenticateAgent, saveAgentItem } from './agent-store';
import { localTime } from './capture-intent';

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
  const server = new McpServer(
    { name: 'Launch', version: '1.0.0' },
    {
      instructions:
        'Save tasks, quick notes, and meeting agenda items in the connected Launch account. Default to the business workspace and America/Denver time zone. Only save items the user requests. Use one stable request_id per item and reuse it on retries. A single task date is its Final deadline. Call get_launch_context when resolving relative dates; today and tomorrow are also accepted directly. Ask for a reminder time if missing. Reminders appear inside Launch. Background phone alerts require the user to enable Phone alerts in Launch Settings on that device and a connected reminder service. A saved reminder does not confirm that phone alerts are enabled or delivered. Confirm success only after saved:true. Tools cannot list, edit, or delete existing records.',
    },
  );
  server.registerTool(
    'get_launch_context',
    {
      title: 'Get Launch date and connection',
      description:
        'Check the connection and current date/time before resolving dates. Does not read tasks or notes.',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            connected: true,
            connection: connection.name,
            now: new Date().toISOString(),
            local_time: localTime(new Date().toISOString(), 'America/Denver'),
            time_zone: 'America/Denver',
            default_workspace: 'business',
            reminder_delivery:
              'Inside Launch; background delivery requires Phone alerts enabled on the device and a connected reminder service. Device status is not checked by this tool.',
          }),
        },
      ],
    }),
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
          return {
            content: [{ type: 'text', text: JSON.stringify(saved) }],
            structuredContent: saved,
          };
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Launch could not save the item. Retry with the same request_id.';
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: message.startsWith('D1_')
                  ? 'Launch storage is unavailable. Retry with the same request_id.'
                  : message,
              },
            ],
          };
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
