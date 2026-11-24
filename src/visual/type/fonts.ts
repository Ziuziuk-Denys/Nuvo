import archivo from "./fonts/archivo.woff2?url";
import arimoCyrillic from "./fonts/arimo-cyrillic.woff2?url";
import arimo from "./fonts/arimo.woff2?url";
import cormorantCyrillic from "./fonts/cormorant-italic-cyrillic.woff2?url";
import instrumentSans from "./fonts/instrument-sans.woff2?url";
import instrumentSerif from "./fonts/instrument-serif-italic.woff2?url";
import manropeCyrillic from "./fonts/manrope-cyrillic.woff2?url";
import marckCyrillic from "./fonts/marck-script-cyrillic.woff2?url";
import nunitoCyrillic from "./fonts/nunito-cyrillic.woff2?url";
import nunito from "./fonts/nunito.woff2?url";
import oswaldCyrillic from "./fonts/oswald-cyrillic.woff2?url";
import pinyon from "./fonts/pinyon-script.woff2?url";

const CYRILLIC = "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116";

// faces of one family merge into one font only when these are identical, or one face hides the other
const STYLES = {
  "Nuvo Sans": { weight: "400 700" },
  "Nuvo Condensed": { weight: "100 900", stretch: "62% 125%" },
  "Nuvo Serif": { weight: "400 700", style: "italic" },
  "Nuvo Neutral": { weight: "400 700" },
  "Nuvo Rounded": { weight: "800 900" },
  "Nuvo Script": {},
} satisfies Record<string, FontFaceDescriptors>;

// the Latin faces have no Cyrillic, so a close Cyrillic face joins each family for those letters only
const FACES: [keyof typeof STYLES, string, string?][] = [
  ["Nuvo Sans", instrumentSans],
  ["Nuvo Sans", manropeCyrillic, CYRILLIC],
  ["Nuvo Condensed", archivo],
  ["Nuvo Condensed", oswaldCyrillic, CYRILLIC],
  ["Nuvo Serif", instrumentSerif],
  ["Nuvo Serif", cormorantCyrillic, CYRILLIC],
  ["Nuvo Neutral", arimo],
  ["Nuvo Neutral", arimoCyrillic, CYRILLIC],
  ["Nuvo Rounded", nunito],
  ["Nuvo Rounded", nunitoCyrillic, CYRILLIC],
  ["Nuvo Script", pinyon],
  ["Nuvo Script", marckCyrillic, CYRILLIC],
];

let loading: Promise<void> | null = null;

export function loadVisualFonts(): Promise<void> {
  loading ??= Promise.all(
    FACES.map(async ([family, url, unicodeRange]) => {
      const face = await new FontFace(family, `url(${url})`, { ...STYLES[family], ...(unicodeRange ? { unicodeRange } : {}) }).load();
      // the live stage draws in a worker, which has its own font set
      (typeof document === "undefined" ? (self as unknown as { fonts: FontFaceSet }).fonts : document.fonts).add(face);
    }),
  ).then(() => undefined);
  return loading;
}
