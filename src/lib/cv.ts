/** CV text helpers (server-side). */

export const CV_MAX_CHARS = 12_000;

/** Normalises extracted CV text and caps its length. */
export function cleanCvText(raw: string, maxChars = CV_MAX_CHARS): { text: string; truncated: boolean } {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  return text.length > maxChars ? { text: text.slice(0, maxChars), truncated: true } : { text, truncated: false };
}
