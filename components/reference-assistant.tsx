'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, LoaderCircle, Sparkles } from 'lucide-react';
import type { LaunchStore } from '@/lib/client-store';
import { createEntity, now, type Scope } from '@/lib/model';
import type { FoundReference } from '@/lib/reference-discovery';
import { referencePages } from '@/lib/reference-render';

const example =
  'Find our regular menu and happy hour menu and add both as reference board images.';
export function ReferenceAssistant({
  store,
  scope,
  onAdded,
  notify,
}: {
  store: LaunchStore;
  scope: Scope;
  onAdded: () => void;
  notify: (message: string) => void;
}) {
  const settings = store.data.records.find(
    (item) => item.kind === 'settings' && !item.deletedAt,
  );
  const [website, setWebsite] = useState(
    settings?.website || (scope === 'business' ? 'https://www.cmbrew.com' : ''),
  );
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const running = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function run() {
    if (running.current || !instruction.trim()) return;
    if (!navigator.onLine) {
      setError('Connect to the internet to find references.');
      return;
    }
    running.current = true;
    setBusy('Finding files on your website…');
    setError('');
    setMessage('');
    const saved: string[] = [],
      existing: string[] = [],
      failed: string[] = [];
    try {
      const response = await fetch('/api/reference-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'find', website, instruction }),
        signal: AbortSignal.timeout(150000),
      });
      const result = (await response.json()) as {
        receipt: string;
        items: FoundReference[];
        message?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          result.error || 'Could not find the references. Try again.',
        );
      if (!result.items?.length) {
        setMessage(result.message || 'No matching files were found.');
        return;
      }
      for (const item of result.items) {
        const previous = store.data.records.find(
          (record) =>
            record.kind === 'reference' &&
            record.scope === scope &&
            !record.deletedAt &&
            record.website === item.sourceUrl,
        );
        if (previous) {
          existing.push(previous.title);
          continue;
        }
        try {
          setBusy(`Preparing ${item.title}…`);
          const file = await fetch('/api/reference-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'file',
              receipt: result.receipt,
              id: item.id,
            }),
            signal: AbortSignal.timeout(60000),
          });
          if (!file.ok) {
            const problem = (await file.json()) as { error?: string };
            throw new Error(problem.error || 'Could not download the file.');
          }
          const { pages, original } = await referencePages(
            await file.blob(),
            item.title,
          );
          const entity = createEntity('reference', scope, {
            title: item.title,
            report: false,
            year: String(new Date().getFullYear()),
            website: item.sourceUrl,
            notes: `Source: ${item.sourceUrl}\nFound on: ${website}\nSaved ${now().slice(0, 10)}`,
          });
          await store.addReferenceFiles(
            entity,
            original ? [...pages, original] : pages,
            pages.length,
          );
          saved.push(item.title);
          if (active.current) onAdded();
        } catch (reason) {
          failed.push(`${item.title}: ${(reason as Error).message}`);
        }
      }
      const summary = [
        saved.length ? `Added ${saved.join(' and ')}.` : '',
        existing.length ? `Already on your board: ${existing.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' ');
      setMessage(summary);
      if (saved.length) notify(summary);
      if (failed.length) setError(failed.join('\n'));
      if (!failed.length) setInstruction('');
    } catch (reason) {
      setError(
        (reason as Error).name === 'TimeoutError'
          ? 'The search took too long. Your command is still here; try again.'
          : (reason as Error).message,
      );
    } finally {
      running.current = false;
      setBusy('');
    }
  }
  return (
    <section
      className="reference-assistant"
      aria-label="AI reference assistant"
    >
      <div className="reference-assistant-heading">
        <Sparkles />
        <h2>Add from a website</h2>
        <span>AI</span>
      </div>
      <label className="reference-site">
        Website
        <input
          aria-label="Reference source website"
          type="url"
          value={website}
          disabled={!!busy}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </label>
      <label className="reference-command">
        Tell Launch what to find
        <textarea
          value={instruction}
          disabled={!!busy}
          maxLength={2000}
          placeholder={example}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault();
              void run();
            }
          }}
        />
      </label>
      <div className="reference-assistant-actions">
        <button
          className="text-button"
          disabled={!!busy}
          onClick={() => setInstruction(example)}
        >
          Use menu example
        </button>
        <button
          className="button primary"
          disabled={!!busy || !instruction.trim() || !website.trim()}
          onClick={() => void run()}
        >
          {busy ? <LoaderCircle className="spinning" /> : <ArrowUpRight />}
          {busy || 'Find and add'}
        </button>
      </div>
      <p className="hint">
        Finds linked PDFs, images, and Adobe menus. Original files and source
        links stay with your references.
      </p>
      {message && <output>{message}</output>}
      {error && (
        <p role="alert" className="report-error">
          {error}
        </p>
      )}
      {busy && (
        <output className="hint">
          Keep Launch open while your images are prepared.
        </output>
      )}
    </section>
  );
}
