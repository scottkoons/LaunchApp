'use client';
import { useEffect } from 'react';

// Without a boundary, one render error blanks the whole app. Queued work and
// drafts live in IndexedDB and localStorage, so reloading is safe.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main
      role="alert"
      style={{
        display: 'grid',
        gap: '1rem',
        maxWidth: '28rem',
        margin: '20vh auto',
        padding: '0 1rem',
        textAlign: 'center',
      }}
    >
      <h1>Launch hit a problem</h1>
      <p>Your saved and queued changes are still on this device.</p>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
        <button type="button" onClick={reset}>
          Try again
        </button>
        <button type="button" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    </main>
  );
}
