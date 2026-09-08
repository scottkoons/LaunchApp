'use client';
import { useRef, useState } from 'react';
import {
  Download,
  Upload,
  Undo2,
  Cloud,
  FileText,
  Sun,
  Moon,
  Rocket,
  Check,
} from 'lucide-react';
import { Toggle, Pick } from './launch-controls';
import { createEntity, now, type Entity, type FileMeta } from '@/lib/model';
import { downloadBlob } from './calendar';
import type { LaunchStore } from '@/lib/client-store';
export function SettingsPanel({
  store,
  records,
  files,
  settings,
  notify,
  theme,
  changeTheme,
}: {
  store: LaunchStore;
  records: Entity[];
  files: FileMeta[];
  settings?: Entity;
  notify: (s: string) => void;
  theme: string;
  changeTheme: (s: string) => void;
}) {
  const [busy, setBusy] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  async function update(patch: Partial<Entity>) {
    const current = store.data.records.find(
      (e) => e.kind === 'settings' && !e.deletedAt,
    );
    if (current) await store.change(current, patch);
    else
      await store.add(
        createEntity('settings', 'business', {
          title: 'Launch preferences',
          ...patch,
        }),
      );
  }
  async function backup() {
    setBusy('Preparing backup…');
    try {
      const { default: JSZip } = await import('jszip');
      await store.sync();
      if (store.data.queue.length || store.data.uploads.length || store.error)
        throw new Error('Sync pending changes before exporting a backup.');
      const zip = new JSZip();
      zip.file(
        'launch-backup.json',
        JSON.stringify(
          {
            format: 'launch-v1',
            createdAt: now(),
            records: store.data.records,
            files: store.data.files,
          },
          null,
          2,
        ),
      );
      for (const f of store.data.files) {
        setBusy('Adding ' + f.name);
        const r = await fetch('/api/files/' + f.id);
        if (!r.ok) throw new Error('Could not download ' + f.name);
        zip.file('files/' + f.id, await r.arrayBuffer());
      }
      downloadBlob(
        await zip.generateAsync({ type: 'blob' }),
        'Launch-backup-' + now().slice(0, 10) + '.zip',
      );
      notify('Backup downloaded with original attachments.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function restore(file: File) {
    setBusy('Reading backup…');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(file);
      const content = zip.file('launch-backup.json');
      if (!content) throw new Error('Choose a Launch backup ZIP.');
      const b = JSON.parse(await content.async('string'));
      if (
        b.format !== 'launch-v1' ||
        !Array.isArray(b.records) ||
        !Array.isArray(b.files)
      )
        throw new Error('This backup format is not supported.');
      for (const f of b.files as FileMeta[]) {
        setBusy('Importing ' + f.name + '…');
        const item = zip.file('files/' + f.id);
        if (!item) throw new Error('Backup is missing ' + f.name);
        const blob = await item.async('blob');
        if (blob.size > 20 * 1024 * 1024)
          throw new Error(f.name + ' is over the file limit.');
        const form = new FormData();
        form.set('id', f.id);
        form.set(
          'file',
          new Blob([blob], { type: f.type || 'application/octet-stream' }),
          f.name,
        );
        const r = await fetch('/api/files', { method: 'POST', body: form });
        if (!r.ok) throw new Error('Could not restore ' + f.name);
      }
      for (let i = 0; i < b.records.length; i += 100) {
        setBusy(
          `Importing records ${i + 1}–${Math.min(i + 100, b.records.length)}…`,
        );
        const r = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: b.records.slice(i, i + 100) }),
        });
        if (!r.ok)
          throw new Error(((await r.json()) as { error: string }).error);
      }
      await store.sync();
      notify('Backup imported. Existing records were left unchanged.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="settings-layout">
      <section className="settings-section">
        <h2>Appearance</h2>
        <p className="hint">Same workspace. A different atmosphere.</p>
        <div className="theme-options">
          {[
            ['space', 'Space', Rocket],
            ['dark', 'Dark', Moon],
            ['light', 'Light', Sun],
          ].map(([v, label]) => (
            <button
              className={'theme-option ' + (theme === v ? 'selected' : '')}
              key={v as string}
              onClick={() => changeTheme(v as string)}
            >
              <span className={'theme-swatch ' + v} />
              {label as string}
              {theme === v && <Check />}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <h2>Tasks & meetings</h2>
        <label className="setting-row">
          <span>
            Business name<small>Used in your marketing reports.</small>
          </span>
          <input
            key={settings?.businessName}
            defaultValue={settings?.businessName || 'Colorado Mountain Brewery'}
            onBlur={(e) => void update({ businessName: e.target.value })}
          />
        </label>
        <label className="setting-row">
          <span>
            Due soon warning
            <small>
              Count each task once using its next unfinished deadline.
            </small>
          </span>
          <Pick
            label="Due soon window"
            value={String(settings?.soonDays ?? 2)}
            onChange={(s) => void update({ soonDays: Number(s) })}
            options={[
              ['1', '1 day'],
              ['2', '2 days'],
              ['3', '3 days'],
              ['5', '5 days'],
              ['7', '7 days'],
            ]}
          />
        </label>
        <div className="setting-row">
          <span>
            Report new business tasks
            <small>
              Can be changed per task. Personal tasks are always excluded.
            </small>
          </span>
          <Toggle
            checked={settings?.reportDefault ?? true}
            onChange={(reportDefault) => void update({ reportDefault })}
          >
            Include by default
          </Toggle>
        </div>
      </section>
      <section className="settings-section">
        <h2>Phone & connections</h2>
        <div className="setting-row">
          <span>
            Install Launch on your phone
            <small>
              Open this site in your phone browser, then choose Add to Home
              Screen. Launch opens to Capture.
            </small>
          </span>
          <Rocket />
        </div>
        <div className="setting-row">
          <span>
            Quick dictation
            <small>
              Use Wispr Flow in the desktop text box. On iPhone, tap the note
              field and use the keyboard microphone to turn speech into text.
            </small>
          </span>
          <Check />
        </div>
        <div className="setting-row">
          <span>
            Calendar
            <small>
              Download an ICS file from Calendar to import into Apple Calendar
              or Google Calendar. Automatic external calendar sync is not
              connected.
            </small>
          </span>
          <FileText />
        </div>
        <div className="setting-row">
          <span>
            Outlook handoff
            <small>
              Generate email opens your default email app with the recipient and
              subject. Add downloaded files there, then send from Outlook.
            </small>
          </span>
          <Check />
        </div>
        <div className="setting-row">
          <span>
            Private account sync
            <small>
              Your signed-in account connects this device to your phone. Leave
              the app open while large files upload.
            </small>
          </span>
          <Cloud />
        </div>
      </section>
      <section className="settings-section">
        <h2>Your data stays yours.</h2>
        <p className="hint">
          Completed work is kept indefinitely. Backups include task history,
          notes, contacts, reports, and original attachments.
        </p>
        <div className="button-row">
          <button
            className="button"
            onClick={() => void backup()}
            disabled={!!busy}
          >
            <Download />
            Download full backup
          </button>
          <button
            className="button"
            onClick={() => upload.current?.click()}
            disabled={!!busy}
          >
            <Upload />
            Import Launch backup
          </button>
          <input
            type="file"
            accept=".zip"
            hidden
            ref={upload}
            onChange={(e) => {
              if (e.target.files?.[0]) void restore(e.target.files[0]);
              e.target.value = '';
            }}
          />
        </div>
        <p className="hint">
          Import adds missing records and keeps existing records unchanged.
        </p>
        {busy && <output>{busy}</output>}
        <p className="hint">
          {records.length} records · {files.length} files ·{' '}
          {(files.reduce((n, f) => n + f.size, 0) / 1024 / 1024).toFixed(1)} MB
          of attachments
        </p>
      </section>
      <section className="settings-section">
        <h2>Trash</h2>
        <p className="hint">
          Deleted items are kept here until you restore them. No automatic
          deletion.
        </p>
        {records.filter((e) => e.deletedAt).length ? (
          records
            .filter((e) => e.deletedAt)
            .map((e) => (
              <div className="trash-row" key={e.id}>
                <span>
                  {e.title}
                  <small>
                    {e.kind} · {e.scope}
                  </small>
                </span>
                <button
                  className="text-button"
                  onClick={() => void store.change(e, { deletedAt: null })}
                >
                  <Undo2 />
                  Restore
                </button>
              </div>
            ))
        ) : (
          <p className="empty-inline">Nothing in Trash.</p>
        )}
      </section>
    </div>
  );
}
