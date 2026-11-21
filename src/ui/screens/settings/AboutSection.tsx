import { useContext, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { useAppEdition, useAppVersion } from "../../ports/settings";
import { presetIconSvg, useLook } from "../../ports/theme";
import { SearchQuery, SettingBlock, SettingGroup } from "./controls";
import { matchesQuery } from "./sections";
import styles from "./sections.module.css";
import { DonateLink } from "./DonateLink";
import { HelpLinks, ReleaseNotes } from "./HelpSheets";
import { AutoUpdateRow, UpdateStatus } from "./UpdateRows";
import { CommunityLinks } from "./CommunityLinks";

// required by the AGPL section 7(b) term in NOTICE; a legal notice, so it is never translated
const ENGINE_CREDIT = "Visual engine by Denys Ziuziuk and contributors · nuvo.quest";

export function AboutSection(): JSX.Element {
  const { t } = useTranslation();
  const version = useAppVersion();
  const edition = useAppEdition();
  const query = useContext(SearchQuery);
  const { preset, mode } = useLook();

  return (
    <>
      {matchesQuery(query, ["settings.about.nuvo", "settings.about.tagline"], [version]) ? (
        <div className={styles.about}>
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(presetIconSvg(preset, mode))}`}
            alt=""
            width={56}
            height={56}
            className={styles.aboutLogo}
            draggable={false}
          />
          <div className={styles.aboutText}>
            <span className={styles.aboutName}>{t("settings.about.nuvo")}</span>
            <span className={styles.version}>{version}</span>
            {edition ? <span className={styles.edition}>{t(`settings.about.edition_${edition}`)}</span> : null}
            <span className={styles.version}>{ENGINE_CREDIT}</span>
          </div>
        </div>
      ) : null}
      <CommunityLinks />
      <SettingGroup label={t("settings.page.help")}>
        <HelpLinks />
        <DonateLink />
      </SettingGroup>
    </>
  );
}

export function UpdatesSection(): JSX.Element {
  const { t } = useTranslation();
  const version = useAppVersion();

  return (
    <>
      <SettingGroup>
        <AutoUpdateRow />
        <UpdateStatus />
      </SettingGroup>
      <SettingGroup label={t("ui.settings.whats_new.title", { version })}>
        <SettingBlock title={t("ui.settings.whats_new.link")} titleKey="ui.settings.whats_new.link" headless>
          <ReleaseNotes version={version} />
        </SettingBlock>
      </SettingGroup>
    </>
  );
}
