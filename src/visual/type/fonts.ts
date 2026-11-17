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

const FACES: [string, string, FontFaceDescriptors][] = [
  ["Nuvo Sans", instrumentSans, { weight: "400 700" }],
  ["Nuvo Condensed", archivo, { weight: "100 900", stretch: "62% 125%" }],
  ["Nuvo Serif", instrumentSerif, { style: "italic" }],
  ["Nuvo Neutral", arimo, {}],
  ["Nuvo Rounded", nunito, { weight: "800 900" }],
  ["Nuvo Script", pinyon, {}],
  // the Latin faces have no Cyrillic, so a close Cyrillic face joins each family for those letters only
  ["Nuvo Sans", manropeCyrillic, { weight: "400 800", unicodeRange: CYRILLIC }],
  ["Nuvo Condensed", oswaldCyrillic, { weight: "200 700", unicodeRange: CYRILLIC }],
  ["Nuvo Serif", cormorantCyrillic, { style: "italic", weight: "400 700", unicodeRange: CYRILLIC }],
  ["Nuvo Neutral", arimoCyrillic, { weight: "400 700", unicodeRange: CYRILLIC }],
  ["Nuvo Rounded", nunitoCyrillic, { weight: "800 900", unicodeRange: CYRILLIC }],
  ["Nuvo Script", marckCyrillic, { unicodeRange: CYRILLIC }],
];

let loading: Promise<void> | null = null;

export function loadVisualFonts(): Promise<void> {
  loading ??= Promise.all(
    FACES.map(async ([family, url, descriptors]) => {
      const face = await new FontFace(family, `url(${url})`, descriptors).load();
      // the live stage draws in a worker, which has its own font set
      (typeof document === "undefined" ? (self as unknown as { fonts: FontFaceSet }).fonts : document.fonts).add(face);
    }),
  ).then(() => undefined);
  return loading;
}
