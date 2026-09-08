'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Upload, Download, FileText, Camera, X } from 'lucide-react';
import type { LaunchStore } from '@/lib/client-store';
import type { FileMeta } from '@/lib/model';
export function Pick({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (s: string) => void;
  options: [string, string][];
  label: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => v !== null && onChange(String(v))}
      items={options.map(([value, label]) => ({ value, label }))}
    >
      <SelectTrigger aria-label={label} className="pick">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem value={v} key={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="toggle">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v)} />
      <span>{children}</span>
    </label>
  );
}
export function Attachments({
  ids,
  store,
  files,
  onChange,
  notify,
  readOnly = false,
}: {
  ids: string[];
  store: LaunchStore;
  files: FileMeta[];
  onChange: (ids: string[]) => void;
  notify: (s: string) => void;
  readOnly?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false),
    [preview, setPreview] = useState<FileMeta | null>(null),
    [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const idsKey = ids.join(',');
  const uploadKey = files
    .filter((f) => ids.includes(f.id))
    .map((f) => f.pending)
    .join(',');
  useEffect(() => {
    const next = Object.fromEntries(
      idsKey
        .split(',')
        .filter(Boolean)
        .map((id) => [id, store.fileUrl(id)]),
    );
    setUrls(next);
    return () =>
      Object.values(next).forEach((url) => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      });
  }, [idsKey, uploadKey, store]);
  async function add(list: File[]) {
    if (!list.length) return;
    setBusy(true);
    try {
      const added = await store.addFiles(list);
      onChange([...ids, ...added]);
      notify('Files saved on this device.');
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="attachments">
      {!readOnly && (
        <>
          <button
            type="button"
            className={'dropzone ' + (drag ? 'dragging' : '')}
            aria-label="Upload, paste, or drop attachments"
            onClick={() => input.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') input.current?.click();
            }}
            onPaste={(e) => {
              const fs = Array.from(e.clipboardData.files);
              if (fs.length) {
                e.preventDefault();
                void add(fs);
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void add(Array.from(e.dataTransfer.files));
            }}
          >
            <Upload />
            <strong>
              {busy ? 'Saving files…' : 'Drop, paste, or choose files'}
            </strong>
            <span>Photos, documents, screenshots · up to 20 MB each</span>
          </button>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void add(Array.from(e.target.files || []));
              e.target.value = '';
            }}
          />
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              void add(Array.from(e.target.files || []));
              e.target.value = '';
            }}
          />
          <button
            className="text-button camera-action"
            onClick={() => camera.current?.click()}
          >
            <Camera />
            Take a photo
          </button>
        </>
      )}
      {ids.length > 0 && (
        <div className="file-list">
          {ids.map((id) => {
            const file = files.find((f) => f.id === id);
            return (
              <div className="file-item" key={id}>
                <button
                  className="file-preview"
                  onClick={() => file && setPreview(file)}
                >
                  {file?.type.startsWith('image/') ? (
                    <img src={urls[id]} alt={file.name} />
                  ) : (
                    <FileText />
                  )}
                  <span>
                    {file?.name || 'Attachment'}
                    <small>
                      {file?.pending
                        ? 'Waiting to sync'
                        : file
                          ? `${Math.max(1, Math.round(file.size / 1024))} KB`
                          : ''}
                    </small>
                  </span>
                </button>
                <a
                  href={
                    urls[id] +
                    (urls[id]?.startsWith('blob:') ? '' : '?download=1')
                  }
                  download={file?.name}
                  className="icon-button"
                  aria-label={`Download ${file?.name || 'file'}`}
                >
                  <Download />
                </a>
                {!readOnly && (
                  <button
                    className="icon-button"
                    aria-label={`Remove ${file?.name || 'file'}`}
                    onClick={() => onChange(ids.filter((x) => x !== id))}
                  >
                    <X />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(open) => !open && setPreview(null)}
      >
        <DialogContent className="file-dialog">
          <DialogTitle>{preview?.name}</DialogTitle>
          <DialogDescription>Original attachment</DialogDescription>
          {preview?.type.startsWith('image/') ? (
            <img src={urls[preview.id]} alt={preview.name} />
          ) : preview?.type === 'application/pdf' ? (
            <iframe src={urls[preview.id]} title={preview.name} />
          ) : (
            <p>
              This document can be opened in its usual app after downloading.
            </p>
          )}
          {preview && (
            <a
              className="button"
              href={
                urls[preview.id] +
                (urls[preview.id]?.startsWith('blob:') ? '' : '?download=1')
              }
              download={preview.name}
            >
              <Download />
              Download original
            </a>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
