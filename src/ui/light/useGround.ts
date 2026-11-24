import { useSyncExternalStore } from "react";

const read = () => getComputedStyle(document.documentElement).getPropertyValue("--n-deep").trim() || "#0b0e1a";

function watch(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme", "data-look"] });
  return () => observer.disconnect();
}

export function useGround(): string {
  return useSyncExternalStore(watch, read);
}
