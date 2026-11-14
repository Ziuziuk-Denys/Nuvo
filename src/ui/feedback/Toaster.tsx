import { useEffect, useState, type JSX } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Icon } from "../icons/Icon";
import { useStatusLine } from "./statusLine";
import { STICKY, useToastStore, visibleToast, type ToastVariant } from "./toastStore";
import styles from "./Toaster.module.css";

const EASE_OUT = [0.2, 0.7, 0.2, 1] as const;

// work with a known end shows its line instead of a spinner, so nothing spins for minutes
function Glyph({ variant, measured }: { variant: ToastVariant; measured: boolean }): JSX.Element {
  if (variant === "loader" || variant === "loading") {
    return measured ? (
      <span className={styles.glyph}>
        <Icon name="download" size={16} />
      </span>
    ) : (
      <span className={styles.spinner} data-variant="loader" />
    );
  }
  const name = variant === "success" || variant === "checkmark" ? "check" : variant === "error" ? "warning" : "info";
  return (
    <span className={styles.glyph} data-variant={variant === "checkmark" ? "success" : variant}>
      <Icon name={name} size={16} />
    </span>
  );
}

export function Toaster(): JSX.Element {
  const queue = useToastStore((state) => state.queue);
  const toast = visibleToast(queue);
  const [hoveredId, setHoveredId] = useState<string | number | null>(null);
  const paused = toast !== null && hoveredId === toast.id;
  const still = useReducedMotion() === true;

  useEffect(() => useToastStore.getState().listen(), []);
  useStatusLine();

  const id = toast?.id;
  const duration = toast?.duration ?? STICKY;
  useEffect(() => {
    if (id === undefined || duration >= STICKY || paused) return;
    const timer = setTimeout(() => useToastStore.getState().dismiss(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration, paused]);

  return (
    <div className={styles.stage}>
      <AnimatePresence initial={false}>
        {toast ? (
          <motion.div
            key={toast.id}
            data-toast
            data-no-window-drag
            role={toast.variant === "error" ? "alert" : "status"}
            className={styles.card}
            data-action={toast.action ? "" : undefined}
            data-progress={toast.progress !== undefined ? "" : undefined}
            initial={still ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: EASE_OUT } }}
            exit={still ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.15, ease: "easeIn" } }}
            onMouseEnter={() => setHoveredId(toast.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <Glyph variant={toast.variant} measured={toast.progress !== undefined} />
            <span className={styles.text}>
              <span className={styles.message}>{toast.message}</span>
              {toast.description ? (
                <>
                  <span aria-hidden="true" className={styles.dot}>
                    ·
                  </span>
                  <span className={styles.description} title={toast.description}>
                    {toast.description}
                  </span>
                </>
              ) : null}
            </span>
            {toast.action ? (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  toast.action?.onClick();
                  useToastStore.getState().dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            ) : null}
            {toast.progress !== undefined ? (
              <span className={styles.progress} style={{ transform: `scaleX(${Math.min(1, Math.max(0, toast.progress))})` }} />
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
