import { useEffect, useState } from "react";

const HEART = "M32 50C17 40 10 32 10 23a11 11 0 0 1 22-4 11 11 0 0 1 22 4c0 9-7 17-22 27z";

export function likesCoverSvg(accent: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="${accent}" stop-opacity="0.55"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><path d="${HEART}" fill="#fff" fill-opacity="0.92"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function currentAccent(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--n-accent").trim() || "#0071e3";
}

export function useLikesCover(): string {
  const [cover, setCover] = useState(() => likesCoverSvg(currentAccent()));
  useEffect(() => {
    const observer = new MutationObserver(() => setCover(likesCoverSvg(currentAccent())));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
    return () => observer.disconnect();
  }, []);
  return cover;
}
