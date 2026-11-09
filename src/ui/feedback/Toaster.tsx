import { useEffect, useState, type JSX } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Icon } from "../icons/Icon";
import { useStatusLine } from "./statusLine";
import { STICKY, useToastStore, visibleToast, type ToastVariant } from "./toastStore";
import styles from "./Toaster.module.css";

const SPRING = { type: "spring", stiffness: 480, damping: 38, mass: 0.8 } as const;

function Glyph({ variant }: { variant: ToastVariant }): JSX.Element {
  if (variant === "loader" || variant === "loading") return <span className={styles.spinner} data-variant="loader" />;
  const name = variant === "success" || variant === "checkmark" ? "check" : variant === "error" ? "close" : "info";
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
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: SPRING }}
            exit={{ opacity: 0, y: -48, scale: 0.92, transition: { duration: 0.18, ease: "easeIn" } }}
            onMouseEnter={() => setHoveredId(toast.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <Glyph variant={toast.variant} />
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
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
