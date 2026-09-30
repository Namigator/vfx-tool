// URL of an included sprite-library sheet. Relative to the app's base (vite `base: './'`), so it works when the
// editor is served from the site root (dev) and from a sub-folder (e.g. https://host/avi/vfx-tool/). A root-absolute
// "/assets/sprites/..." 404s in the sub-folder case and every textured layer silently disappears.
const BASE: string = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

export function spriteUrl(file: string): string {
  return `${BASE.endsWith('/') ? BASE : `${BASE}/`}assets/sprites/${file}`;
}
