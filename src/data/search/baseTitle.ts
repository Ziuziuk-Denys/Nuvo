const EXTENSIONS = /\.(flac|ogg|m4a|aac|wav|mp3)\b/gi;
const FEATURING = "(?:feat\\.?|ft\\.?|featuring)";
const BRACKETED_FEATURING = new RegExp(`[([{]\\s*(?:${FEATURING}|with)\\s[^)\\]}]*[)\\]}]`, "gi");
const LOOSE_FEATURING = new RegExp(`(^|\\s)${FEATURING}\\s.*?(?=[([{]|\\s[-–—]|[-–—]\\s|$)`, "i");
const DASH_QUALIFIER =
  /\s*[-–—]\s+(?:mono|stereo|remaster(?:ed)?(?:\s+\d{4})?|ремастер\S*|live(?:\s+at\b.*)?|acoustic|instrumental|radio edit|single version|original mix|album version)\b.*$/i;

const MARKER_WORDS = new Set([
  "remix",
  "remixed",
  "rmx",
  "ремикс",
  "vip",
  "flip",
  "флип",
  "bootleg",
  "бутлег",
  "mashup",
  "мэшап",
  "мешап",
  "edit",
  "эдит",
  "slowed",
  "слоу",
  "reverb",
  "реверб",
  "spedup",
  "speedup",
  "спидап",
  "nightcore",
  "найткор",
  "instrumental",
  "inst",
  "инструментал",
  "acoustic",
  "акустика",
  "live",
  "лайв",
  "концерт",
  "cover",
  "кавер",
]);
const MARKER_PHRASES = [
  ["v", "i", "p"],
  ["mash", "up"],
  ["radio", "edit"],
  ["club", "edit"],
  ["extended", "edit"],
  ["sped", "up"],
  ["speed", "up"],
  ["спид", "ап"],
  ["bass", "boost"],
  ["bass", "boosted"],
  ["басс", "буст"],
];

export function compareForm(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function withoutMarkers(words: string[]): string[] {
  const kept: string[] = [];
  for (let index = 0; index < words.length;) {
    const phrase = MARKER_PHRASES.find((parts) => parts.every((part, offset) => words[index + offset] === part));
    if (phrase) index += phrase.length;
    else if (MARKER_WORDS.has(words[index])) index += 1;
    else kept.push(words[index++]);
  }
  return kept;
}

export function baseTitle(raw: string): string {
  const text = raw.replace(EXTENSIONS, " ").replace(BRACKETED_FEATURING, " ").replace(LOOSE_FEATURING, "$1").replace(DASH_QUALIFIER, "");
  const words = compareForm(text).split(" ").filter(Boolean);
  return withoutMarkers(words).join(" ");
}
