/**
 * Returns the correct path for a file in the `public/` directory.
 *
 * In dev mode `BASE_URL` is `/`, so this returns `/commander-icon.png`.
 * In Commander Electron builds `BASE_URL` is `./`, so this returns `./commander-icon.png`,
 * which resolves correctly from `file://` protocol.
 */
export function publicAsset(path: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  // Strip leading slash from path to avoid double-slash
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${base}${cleanPath}`;
}
