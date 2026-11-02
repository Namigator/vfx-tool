/** localStorage key set once the first-visit intro has run (or been skipped). */
export const INTRO_SEEN_KEY = 'vfx-intro-seen-v1';

/** True on a visitor's first open: no saved draft, no document URL, intro not seen, and not turned off by ?intro=0. */
export function shouldShowIntro(storage: Pick<Storage, 'getItem'> | undefined, search: string, hasDraft: boolean): boolean {
  const q = new URLSearchParams(search);
  if (hasDraft || q.get('doc') || q.get('demo') || q.get('intro') === '0') return false;
  try { return !storage?.getItem(INTRO_SEEN_KEY); } catch { return false; }
}
