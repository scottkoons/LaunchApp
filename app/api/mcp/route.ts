import { database } from '@/lib/server';
import { agentMcp } from '@/lib/agent-mcp';
async function handle(request: Request) {
  try {
    return await agentMcp(request, database());
  } catch {
    return Response.json(
      { error: 'Launch connection is temporarily unavailable. Retry shortly.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
