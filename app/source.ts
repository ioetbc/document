/** Source values are single tokens; URL-like tokens must be HTTP(S) URLs. */
export function isValidSource(source: unknown): source is string {
  if (typeof source !== "string" || !source || /\s/.test(source)) return false;
  if (/^[a-z][a-z\d+.-]*:|^\/\/|^www\.|^[^/]+\.[^/]+(?:\/|$)/i.test(source)) {
    if (!/^https?:\/\//i.test(source)) return false;
    try {
      const url = new URL(source);
      return !!url.hostname && ["http:", "https:"].includes(url.protocol);
    } catch {
      return false;
    }
  }
  return true;
}
