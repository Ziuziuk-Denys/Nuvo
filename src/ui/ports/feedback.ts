import type { ErrorInfo } from "react";
import { log } from "@/data/platform/log";

export { APP_VERSION } from "@/data/platform/version";

export function logError(error: Error, info: ErrorInfo): void {
  log("error", "ErrorBoundary", `Uncaught React rendering error: ${error.message}`, error, info.componentStack);
}
