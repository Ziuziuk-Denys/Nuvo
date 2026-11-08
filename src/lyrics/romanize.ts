/**
 * Romanized lyrics for Korean (Revised Romanization, own algorithm), Chinese (pinyin without
 * tones, through tiny-pinyin) and the kana of Japanese (Hepburn, own table). Kanji stays as
 * written: its reading depends on the word, and the offline analysers that know it carry a
 * dictionary of 12 MB or more, far over the size budget.
 */
import * as pinyin from "tiny-pinyin";

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;

const ONSETS = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const VOWELS = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];

interface Final {
  /** What stays at the end of the syllable when a vowel follows and a consonant moves on. */
  keep: string;
  /** The sound at a word end or before a consonant. */
  coda: string;
  /** The onset it gives the next syllable when that starts with a vowel; null for "ng", which never moves. */
  link: string | null;
}

const NO_FINAL: Final = { keep: "", coda: "", link: "" };

// index 0 is "no final"; the order is the Unicode order of final consonants
const FINALS: Final[] = [
  NO_FINAL,
  { keep: "", coda: "k", link: "g" },
  { keep: "", coda: "k", link: "kk" },
  { keep: "k", coda: "k", link: "s" },
  { keep: "", coda: "n", link: "n" },
  { keep: "n", coda: "n", link: "j" },
  { keep: "n", coda: "n", link: "" },
  { keep: "", coda: "t", link: "d" },
  { keep: "", coda: "l", link: "r" },
  { keep: "l", coda: "k", link: "g" },
  { keep: "l", coda: "m", link: "m" },
  { keep: "l", coda: "l", link: "b" },
  { keep: "l", coda: "l", link: "s" },
  { keep: "l", coda: "l", link: "t" },
  { keep: "l", coda: "p", link: "p" },
  { keep: "l", coda: "l", link: "" },
  { keep: "", coda: "m", link: "m" },
  { keep: "", coda: "p", link: "b" },
  { keep: "p", coda: "p", link: "s" },
  { keep: "", coda: "t", link: "s" },
  { keep: "", coda: "t", link: "ss" },
  { keep: "", coda: "ng", link: null },
  { keep: "", coda: "t", link: "j" },
  { keep: "", coda: "t", link: "ch" },
  { keep: "", coda: "k", link: "k" },
  { keep: "", coda: "t", link: "t" },
  { keep: "", coda: "p", link: "p" },
  { keep: "", coda: "t", link: "" },
];

const NASAL: Record<string, string> = { k: "ng", t: "n", p: "m" };

interface Syllable {
  onset: string;
  vowel: string;
  final: Final;
}

function syllableOf(char: string): Syllable | null {
  const code = char.codePointAt(0) ?? 0;
  if (code < HANGUL_FIRST || code > HANGUL_LAST) return null;
  const index = code - HANGUL_FIRST;
  return { onset: ONSETS[Math.floor(index / 588)], vowel: VOWELS[Math.floor((index % 588) / 28)], final: FINALS[index % 28] };
}

/** One run of Hangul syllables with no break between them. */
function romanizeRun(syllables: Syllable[]): string {
  let out = "";
  let carried: string | null = null;
  syllables.forEach((syllable, at) => {
    let onset = syllable.onset;
    if (carried !== null && onset === "") onset = carried;
    carried = null;
    const next = syllables[at + 1];
    const final = syllable.final;
    let coda = final.coda;
    if (next && next.onset === "" && final.link !== null) {
      // a vowel follows: the last consonant moves over and starts the next syllable
      coda = final.keep;
      carried = final.link;
    } else if (next) {
      const following = next.onset;
      let adjusted = following;
      if (NASAL[coda] && (following === "n" || following === "m" || following === "r")) {
        coda = NASAL[coda];
        if (following === "r") adjusted = "n";
      } else if ((coda === "m" || coda === "ng") && following === "r") {
        adjusted = "n";
      } else if (coda === "n" && following === "r") {
        coda = "l";
        adjusted = "l";
      } else if (coda === "l" && (following === "n" || following === "r")) {
        adjusted = "l";
      }
      if (adjusted !== following) next.onset = adjusted;
    }
    out += onset + syllable.vowel + coda;
  });
  return out;
}

/** Revised Romanization of the Hangul in `text`; everything else stays. A space or a mark ends a word. */
export function romanizeKorean(text: string): string {
  let out = "";
  let run: Syllable[] = [];
  const flush = () => {
    if (run.length > 0) out += romanizeRun(run);
    run = [];
  };
  for (const char of text) {
    const syllable = syllableOf(char);
    if (syllable) {
      // the table is shared, so a run works on its own copy
      run.push({ ...syllable });
    } else {
      flush();
      out += char;
    }
  }
  flush();
  return out;
}

