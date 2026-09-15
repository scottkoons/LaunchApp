'use client';
import { useEffect, useState, type ComponentProps } from 'react';
import type { LaunchStore } from '@/lib/client-store';

export function OriginalAudio({
  fileId,
  store,
  ...props
}: Omit<ComponentProps<'audio'>, 'src'> & {
  fileId: string;
  store: LaunchStore;
}) {
  const pending = store.data.files.find((file) => file.id === fileId)?.pending;
  const [attempt, setAttempt] = useState(0);
  const sourceKey = `${fileId}:${!!pending}:${attempt}`;
  const [loaded, setLoaded] = useState({ key: '', url: '', error: '' });
  useEffect(() => {
    let cancelled = false;
    let url = '';
    void store.audioUrl(fileId).then(
      (next) => {
        if (cancelled) {
          if (next.startsWith('blob:')) URL.revokeObjectURL(next);
          return;
        }
        url = next;
        setLoaded({ key: sourceKey, url, error: '' });
      },
      (reason: unknown) => {
        if (!cancelled)
          setLoaded({
            key: sourceKey,
            url: '',
            error:
              reason instanceof Error
                ? reason.message
                : 'The recording could not be loaded.',
          });
      },
    );
    return () => {
      cancelled = true;
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [fileId, sourceKey, store]);
  if (loaded.key !== sourceKey) return <output>Loading recording…</output>;
  if (loaded.error)
    return (
      <div>
        <p role="alert">{loaded.error} Your saved note is still available.</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Reload recording
        </button>
      </div>
    );
  // The editable note supplies the transcript for the user's own recording.
  return (
    // oxlint-disable-next-line jsx-a11y/media-has-caption
    <audio
      key={loaded.url}
      controls
      preload="metadata"
      {...props}
      src={loaded.url}
      onError={() =>
        setLoaded((value) => ({
          ...value,
          error: 'Audio playback failed on this device.',
        }))
      }
    />
  );
}
