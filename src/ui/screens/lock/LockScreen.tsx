import { useId, useRef, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { StateCard } from "../../feedback/StateCard";
import { Icon } from "../../icons/Icon";
import { coreApi } from "../../ports/core";
import { useTranslation } from "../../ports/i18n";
import styles from "./LockScreen.module.css";

const PHRASE_WORDS = 24;

/** Over the window while the key is missing from the keyring: the recovery phrase opens the library. */
export function LockScreen({ onUnlocked, passphrase = false }: { onUnlocked: () => void; passphrase?: boolean }): JSX.Element {
  return passphrase ? <PassphraseLock onUnlocked={onUnlocked} /> : <PhraseLock onUnlocked={onUnlocked} />;
}

/** The key file is sealed with a passphrase the owner set: it opens the library without the phrase. */
function PassphraseLock({ onUnlocked }: { onUnlocked: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const unlock = async () => {
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await coreApi.unlockWithPassphrase(value);
      onUnlocked();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(t(status === 400 ? "ui.lock.wrong_passphrase" : "common.error_network"));
      setShake((count) => count + 1);
      setBusy(false);
    }
  };

  return (
    <StateCard title={t("ui.lock.title")} line={t("ui.lock.passphrase_line")} glyph={<Icon name="nuvo-mark" size={26} />} busy={busy} shake={shake}>
      <TextField
        value={value}
        onChange={(next) => {
          setValue(next);
          setError(null);
        }}
        onSubmit={() => void unlock()}
        label={t("ui.lock.passphrase_field")}
        placeholder={t("ui.lock.passphrase_field")}
        type="password"
        autoFocus
        maxLength={256}
      />
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <Button variant="primary" className={styles.unlock} disabled={!value || busy} onClick={() => void unlock()}>
        {t(busy ? "ui.lock.unlocking" : "ui.lock.unlock")}
      </Button>
    </StateCard>
  );
}

function PhraseLock({ onUnlocked }: { onUnlocked: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const [lostOpen, setLostOpen] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const countId = useId();
  const errorId = useId();
  const lostId = useId();
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const ready = words.length === PHRASE_WORDS && !busy;

  const unlock = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await coreApi.restore(words.join(" "));
      onUnlocked();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(t(status === 400 ? "ui.lock.wrong" : "common.error_network"));
      setShake((count) => count + 1);
      setBusy(false);
      fieldRef.current?.focus();
    }
  };

  return (
    <StateCard title={t("ui.lock.title")} line={t("ui.lock.line")} glyph={<Icon name="nuvo-mark" size={26} />} busy={busy} shake={shake}>
      <div className={styles.well} data-invalid={error ? "" : undefined}>
        <textarea
          ref={fieldRef}
          className={styles.field}
          // custom CSS may never hide the way back in (customization 6.3)
          data-nuvo-guard="block"
          value={phrase}
          onChange={(event) => {
            setPhrase(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            // the words are separated by spaces, so Enter is free to mean Unlock
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            void unlock();
          }}
          rows={3}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          placeholder={t("ui.lock.placeholder")}
          aria-label={t("ui.lock.field")}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${countId} ${errorId}` : countId}
        />
        <span id={countId} className={styles.count} data-full={words.length === PHRASE_WORDS ? "" : undefined}>
          {t("ui.lock.count", { count: words.length })}
        </span>
      </div>
      {error ? (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <Button variant="primary" className={styles.unlock} disabled={!ready} onClick={() => void unlock()}>
        {busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
        {t(busy ? "ui.lock.unlocking" : "ui.lock.unlock")}
      </Button>
      <Button variant="text" size="s" className={styles.lost} aria-expanded={lostOpen} aria-controls={lostId} onClick={() => setLostOpen((open) => !open)}>
        {t("ui.lock.lost")}
      </Button>
      <div id={lostId} className={styles.lostText} hidden={!lostOpen}>
        {lostOpen ? t("ui.lock.lost_text") : null}
      </div>
    </StateCard>
  );
}
