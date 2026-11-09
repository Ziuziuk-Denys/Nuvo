import { useEffect, useState } from "react";
import { version } from "../../../package.json";

export const APP_VERSION: string = version;

export function useAppVersion(): string {
  const [current, setCurrent] = useState(APP_VERSION);
  useEffect(() => {
    let live = true;
    window.nuvoShell
      ?.getAppInfo()
      .then((info) => {
        if (live && info.version) setCurrent(info.version);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return current;
}
