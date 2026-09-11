import { database, owner, json, failure, originGuard } from '@/lib/server';
import { createAgentConnection } from '@/lib/agent-store';
import { env } from 'cloudflare:workers';
export async function GET() {
  try {
    const user = await owner();
    const rows = await database()
      .prepare(
        'SELECT id,name,created_at AS createdAt,revoked_at AS revokedAt FROM agent_connections WHERE owner=? ORDER BY created_at DESC',
      )
      .bind(user)
      .all();
    return json({ connections: rows.results });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    originGuard(request);
    const user = await owner();
    const raw = await request.text();
    if (raw.length > 2000)
      return json({ error: 'Connection name too long.' }, 413);
    const input = JSON.parse(raw);
    if (
      typeof input?.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 100
    )
      return json({ error: 'Choose a connection name.' }, 400);
    const gateway = (env as unknown as Record<string, string>)
      .LAUNCH_SITES_GATEWAY_TOKEN;
    if (!gateway)
      return json(
        {
          error:
            'Agent connections need to be configured on this Launch deployment first.',
        },
        503,
      );
    const connection = await createAgentConnection(
      database(),
      user,
      input.name.trim(),
    );
    return json(
      {
        id: connection.id,
        name: connection.name,
        createdAt: connection.createdAt,
        config: {
          mcpServers: {
            launch: {
              url: new URL('/api/mcp', request.url).href,
              headers: {
                Authorization: 'Bearer ' + connection.token,
                'OAI-Sites-Authorization': 'Bearer ' + gateway,
              },
            },
          },
        },
      },
      201,
    );
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(request: Request) {
  try {
    originGuard(request);
    const user = await owner();
    const id = new URL(request.url).searchParams.get('id');
    if (!id || id.length > 100)
      return json({ error: 'Choose a connection.' }, 400);
    await database()
      .prepare(
        'UPDATE agent_connections SET revoked_at=? WHERE owner=? AND id=? AND revoked_at IS NULL',
      )
      .bind(new Date().toISOString(), user, id)
      .run();
    return json({ disconnected: true });
  } catch (e) {
    return failure(e);
  }
}
