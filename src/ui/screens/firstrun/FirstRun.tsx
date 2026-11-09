import { useEffect, useRef, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { Icon } from "../../icons/Icon";
import { coreApi } from "../../ports/core";
import { useTranslation } from "../../ports/i18n";
import { saveTextFile } from "../../ports/system";
import { useTour } from "../../tour/tourStore";
import { markDone, phraseText } from "./firstRunModel";
import styles from "./FirstRun.module.css";

interface FirstRunProps {
  words: string[] | null;
  onDone: () => void;
}

export function FirstRun({ words, onDone }: FirstRunProps): JSX.Element | null {
  const finished = useRef(false);
  const finish = useRef(() => {
    if (finished.current) return;
    finished.current = true;
    markDone();
    useTour.getState().start();
    onDone();
  });

  useEffect(() => {
    if (!words) finish.current();
  }, [words]);

  return words ? <PhraseStep words={words} onConfirmed={() => finish.current()} /> : null;
}

const DONE_MS = 2_000;

// Not dismissible: the phrase is gone for good once confirmed, so no Back, Skip or Escape
function PhraseStep({ words, onConfirmed }: { words: string[]; onConfirmed: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<"confirm" | "copy" | "save" | null>(null);
  const [done, setDone] = useState<"copied" | "saved" | null>(null);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), DONE_MS);
    return () => clearTimeout(timer);
  }, [done]);

  const text = () => phraseText(t("core.phrase_title"), words);
  const copy = () => {
    setFailed(null);
    navigator.clipboard.writeText(text()).then(
      () => setDone("copied"),
      () => setFailed("copy"),
    );
  };
  const save = () => {
    setFailed(null);
    saveTextFile(t("core.phrase_file"), text()).then(
      (saved) => saved && setDone("saved"),
      () => setFailed("save"),
    );
  };
  const confirm = async () => {
    setSaving(true);
    setFailed(null);
    try {
      await coreApi.confirmPhrase();
      onConfirmed();
    } catch {
      setFailed("confirm");
      setSaving(false);
    }
  };

  return (
    <section className={`${styles.page} ${styles.enter}`}>
      <header className={styles.head}>
        <h1 className={styles.title}>{t("core.phrase_title")}</h1>
        <p className={styles.line}>{t("core.phrase_body")}</p>
      </header>
      <ol className={styles.words}>
        {words.map((word, index) => (
          <li key={index} data-testid="recovery-word" className={styles.word}>
            <span className={styles.index}>{index + 1}</span>
            <span className={styles.wordText}>{word}</span>
          </li>
        ))}
      </ol>
      <p className={styles.note}>{t("core.phrase_keep")}</p>
      {failed ? (
        <p role="alert" className={styles.caption}>
          {t(failed === "confirm" ? "core.confirm_failed" : failed === "copy" ? "core.phrase_copy_failed" : "core.phrase_save_failed")}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button onClick={copy}>
          <Icon name={done === "copied" ? "check" : "copy"} size={16} />
          {t(done === "copied" ? "core.phrase_copied" : "core.phrase_copy")}
        </Button>
        <Button onClick={save}>
          <Icon name={done === "saved" ? "check" : "download"} size={16} />
          {t(done === "saved" ? "core.phrase_saved" : "core.phrase_save")}
        </Button>
        <span className={styles.spring} />
        <Button variant="primary" disabled={saving} onClick={() => void confirm()}>
          {t("core.phrase_confirm")}
        </Button>
      </div>
    </section>
  );
}
