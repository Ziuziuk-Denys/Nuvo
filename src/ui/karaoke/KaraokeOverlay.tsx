import { useEffect, useState, type JSX } from "react";
import { Karaoke } from "./Karaoke";
import { RISE_EASING, RISE_MS } from "./rise";
import styles from "./KaraokeOverlay.module.css";

export function KaraokeOverlay({ open, onClose }: { open: boolean; onClose(): void }): JSX.Element | null {
  const [mounted, setMounted] = useState(open);
  const [raised, setRaised] = useState(open);
  if (open && !mounted) setMounted(true);
  if (!open && raised) setRaised(false);

  useEffect(() => {
    if (open) {
      // two frames, so the browser has drawn the view below the window before it moves
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setRaised(true));
      });
      return () => cancelAnimationFrame(frame);
    }
    const timer = setTimeout(() => setMounted(false), RISE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;
  const phase = !open ? "leaving" : raised ? "open" : "entering";
  return (
    <div className={styles.overlay} data-phase={phase} data-theme="dark" style={{ transitionDuration: `${RISE_MS}ms`, transitionTimingFunction: RISE_EASING }}>
      <Karaoke onClose={onClose} />
    </div>
  );
}
