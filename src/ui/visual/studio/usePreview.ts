import { useEffect, useState } from "react";

export function usePreview(load: () => Promise<string>): string {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true;
    load().then(
      (url) => {
        if (live) setSrc(url);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [load]);
  return src;
}
