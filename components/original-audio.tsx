import type { ComponentProps } from 'react';
export function OriginalAudio(props: ComponentProps<'audio'>) {
  // The editable note supplies the transcript. An unprocessed, user-recorded
  // audio-only original has no captions yet; keep native playback available.
  // oxlint-disable-next-line jsx-a11y/media-has-caption
  return <audio controls {...props} />;
}
