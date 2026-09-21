/** Extract inline key: value facts without including the surrounding prose. */
export function extractSchema(text: string): Record<string, string | number> {
  const entries: [string, string | number][] = [];
  const facts = /(?:^|[\s([{,;])([A-Za-z_][\w-]*):[ \t]*(?![^\s:"]+:)(?:"([^"\n]+)"|([^\s:"{}\[\]]+))/g;

  for (const match of text.matchAll(facts)) {
    // An unfinished entry must not consume the next key or a URL.
    if (text[match.index + match[0].length] === ":") continue;
    const quoted = match[2] !== undefined;
    const value = quoted ? match[2] : match[3].replace(/[.,;!?)}]+$/, "");
    if (!value || (!quoted && value.startsWith("//"))) continue;
    const numeric = !quoted && /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value);
    const number = Number(value.replaceAll(",", ""));
    entries.push([match[1], numeric && Number.isFinite(number) ? number : value]);
  }

  // Last occurrence wins; fromEntries also safely handles keys like __proto__.
  return Object.fromEntries(entries);
}
