import type { JSX } from "react";
import { Sheet } from "../components/Sheet";
import { useTranslation } from "../ports/i18n";
import { useSignInOffer } from "../ports/youtube";
import styles from "./SignInSheet.module.css";

export function SignInSheet(): JSX.Element | null {
  const { t } = useTranslation();
  const { state, notNow, retry } = useSignInOffer();
  const open = state.phase !== "closed";
  const actions =
    state.phase === "error"
      ? [
          { label: t("ui.signin.not_now"), onClick: notNow },
          { label: t("ui.signin.retry"), onClick: retry, primary: true },
        ]
      : [{ label: t("ui.signin.not_now"), onClick: notNow }];
  return (
    <Sheet open={open} onClose={notNow} title={t("ui.signin.title")} actions={actions}>
      {state.phase === "waiting" ? (
        <div className={styles.body}>
          <p className={styles.line}>{t("ui.signin.steps")}</p>
          <a className={styles.link} href={state.code.verifyLinkWithCode} target="_blank" rel="noreferrer">
            {state.code.verifyLink}
          </a>
          <p className={styles.code} aria-label={t("ui.signin.code")}>
            {state.code.shownCode}
          </p>
          <p className={styles.hint}>{t("ui.signin.waiting")}</p>
        </div>
      ) : state.phase === "error" ? (
        <p className={styles.line}>{t("ui.signin.failed")}</p>
      ) : (
        <p className={styles.line}>{t("ui.signin.asking")}</p>
      )}
    </Sheet>
  );
}
