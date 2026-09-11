'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  FileText,
  Folder,
  Image as ImageIcon,
  Lightbulb,
  Link,
  Star,
  Tag,
  Upload,
  RotateCcw,
} from 'lucide-react';
import {
  referenceIcons,
  type Entity,
  type FileMeta,
  type ReferenceIcon,
} from '@/lib/model';
import { prepareReferenceThumbnail, referenceImage } from '@/lib/reference';
import type { LaunchStore } from '@/lib/client-store';

const icons = {
  file: { label: 'Document', component: FileText },
  bookmark: { label: 'Bookmark', component: Bookmark },
  star: { label: 'Star', component: Star },
  idea: { label: 'Idea', component: Lightbulb },
  image: { label: 'Picture', component: ImageIcon },
  link: { label: 'Link', component: Link },
  folder: { label: 'Folder', component: Folder },
  tag: { label: 'Tag', component: Tag },
} satisfies Record<ReferenceIcon, unknown>;

export function useStoredFileUrl(store: LaunchStore, file?: FileMeta) {
  const [source, setSource] = useState({ id: '', url: '' });
  const id = file?.id;
  const pending = file?.pending;
  useEffect(() => {
    const url = id ? store.fileUrl(id) : '';
    setSource({ id: id || '', url });
    return () => {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [id, pending, store]);
  return source.id === id ? source.url : '';
}

export function ReferenceThumbnail({
  entity,
  files,
  store,
}: {
  entity: Entity;
  files: FileMeta[];
  store: LaunchStore;
}) {
  const file = referenceImage(entity, files);
  const url = useStoredFileUrl(store, file);
  const [failedUrl, setFailedUrl] = useState('');
  const icon =
    entity.thumbnail?.type === 'icon' ? entity.thumbnail.icon : 'file';
  const Icon = icons[icon]?.component || FileText;
  return url && url !== failedUrl ? (
    <img
      src={url}
      alt=""
      className={
        entity.thumbnail?.type === 'image'
          ? 'custom-thumbnail-image'
          : undefined
      }
      onError={() => setFailedUrl(url)}
    />
  ) : (
    <Icon aria-hidden="true" />
  );
}

export function ReferenceThumbnailEditor({
  entity,
  files,
  store,
  onChange,
  disabled,
  onBusyChange,
}: {
  entity: Entity;
  files: FileMeta[];
  store: LaunchStore;
  onChange: (patch: Partial<Entity>) => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const adding = useRef(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  async function upload(list: File[]) {
    if (disabled || adding.current || !list.length) return;
    if (list.length !== 1) {
      setError('Choose one image for the thumbnail.');
      return;
    }
    adding.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      const file = await prepareReferenceThumbnail(list[0]);
      const [fileId] = await store.addFiles([file]);
      onChange({ thumbnail: { type: 'image', fileId } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      adding.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="thumbnail-editor" aria-label="Board thumbnail">
      <div className="thumbnail-heading">
        <h3>Board thumbnail</h3>
        <span>{entity.thumbnail ? 'Custom' : 'Default'}</span>
      </div>
      <div
        className="reference-thumb thumbnail-preview"
        aria-label="Thumbnail preview"
      >
        <ReferenceThumbnail entity={entity} files={files} store={store} />
      </div>
      <button
        type="button"
        className={'thumbnail-dropzone' + (drag ? ' dragging' : '')}
        disabled={disabled || busy}
        aria-label="Upload, paste, or drop a thumbnail image"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !busy) setDrag(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setDrag(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDrag(false);
          void upload(Array.from(e.dataTransfer.files));
        }}
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault();
            e.stopPropagation();
            void upload(Array.from(e.clipboardData.files));
          }
        }}
      >
        <Upload aria-hidden="true" />
        <strong>
          {busy
            ? 'Preparing thumbnail…'
            : entity.thumbnail?.type === 'image'
              ? 'Replace image'
              : 'Choose an image'}
        </strong>
        <span>Or drop or paste one here</span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*,.ico"
        hidden
        disabled={disabled || busy}
        onChange={(e) => {
          void upload(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />
      {error && (
        <p className="thumbnail-error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">A photo, screenshot, or icon · up to 20 MB</p>
      <div className="thumbnail-icon-label">Or choose an icon</div>
      <fieldset className="thumbnail-icons" aria-label="Thumbnail icons">
        {referenceIcons.map((key) => {
          const { label, component: Icon } = icons[key];
          return (
            <button
              key={key}
              type="button"
              aria-label={`${label} icon`}
              title={label}
              aria-pressed={
                entity.thumbnail?.type === 'icon' &&
                entity.thumbnail.icon === key
              }
              disabled={disabled || busy}
              onClick={() => {
                setError('');
                onChange({ thumbnail: { type: 'icon', icon: key } });
              }}
            >
              <Icon aria-hidden="true" />
            </button>
          );
        })}
      </fieldset>
      {entity.thumbnail && (
        <button
          type="button"
          className="text-button thumbnail-reset"
          disabled={disabled || busy}
          onClick={() => {
            setError('');
            onChange({ thumbnail: null });
          }}
        >
          <RotateCcw aria-hidden="true" /> Use default
        </button>
      )}
      <p className="hint">
        The default uses your original image or the document icon.
      </p>
    </section>
  );
}
