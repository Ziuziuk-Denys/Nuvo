import { useEffect, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { coreApi } from "../../ports/core";
import { useTranslation } from "../../ports/i18n";
import { SettingBlock } from "./controls";
import styles from "./sections.module.css";

type Protection = "keyring" | "file" | "passphrase";

const SEEN_KEY = "nuvo.keyFileWarned";
const MIN_LENGTH = 8;

/** Whether the warning was shown before; reading it also marks it shown, so it appears once. */
function warnedBefore(): boolean {
  try {
    const seen = localStorage.getItem(SEEN_KEY) === "1";
    localStorage.setItem(SEEN_KEY, "1");
    return seen;
  } catch {
    return false;
  }
}

/**
 * Where the library key lives. Nothing shows while the system keyring holds it. Without a keyring the
 * key sits in a private file: said once as a warning, always as a quiet line, with a passphrase to seal it.
 */
export function KeyProtectionRow(): JSX.Element | null {
  const { t } = useTranslation();
  const [protection, setProtection] = useState<Protection | null>(null);
  const [first, setFirst] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void coreApi.keyStorage().then(
      (view) => {
        if (!live) return;
        setProtection(view.protection);
        if (view.protection === "file") setFirst(!warnedBefore());
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);

  if (protection === null || protection === "keyring") return null;

  const apply = async (next: string | null) => {
    if (next !== null && next.length < MIN_LENGTH) {
      setProblem(t("ui.settings.key.too_short", { count: MIN_LENGTH }));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const view = await coreApi.setKeyPassphrase(next);
      setProtection(view.protection);
      setPassphrase("");
      setFirst(false);
    } catch {
      setProblem(t("ui.settings.key.failed"));
    } finally {
      setBusy(false);
    }
  };

  const sealed = protection === "passphrase";
  return (
    <SettingBlock title={t("ui.settings.key.title")} description={t(sealed ? "ui.settings.key.sealed" : "ui.settings.key.file")}>
      {first && !sealed ? (
        <p className={styles.note} role="alert">
          {t("ui.settings.key.warning")}
        </p>
      ) : null}
      {sealed ? (
        <Button size="s" disabled={busy} onClick={() => void apply(null)}>
          {t("ui.settings.key.remove")}
        </Button>
      ) : (
        <>
          <TextField
            value={passphrase}
            onChange={setPassphrase}
            onSubmit={() => void apply(passphrase)}
            label={t("ui.settings.key.field")}
            placeholder={t("ui.settings.key.field")}
            type="password"
            maxLength={256}
          />
          <Button size="s" variant="primary" disabled={busy || passphrase.length === 0} onClick={() => void apply(passphrase)}>
            {t("ui.settings.key.set")}
          </Button>
        </>
      )}
      {problem ? (
        <p className={styles.note} role="alert">
          {problem}
        </p>
      ) : null}
    </SettingBlock>
  );
}
