import {
  agentEntity,
  agentReceipt,
  agentSchemas,
  type AgentAction,
} from './agent-actions';
import type { Entity } from './model';

export type AgentConnection = { id: string; owner: string; name: string };
export async function hashAgentValue(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}
export async function authenticateAgent(db: D1Database, request: Request) {
  const match = /^Bearer (launch_[a-f0-9]{64})$/.exec(
    request.headers.get('authorization') || '',
  );
  if (!match) return null;
  return db
    .prepare(
      'SELECT id,owner,name FROM agent_connections WHERE token_hash=? AND revoked_at IS NULL',
    )
    .bind(await hashAgentValue(match[1]))
    .first<AgentConnection>();
}
export async function createAgentConnection(
  db: D1Database,
  owner: string,
  name: string,
) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token =
    'launch_' +
    Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
  const id = crypto.randomUUID(),
    createdAt = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO agent_connections(id,owner,name,token_hash,created_at) VALUES(?,?,?,?,?)',
    )
    .bind(id, owner, name, await hashAgentValue(token), createdAt)
    .run();
  return { id, name, token, createdAt };
}
export async function saveAgentItem(
  db: D1Database,
  connection: AgentConnection,
  action: AgentAction,
  input: unknown,
) {
  const args = agentSchemas[action].parse(input);
  const fingerprint = await hashAgentValue(JSON.stringify({ action, args }));
  // Bind the request identity to this connection. Retries, including concurrent
  // requests and retries after midnight, return the original persisted item.
  const id =
    'agent-' + (await hashAgentValue(connection.id + ':' + args.request_id));
  const read = () =>
    db
      .prepare(
        'SELECT a.fingerprint,r.body,r.version FROM agent_requests a JOIN records r ON r.owner=a.owner AND r.id=a.entity_id WHERE a.connection_id=? AND a.request_id=? AND a.owner=?',
      )
      .bind(connection.id, args.request_id, connection.owner)
      .first<{ fingerprint: string; body: string; version: number }>();
  const existing = await read();
  const receipt = (row: NonNullable<typeof existing>) => {
    if (row.fingerprint !== fingerprint)
      throw new Error(
        'This request_id already belongs to different content. Use a new request_id for a new item.',
      );
    const entity = { ...JSON.parse(row.body), version: row.version } as Entity;
    if (entity.deletedAt)
      throw new Error(
        'This item was already created and later deleted. Use a new request_id only if the user wants to recreate it.',
      );
    return agentReceipt(entity);
  };
  if (existing) return receipt(existing);
  const entity = { ...agentEntity(action, args), id, version: 1 };
  // D1 batch is atomic. Both writes check revocation, including a disconnect
  // that races with the original authentication lookup.
  await db.batch([
    db
      .prepare(
        'INSERT OR IGNORE INTO agent_requests(connection_id,request_id,owner,entity_id,fingerprint,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agent_connections WHERE id=? AND owner=? AND revoked_at IS NULL)',
      )
      .bind(
        connection.id,
        args.request_id,
        connection.owner,
        id,
        fingerprint,
        entity.createdAt,
        connection.id,
        connection.owner,
      ),
    db
      .prepare(
        'INSERT OR IGNORE INTO records(owner,id,kind,body,version,updated_at) SELECT ?,?,?,?,1,? WHERE EXISTS(SELECT 1 FROM agent_requests WHERE connection_id=? AND request_id=? AND fingerprint=?) AND EXISTS(SELECT 1 FROM agent_connections WHERE id=? AND owner=? AND revoked_at IS NULL)',
      )
      .bind(
        connection.owner,
        id,
        entity.kind,
        JSON.stringify(entity),
        entity.updatedAt,
        connection.id,
        args.request_id,
        fingerprint,
        connection.id,
        connection.owner,
      ),
  ]);
  const saved = await read();
  if (!saved)
    throw new Error(
      'The connection was disconnected. Reconnect it in Launch Settings.',
    );
  return receipt(saved);
}
