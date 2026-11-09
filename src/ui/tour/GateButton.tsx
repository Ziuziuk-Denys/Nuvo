import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import button from "../components/Button.module.css";
import styles from "./tour.module.css";

interface GateButtonProps {
  seconds: number;
  waiting: boolean;
  running?: boolean;
  gateKey: string;
  onReady?: () => void;
  onClick: () => void;
  children: ReactNode;
}

// The fill is a timer, not decoration, so it ignores reduced motion
export function GateButton({ seconds, waiting, running = true, gateKey, onReady, onClick, children }: GateButtonProps): JSX.Element {
  const fillRef = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(!waiting);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    if (!waiting) {
      setReady(true);
      return;
    }
    setReady(false);
    fillRef.current?.style.setProperty("transform", "scaleX(0)");
    if (!running) return;

    const started = performance.now();
    let frame = 0;
    const tick = () => {
      const share = Math.min(1, (performance.now() - started) / (seconds * 1000));
      fillRef.current?.style.setProperty("transform", `scaleX(${share.toFixed(4)})`);
      if (share < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setReady(true);
        onReadyRef.current?.();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [waiting, running, seconds, gateKey]);

  return (
    <button
      type="button"
      data-next=""
      className={`${button.button} ${ready ? button.primary : `${button.secondary} ${styles.gate}`}`}
      aria-disabled={!ready}
      onClick={() => {
        if (ready) onClick();
      }}
    >
      {ready ? null : <span ref={fillRef} className={styles.gateFill} aria-hidden="true" />}
      <span className={styles.gateLabel}>{children}</span>
    </button>
  );
}
