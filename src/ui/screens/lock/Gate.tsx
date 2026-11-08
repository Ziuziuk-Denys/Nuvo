import { useEffect, useState, type JSX, type ReactNode } from "react";
import { coreApi, useCoreStatus } from "../../ports/core";
import { FirstRun } from "../firstrun/FirstRun";
import { isDone, markDone, shouldOnboard } from "../firstrun/firstRunModel";
import { useGateStore } from "./gateState";
import { LockScreen } from "./LockScreen";

type GateState = { kind: "checking" } | { kind: "open" } | { kind: "locked"; passphrase: boolean } | { kind: "first-run"; words: string[] | null };

/** Test-only crash for the error screen e2e: the harness sets this key before a reload. */
const THROW_KEY = "nuvo_e2e_throw";

function throwRequested(): boolean {
  try {
    return sessionStorage.getItem(THROW_KEY) === "1";
  } catch {
    return false;
  }
}

/** Decides what fills the content area: the first run or the pages, with the lock card floating over an empty window while locked. */
export function Gate({ children }: { children: ReactNode }): JSX.Element | null {
  const status = useCoreStatus();
  // a finished first run never waits for the daemon; the lock screen can still replace the pages later
  const [state, setState] = useState<GateState>(() => (isDone() ? { kind: "open" } : { kind: "checking" }));

  useEffect(() => {
    if (status === "failed") setState((current) => (current.kind === "checking" ? { kind: "open" } : current));
    if (status !== "ready") return;
    let active = true;
    void (async () => {
      try {
        const health = await coreApi.health();
        if (!active) return;
        if (health.locked) {
          setState({ kind: "locked", passphrase: health.passphrase === true });
          return;
        }
        if (isDone()) {
          setState({ kind: "open" });
          return;
        }
        // 404 once the phrase is confirmed
        const words = await coreApi.recoveryPhrase().then(
          (phrase) => phrase.split(" "),
          () => null,
        );
        const fresh = await coreApi.isLibraryEmpty().catch(() => false);
        if (!active) return;
        if (shouldOnboard({ phrasePending: words !== null, fresh, done: false })) {
          setState({ kind: "first-run", words });
        } else {
          markDone();
          setState({ kind: "open" });
        }
      } catch {
        // a dead daemon shows in the status line; the pages show what they have cached
        if (active) setState((current) => (current.kind === "checking" ? { kind: "open" } : current));
      }
    })();
    return () => {
      active = false;
    };
  }, [status]);

  const locked = state.kind === "locked";
  useEffect(() => {
    useGateStore.setState({ locked });
  }, [locked]);

  if (throwRequested()) throw new Error("Test crash requested by the e2e harness");

  if (state.kind === "checking") return null;
  if (state.kind === "locked") {
    return (
      <LockScreen
        passphrase={state.passphrase}
        onUnlocked={() => {
          window.dispatchEvent(new Event("library:changed"));
          setState({ kind: "open" });
        }}
      />
    );
  }
  if (state.kind === "first-run") return <FirstRun words={state.words} onDone={() => setState({ kind: "open" })} />;
  return <>{children}</>;
}
