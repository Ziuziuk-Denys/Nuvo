import { useEffect, useState } from "react";
import { version } from "../../../package.json";

/** The version this bundle was built from. */
export const APP_VERSION: string = version;

/** Starts with the build version and switches to the one main reports. */
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
