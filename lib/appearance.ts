export const APPEARANCES = [
  { value: 'liquid', label: 'Liquid Display' },
  { value: 'space', label: 'Space' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
] as const;

export type Appearance = (typeof APPEARANCES)[number]['value'];

// Keep iPhone preferences separate so existing installs receive the new default,
// without changing the desktop preference or overwriting a later phone choice.
export function appearanceKey(userAgent: string) {
  return /iPhone|iPod/i.test(userAgent)
    ? 'launch-iphone-theme'
    : 'launch-theme';
}

export function resolveAppearance(
  userAgent: string,
  saved: string | null,
): Appearance {
  return APPEARANCES.some(({ value }) => value === saved)
    ? (saved as Appearance)
    : /iPhone|iPod/i.test(userAgent)
      ? 'liquid'
      : 'space';
}

// Runs before first paint, including on installed PWAs. The React shell reads
// the same selection during hydration. Storage can be unavailable in Safari.
export const appearanceBootstrap = `(() => {
  const phone = /iPhone|iPod/i.test(navigator.userAgent);
  let theme = phone ? 'liquid' : 'space';
  try {
    const saved = localStorage.getItem(phone ? 'launch-iphone-theme' : 'launch-theme');
    if (${JSON.stringify(APPEARANCES.map(({ value }) => value))}.includes(saved)) theme = saved;
  } catch {}
  document.documentElement.dataset.theme = theme;
})();`;
