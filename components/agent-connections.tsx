'use client';
import { useEffect, useState } from 'react';
import { Copy, Link2, Unplug } from 'lucide-react';
type Connection = {
  id: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
};
export function AgentConnections({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [setup, setSetup] = useState<{ id: string; config: string } | null>(
    null,
  );
  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/agent-connections');
      const data = (await response.json()) as {
        error?: string;
        connections: Connection[];
      };
      if (!response.ok)
        throw new Error(data.error || 'Could not load connections.');
      setConnections(data.connections);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function connect() {
    setBusy(true);
    try {
      const response = await fetch('/api/agent-connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Grok Bot' }),
      });
      const data = (await response.json()) as {
        error?: string;
        id: string;
        config: object;
      };
      if (!response.ok)
        throw new Error(data.error || 'Could not create connection.');
      setSetup({ id: data.id, config: JSON.stringify(data.config, null, 2) });
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect(id: string) {
    setBusy(true);
    try {
      const response = await fetch(
        '/api/agent-connections?id=' + encodeURIComponent(id),
        { method: 'DELETE' },
      );
      if (!response.ok) throw new Error('Could not disconnect. Try again.');
      if (setup?.id === id) setSetup(null);
      await refresh();
      notify('Agent disconnected. Items already saved stay in Launch.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section">
      <h2>Agent connections</h2>
      <p className="hint">
        Let Grok Bot add tasks, quick notes, and meeting agenda items to your
        account. It can set reminders. Enable Phone alerts in Settings to
        receive them when Launch is closed.
      </p>
      <p className="hint">
        Connections can create items and check their own save receipts. They
        cannot browse, edit, or delete your existing data.
      </p>
      {loading && <output className="hint">Loading connections…</output>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button className="text-button" onClick={() => void refresh()}>
            Retry
          </button>
        </p>
      )}
      {connections
        .filter((c) => !c.revokedAt)
        .map((connection) => (
          <div className="setting-row" key={connection.id}>
            <span>
              {connection.name}
              <small>
                Created {new Date(connection.createdAt).toLocaleDateString()}
              </small>
            </span>
            <button
              className="button"
              disabled={busy}
              onClick={() => void disconnect(connection.id)}
            >
              <Unplug />
              Disconnect
            </button>
          </div>
        ))}
      <button
        className="button"
        disabled={busy || loading || !!error || !!setup}
        onClick={() => void connect()}
      >
        <Link2 />
        Create Grok Bot connection
      </button>
      {setup && (
        <div className="agent-setup">
          <p>
            In Grok Bot, choose <strong>Add MCP Server</strong>, switch to JSON,
            and paste this connection.
          </p>
          <p className="hint">
            This contains your private connection key. Copy it now; it is only
            shown once. Keep it out of chats.
          </p>
          <textarea
            aria-label="Grok Bot connection JSON"
            readOnly
            value={setup.config}
            rows={9}
            spellCheck={false}
          />
          <div className="button-row">
            <button
              className="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(setup.config);
                  notify(
                    'Connection copied. Paste it into Grok Bot’s MCP settings.',
                  );
                } catch {
                  notify('Select and copy the connection text above.');
                }
              }}
            >
              <Copy />
              Copy connection
            </button>
            <button className="text-button" onClick={() => setSetup(null)}>
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
