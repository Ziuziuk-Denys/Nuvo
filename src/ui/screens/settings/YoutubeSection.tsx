import { useState, type JSX } from "react";
import { useCoverSrc } from "../../ports/covers";
import { useTranslation } from "../../ports/i18n";
import { openYoutubeSignIn, signOutYoutube, useYoutubeAccount, useYoutubePreferences } from "../../ports/youtube";
import { SettingGroup, SettingRow, Switch } from "./controls";
import { SectionIcon } from "./SectionIcon";
import styles from "./sections.module.css";

/** The signed-in account, or the way to sign in; the code and QR open in the sign-in window. */
function AccountCard(): JSX.Element {
  const { t } = useTranslation();
  const { signedIn, account, loading } = useYoutubeAccount();
  const [leaving, setLeaving] = useState(false);
  const photo = useCoverSrc(account?.avatarUrl ?? undefined);

  const signOut = () => {
    setLeaving(true);
    void signOutYoutube().finally(() => setLeaving(false));
  };

  return (
    <div className={styles.account}>
      <span className={styles.avatar} data-loading={loading ? "" : undefined}>
        {photo ? <img src={photo} alt="" /> : loading ? null : <SectionIcon id="Youtube" />}
      </span>
      <span className={styles.accountText}>
        {loading ? (
          <>
            <span className={styles.skeleton} style={{ width: 110, height: 14 }} />
            <span className={styles.skeleton} style={{ width: 160, height: 11 }} />
          </>
        ) : (
          <>
            <span className={styles.accountName}>{signedIn ? (account?.name ?? "") : t("settings.youtube.signed_out_title")}</span>
            <span className={styles.accountSub}>{signedIn ? (account?.email ?? account?.handle ?? "") : t("settings.youtube.signed_out_description")}</span>
          </>
        )}
      </span>
      {signedIn ? (
        <button type="button" className={styles.accountAction} data-quiet="" disabled={leaving} onClick={signOut}>
          {t("settings.youtube.sign_out")}
        </button>
      ) : (
        <button type="button" className={styles.accountAction} onClick={openYoutubeSignIn}>
          {t("settings.youtube.sign_in")}
        </button>
      )}
    </div>
  );
}

export function YoutubeSection(): JSX.Element {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useYoutubePreferences();
  const toggle = (key: string, checked: boolean, onChange: (next: boolean) => void, explained = true) => (
    <SettingRow
      title={t(`settings.youtube.${key}.title`)}
      description={t(`settings.youtube.${key}.description`)}
      titleKey={`settings.youtube.${key}.title`}
      descKey={`settings.youtube.${key}.description`}
      explained={explained}
      control={<Switch label={t(`settings.youtube.${key}.title`)} checked={checked} onChange={onChange} />}
    />
  );

  return (
    <div className={styles.youtube}>
      <AccountCard />
      <SettingGroup label={t("settings.youtube.section_playback")}>
        {toggle("account_playback", prefs.playThroughAccount, (on) => setPrefs({ playThroughAccount: on }))}
        {toggle("prompt_sign_in", prefs.offerSignIn, (on) => setPrefs({ offerSignIn: on }))}
        {toggle("sync_library", prefs.showAccountPlaylists, (on) => setPrefs({ showAccountPlaylists: on }), false)}
      </SettingGroup>
    </div>
  );
}
