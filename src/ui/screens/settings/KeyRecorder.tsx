import { useEffect, useRef, useState, type JSX } from "react";
import { acquireEscapeGuard } from "../../ports/escape";
import { useTranslation } from "../../ports/i18n";
import { recordKey, shortcutKeycaps, startRecording, stopRecording, useRecorderState, type RecorderState, type ShortcutScope } from "../../ports/shortcuts";
import styles from "./shortcuts.module.css";

export type Rejection = NonNullable<Extract<RecorderState, { kind: "recording" }>["rejection"]>;

interface KeyRecorderProps {
  commandId: string;
  scope: ShortcutScope;
  value: string;
  recording: boolean;
  onRecordingChange: (recording: boolean) => void;
  rejectionText: (rejection: Rejection) => string;
}

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

function heldModifiers(event: KeyboardEvent): string[] {
  const held: string[] = [];
  if (event.ctrlKey) held.push("Ctrl");
  if (event.altKey) held.push(MAC ? "Opt" : "Alt");
  if (event.shiftKey) held.push("Shift");
  if (event.metaKey) held.push(MAC ? "Cmd" : "Win");
  return held;
}

// Recording holds the escape guard, so Escape cancels it instead of closing Settings
export function KeyRecorder({ commandId, scope, value, recording, onRecordingChange, rejectionText }: KeyRecorderProps): JSX.Element {
  const { t } = useTranslation();
  const recorder = useRecorderState();
  const [held, setHeld] = useState<string[]>([]);
  const latest = useRef(onRecordingChange);
  latest.current = onRecordingChange;

  useEffect(() => {
    if (!recording) {
      setHeld([]);
      return;
    }
    startRecording(commandId, scope);
    const release = acquireEscapeGuard();
    const stop = () => latest.current(false);

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setHeld(heldModifiers(event));
      if (!recordKey(event)) stop();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setHeld(heldModifiers(event));
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", stop);
      release();
      stopRecording();
    };
  }, [recording, commandId, scope]);

  const rejection = recording && recorder.kind === "recording" && recorder.id === commandId ? recorder.rejection : null;

  return (
    <span className={styles.recorder}>
      {recording ? (
        <span className={styles.waiting} data-error={rejection ? "" : undefined} data-held={held.length > 0 ? "" : undefined}>
          {held.length > 0 ? `${held.join(" + ")} + ...` : t("settings.shortcuts.press_keys")}
        </span>
      ) : (
        shortcutKeycaps(value).map((cap, index) => (
          <kbd key={index} className={styles.keycap} aria-label={cap.label}>
            {cap.text}
          </kbd>
        ))
      )}
      {rejection ? (
        <span role="alert" className={styles.error}>
          {rejectionText(rejection)}
        </span>
      ) : null}
    </span>
  );
}
