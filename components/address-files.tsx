'use client';
import { useEffect, useRef, useState } from 'react';
import {
  UserRound,
  FileText,
  Upload,
  Download,
  Expand,
  Pencil,
  Trash2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { ImageViewer } from './image-viewer';
import { OfficePreview } from './office-preview';
import type { Entity, FileMeta } from '@/lib/model';
import type { LaunchStore } from '@/lib/client-store';

function useFileUrl(id: string, store: LaunchStore, files: FileMeta[]) {
  const pending = files.find((f) => f.id === id)?.pending;
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = id ? store.fileUrl(id) : '';
    setUrl(next);
    return () => {
      if (next.startsWith('blob:')) URL.revokeObjectURL(next);
    };
  }, [id, pending, store]);
  return url;
}
export function AddressPortrait({
  entity,
  store,
  files,
}: {
  entity: Entity;
  store: LaunchStore;
  files: FileMeta[];
}) {
  const url = useFileUrl(entity.portraitId || '', store, files);
  const [failed, setFailed] = useState('');
  return (
    <span
      className={
        'address-portrait ' +
        (entity.kind === 'company' ? 'company-portrait' : '')
      }
    >
      {url && failed !== url ? (
        <img
          src={url}
          alt={
            entity.title ||
            (entity.kind === 'company' ? 'Company logo' : 'Contact photo')
          }
          onError={() => setFailed(url)}
        />
      ) : entity.kind === 'company' ? (
        <span>
          {entity.title
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((word) => word[0])
            .join('')
            .toUpperCase() || '—'}
        </span>
      ) : (
        <UserRound />
      )}
    </span>
  );
}
export function AddressFiles({
  entity,
  store,
  files,
  editing,
  disabled,
  onChange,
  onBusy,
  notify,
}: {
  entity: Entity;
  store: LaunchStore;
  files: FileMeta[];
  editing: boolean;
  disabled: boolean;
  onChange: (patch: Partial<Entity>) => void;
  onBusy: (busy: boolean) => void;
  notify: (text: string) => void;
}) {
  const ids = entity.files.filter((id) => id !== entity.portraitId);
  const picker = useRef<HTMLInputElement>(null);
  const adding = useRef(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState('');
  async function add(selected: File[]) {
    if (!selected.length || adding.current || disabled) return;
    adding.current = true;
    setBusy(true);
    onBusy(true);
    try {
      const added = await store.addFiles(selected);
      onChange({ files: [...entity.files, ...added] });
    } catch (error) {
      notify((error as Error).message);
    } finally {
      adding.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  if (!editing && !ids.length) return null;
  return (
    <section className="address-attachments">
      <h2>{editing ? 'ATTACHMENTS' : 'Attachments'}</h2>
      <div className="address-file-grid">
        {ids.map((id) => (
          <AddressFile
            key={id}
            id={id}
            file={files.find((f) => f.id === id)}
            label={entity.fileLabels?.[id]}
            store={store}
            files={files}
            editing={editing}
            disabled={disabled || busy}
            onPreview={() => setPreview(id)}
            onRename={(label) =>
              onChange({ fileLabels: { ...entity.fileLabels, [id]: label } })
            }
            onRemove={() =>
              onChange({
                files: entity.files.filter((f) => f !== id),
                fileLabels: Object.fromEntries(
                  Object.entries(entity.fileLabels || {}).filter(
                    ([key]) => key !== id,
                  ),
                ),
              })
            }
          />
        ))}
      </div>
      {editing && (
        <>
          <button
            type="button"
            className="address-dropzone"
            disabled={disabled || busy}
            onClick={() => picker.current?.click()}
            onPaste={(event) => {
              if (event.clipboardData.files.length) {
                event.preventDefault();
                void add(Array.from(event.clipboardData.files));
              }
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void add(Array.from(event.dataTransfer.files));
            }}
          >
            <Upload />{' '}
            {busy ? 'Saving files…' : 'Drop files, click, or paste (⌘V)'}
          </button>
          <small className="hint">
            Photos, PDF, Word, Excel · up to 20 MB per file
          </small>
          <input
            ref={picker}
            type="file"
            hidden
            multiple
            onChange={(event) => {
              void add(Array.from(event.target.files || []));
              event.target.value = '';
            }}
          />
        </>
      )}
      {preview && (
        <AddressFilePreview
          id={preview}
          store={store}
          files={files}
          label={entity.fileLabels?.[preview]}
          onClose={() => setPreview('')}
        />
      )}
    </section>
  );
}
function AddressFile({
  id,
  file,
  label,
  store,
  files,
  editing,
  disabled,
  onPreview,
  onRename,
  onRemove,
}: {
  id: string;
  file?: FileMeta;
  label?: string;
  store: LaunchStore;
  files: FileMeta[];
  editing: boolean;
  disabled: boolean;
  onPreview: () => void;
  onRename: (value: string) => void;
  onRemove: () => void;
}) {
  const url = useFileUrl(id, store, files);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const display = label || file?.name || 'Attachment';
  const cancelled = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) {
      nameInput.current?.focus();
      nameInput.current?.select();
    }
  }, [renaming]);
  function finish() {
    if (!cancelled.current && name.trim()) onRename(name.trim());
    setRenaming(false);
  }
  return (
    <article className="address-file">
      <div className="address-file-image">
        <button
          type="button"
          onClick={onPreview}
          aria-label={`Expand ${display}`}
        >
          {file?.type.startsWith('image/') ? (
            <img src={url} alt={display} />
          ) : (
            <FileText />
          )}
        </button>
        <div className="address-file-actions">
          <button
            type="button"
            aria-label={`Preview ${display}`}
            onClick={onPreview}
          >
            <Expand />
          </button>
          <a
            href={url + (url.startsWith('blob:') ? '' : '?download=1')}
            download={file?.name}
            aria-label={`Download ${display}`}
          >
            <Download />
          </a>
          {editing && (
            <button
              type="button"
              aria-label={`Remove ${display}`}
              disabled={disabled}
              onClick={onRemove}
            >
              <Trash2 />
            </button>
          )}
        </div>
      </div>
      <div className="address-file-name">
        {renaming ? (
          <input
            aria-label="Attachment name"
            ref={nameInput}
            value={name}
            maxLength={500}
            onChange={(e) => setName(e.target.value)}
            onBlur={finish}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                finish();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancelled.current = true;
                setRenaming(false);
              }
            }}
          />
        ) : (
          <>
            <span title={display}>{display}</span>
            {editing && (
              <button
                type="button"
                disabled={disabled}
                aria-label={`Rename ${display}`}
                onClick={() => {
                  cancelled.current = false;
                  setName(display);
                  setRenaming(true);
                }}
              >
                <Pencil />
              </button>
            )}
          </>
        )}
      </div>
      <small>
        {file?.pending
          ? 'Waiting to sync'
          : file
            ? `${Math.max(1, Math.round(file.size / 1024))} KB`
            : ''}
      </small>
    </article>
  );
}
function AddressFilePreview({
  id,
  store,
  files,
  label,
  onClose,
}: {
  id: string;
  store: LaunchStore;
  files: FileMeta[];
  label?: string;
  onClose: () => void;
}) {
  const file = files.find((f) => f.id === id);
  const url = useFileUrl(id, store, files);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={
          'file-dialog' +
          (file?.type.startsWith('image/') ? ' image-file-dialog' : '')
        }
      >
        <DialogTitle>{label || file?.name || 'Attachment'}</DialogTitle>
        <DialogDescription>Original attachment</DialogDescription>
        {file?.type.startsWith('image/') ? (
          <ImageViewer src={url} alt={label || file.name} active />
        ) : file?.type === 'application/pdf' ? (
          <iframe src={url} title={label || file.name} />
        ) : /\.(docx|xlsx|xls|csv)$/i.test(file?.name || '') ? (
          <OfficePreview url={url} name={file!.name} />
        ) : (
          <p>Download this document to open it in its usual app.</p>
        )}
        <a
          className="button"
          href={url + (url.startsWith('blob:') ? '' : '?download=1')}
          download={file?.name}
        >
          <Download /> Download original
        </a>
      </DialogContent>
    </Dialog>
  );
}
