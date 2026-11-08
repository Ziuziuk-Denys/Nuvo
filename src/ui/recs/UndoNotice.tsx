import { useEffect, useRef, type JSX } from "react";
import { Button } from "../components/Button";
import { useToastStore } from "../feedback/toastStore";
import type { TFunction } from "../ports/i18n";
import { useTranslation } from "../ports/i18n";
import { firstArtist, markNotInterested, NOTICE_MS, undoNotInterested, useNotInterestedStore, type NotInterestedNotice } from "./notInterested";
import styles from "./UndoNotice.module.css";

/** The words for the bar's quiet line; the actions come from UndoNotice beside it. */
export function noticeText(notice: NotInterestedNotice, t: TFunction): string {
  if (notice.undoFailed) return t(notice.failure === "locked" ? "ui.recs.notice.undo_locked" : "ui.recs.notice.undo_failed");
  if (notice.failure === "locked") return t("ui.recs.notice.locked");
  if (notice.failure) return t("ui.recs.notice.failed");
  return t(`ui.recs.notice.${notice.scope}`, { artist: firstArtist(notice.track), title: notice.track.title });
}

/** Undo for 8 s, and the hide-artist offer when the daemon makes it. Renders no text of its own. */
export function UndoNotice(): JSX.Element | null {
  const { t } = useTranslation();
  const notice = useNotInterestedStore((state) => state.notice);
  const setNotice = useNotInterestedStore((state) => state.setNotice);

  const actionsRef = useRef<HTMLSpanElement>(null);

  // the buttons are about to leave: a focus inside them goes back to the like button beside them
  const releaseFocus = () => {
    const actions = actionsRef.current;
    if (!actions?.contains(document.activeElement)) return;
    actions.closest<HTMLElement>("[data-island]")?.querySelector<HTMLElement>("[data-like]")?.focus();
  };

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => {
      releaseFocus();
      setNotice(null);
    }, NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  if (!notice) return null;
  const artist = firstArtist(notice.track);
  const canHide = notice.offerHideArtist && artist && notice.scope !== "artist_forever";
  if (notice.failure) return null;
  return (
    <span ref={actionsRef} className={styles.actions}>
      <Button
        variant="text"
        size="s"
        className={styles.action}
        onClick={() => {
          releaseFocus();
          void undoNotInterested(notice);
        }}
      >
        {t("ui.recs.notice.undo")}
      </Button>
      {canHide ? (
        <Button variant="text" size="s" className={styles.hide} onClick={() => void markNotInterested(notice.track, "artist_forever")}>
          {t("ui.recs.notice.hide_artist", { artist })}
        </Button>
      ) : null}
    </span>
  );
}

const TOAST_ID = "recs-notice";

/** With no bar on screen (nothing playing, the karaoke view) the same words and Undo come as a toast. */
export function useUndoToast(barShown: boolean): void {
  const { t } = useTranslation();
  const notice = useNotInterestedStore((state) => state.notice);

  useEffect(() => {
    if (!notice || barShown) return;
    const { show, remove } = useToastStore.getState();
    remove(TOAST_ID);
    show({
      id: TOAST_ID,
      message: noticeText(notice, t),
      variant: notice.failure ? "error" : "info",
      duration: NOTICE_MS,
      action: notice.failure ? undefined : { label: t("ui.recs.notice.undo"), onClick: () => void undoNotInterested(notice) },
    });
    const timer = setTimeout(() => useNotInterestedStore.getState().setNotice(null), NOTICE_MS);
    return () => {
      clearTimeout(timer);
      remove(TOAST_ID);
    };
  }, [notice, barShown, t]);
}
