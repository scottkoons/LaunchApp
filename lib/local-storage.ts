// localStorage throws when it is full, disabled, or blocked (private mode).
// These values are conveniences, so a failure must never break the app.
export function readLocal(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Keep working without the saved preference. */
  }
}
export function removeLocal(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Nothing to remove when storage is unavailable. */
  }
}
