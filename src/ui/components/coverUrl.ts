const GOOGLE_ART = /^https:\/\/[a-z0-9-]+\.(googleusercontent|ggpht)\.com\//i;
const SIZE_SUFFIX = /=(?:w\d+-h\d+|s\d+)(?:-[a-zA-Z0-9_]+)*$/;

// Requests Google artwork at its drawn size so a 40 px row does not decode a 1200 px image
export function sizedCoverUrl(url: string, cssPx: number, dpr = 2): string {
  if (!url || !GOOGLE_ART.test(url)) return url;
  const px = Math.ceil(cssPx * Math.max(1, dpr));
  return SIZE_SUFFIX.test(url) ? url.replace(SIZE_SUFFIX, `=s${px}`) : `${url}=s${px}`;
}