/** Pinyin without tones, a space between syllables and next to words; other text stays as it is. */
export function romanizeChinese(text: string): string {
  const letter = /^[\p{L}\p{N}]/u;
  let out = "";
  let afterHan = false;
  for (const part of pinyin.parse(text)) {
    if (part.type !== 2) {
      if (afterHan && letter.test(part.source)) out += " ";
      out += part.source;
      afterHan = false;
      continue;
    }
    if (out && letter.test(out.slice(-1))) out += " ";
    out += part.target.toLowerCase();
    afterHan = true;
  }
  return out;
}

// Hepburn for each hiragana syllable; katakana is read through the same table.
const KANA_ROMAJI: Record<string, string> = Object.fromEntries(
  (
    "あa いi うu えe おo かka きki くku けke こko さsa しshi すsu せse そso たta ちchi つtsu てte とto " +
    "なna にni ぬnu ねne のno はha ひhi ふfu へhe ほho まma みmi むmu めme もmo やya ゆyu よyo " +
    "らra りri るru れre ろro わwa ゐi ゑe をo んn がga ぎgi ぐgu げge ごgo ざza じji ずzu ぜze ぞzo " +
    "だda ぢji づzu でde どdo ばba びbi ぶbu べbe ぼbo ぱpa ぴpi ぷpu ぺpe ぽpo ゔvu " +
    "ぁa ぃi ぅu ぇe ぉo ゃya ゅyu ょyo ゎwa ゕka ゖke " +
    "きゃkya きゅkyu きょkyo しゃsha しゅshu しょsho ちゃcha ちゅchu ちょcho にゃnya にゅnyu にょnyo " +
    "ひゃhya ひゅhyu ひょhyo みゃmya みゅmyu みょmyo りゃrya りゅryu りょryo ぎゃgya ぎゅgyu ぎょgyo " +
    "じゃja じゅju じょjo ぢゃja ぢゅju ぢょjo びゃbya びゅbyu びょbyo ぴゃpya ぴゅpyu ぴょpyo " +
    "しぇshe ちぇche じぇje てぃti でぃdi とぅtu どぅdu ふぁfa ふぃfi ふぇfe ふぉfo うぃwi うぇwe うぉwo " +
    "ゔぁva ゔぃvi ゔぇve ゔぉvo つぁtsa つぃtsi つぇtse つぉtso いぇye"
  )
    .split(" ")
    .map((pair) => [pair.slice(0, /^.[ぁぃぅぇぉゃゅょゎ]/.test(pair) ? 2 : 1), pair.replace(/^[぀-ゟ]+/, "")]),
);

const KATAKANA_FIRST = 0x30a1;
const KATAKANA_LAST = 0x30f6;

const toHiragana = (char: string) => {
  const code = char.codePointAt(0)!;
  return code >= KATAKANA_FIRST && code <= KATAKANA_LAST ? String.fromCodePoint(code - 0x60) : char;
};

/**
 * Hepburn for the kana in `text`: っ doubles the next consonant, ー lengthens the vowel, ん before a vowel
 * or y is n'. Kanji and everything else stay as written, a space set between kana and other letters.
 */
export function romanizeKana(text: string): string {
  const chars = [...text];
  const letter = /^[\p{L}\p{N}]/u;
  let out = "";
  let afterKana = false;
  let double = false;
  let afterN = false;
  for (let index = 0; index < chars.length; index += 1) {
    const char = toHiragana(chars[index]);
    if (char === "っ") {
      double = true;
      continue;
    }
    if (char === "ー" && afterKana) {
      out += /[aeiou]$/.test(out) ? out.slice(-1) : "";
      continue;
    }
    const two = KANA_ROMAJI[char + toHiragana(chars[index + 1] ?? "")];
    const syllable = two ?? KANA_ROMAJI[char];
    if (syllable === undefined) {
      if (afterKana && letter.test(char)) out += " ";
      out += chars[index];
      afterKana = double = afterN = false;
      continue;
    }
    if (two !== undefined) index += 1;
    if (!afterKana && out && letter.test(out.slice(-1))) out += " ";
    if (afterN && /^[aeiouy]/.test(syllable)) out += "'";
    out += double ? (syllable.startsWith("ch") ? "t" : syllable[0]) + syllable : syllable;
    afterN = char === "ん";
    double = false;
    afterKana = true;
  }
  return out;
}

const KANA = /[぀-ヿㇰ-ㇿ]/;
const HANGUL = /[가-힣]/;
const HAN = /[㐀-鿿]/;

/**
 * The romanizer for a whole song, chosen from all its lines: any kana makes it Japanese (kana only),
 * else Hangul makes it Korean, else Han makes it Chinese. Deciding per song keeps kanji-only
 * lines of a Japanese song from getting a Chinese reading.
 */
export function romanizerFor(texts: readonly string[]): ((text: string) => string) | null {
  const all = texts.join("\n");
  if (KANA.test(all)) return romanizeKana;
  if (HANGUL.test(all)) return romanizeKorean;
  if (HAN.test(all) && pinyin.isSupported()) return romanizeChinese;
  return null;
}
