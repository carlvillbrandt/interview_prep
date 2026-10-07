/**
 * Removes Phoenix emotion tags from interviewer text before it is shown or scored.
 * Documented form: `<emotion value="content"/>`. LLMs following a "begin with an emotion
 * tag" instruction sometimes emit variants (`<content>`, `[neutral]`, a bare leading word),
 * so those are stripped too. Safe to import from client components.
 */

export const EMOTIONS = [
  "neutral",
  "angry",
  "excited",
  "elated",
  "content",
  "sad",
  "dejected",
  "scared",
  "contempt",
  "disgusted",
  "surprised",
] as const;

const E = EMOTIONS.join("|");
const XML_TAG = /<\s*emotion\b[^>]*\/?\s*>/gi;
const ANGLE_WORD = new RegExp(`<\\s*/?\\s*(?:${E})\\s*/?\\s*>`, "gi");
const BRACKET_WORD = new RegExp(`[\\[(]\\s*(?:emotion\\s*[:=]\\s*)?(?:${E})\\s*[\\])]`, "gi");
// A bare tag at the very start, e.g. "neutral Hi there" or "content: Thanks". Lowercase only,
// so a sentence that genuinely starts with "Content…" is left alone.
const LEADING_BARE = new RegExp(`^\\s*(?:${E})(?:\\s*[:\\-–]\\s*|\\s+)(?=\\S)`);

export function stripEmotionTags(text: string): string {
  return text
    .replace(XML_TAG, " ")
    .replace(ANGLE_WORD, " ")
    .replace(BRACKET_WORD, " ")
    .replace(LEADING_BARE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
