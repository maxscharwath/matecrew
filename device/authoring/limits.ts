/** DUI1 protocol limits, mirrored by engine/src/limits.rs. */
export const LIMITS = {
  bytes: 64 * 1024,
  viewport: 4096,
  depth: 16,
  nodes: 256,
  actions: 256,
  resources: 16,
  strings: 4096,
  values: 4096,
  localState: 8 * 1024,
} as const;

export function validIdentifier(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(id) && id !== "__proto__";
}

export function validApiPath(path: string): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    new TextEncoder().encode(path).length <= 256 &&
    !/[\\\u0000-\u0020\u007f]/.test(path)
  );
}

/** Web images use public HTTPS URLs or authenticated paths on the device's API origin. */
export function validImageSource(src: string): boolean {
  if (validApiPath(src)) return !src.includes("#");
  if (src.length > 1024 || /[\\\u0000-\u0020\u007f]/.test(src)) return false;
  return /^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:[/?][^#]*)?$/.test(src);
}
