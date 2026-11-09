import { useContext, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { Icon } from "../../icons/Icon";
import { useAppVersion } from "../../ports/settings";
import { SearchQuery, SettingGroup } from "./controls";
import { matchesQuery } from "./sections";
import styles from "./sections.module.css";
import { DonateLink } from "./DonateLink";
import { HelpLinks } from "./HelpSheets";
import { AutoUpdateRow, UpdateNotice } from "./UpdateRows";

export function AboutSection(): JSX.Element | null {
  const { t } = useTranslation();
  const version = useAppVersion();
  const query = useContext(SearchQuery);
  if (!matchesQuery(query, ["settings.about.nuvo", "settings.about.tagline"], [version])) return null;

  return (
    <>
      <div className={styles.about}>
        <svg className={styles.aboutBand} viewBox="0 0 540 330" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <polyline points="-60,300 -70,80 110,330 90,-60 330,350 315,-70 530,330 545,-50 620,130" />
        </svg>
        <div className={styles.aboutTop}>
          <div className={styles.aboutBrand}>
            <Icon name="nuvo-mark" size={24} className={styles.aboutLogo} />
            <span className={styles.aboutName}>{t("settings.about.nuvo")}</span>
          </div>
          <span className={styles.version}>
            <span className={styles.versionDot} />v{version}
          </span>
        </div>
        <div className={styles.aboutFoot}>
          <span className={styles.client}>{`Client ${version}`}</span>
          <UpdateNotice />
          <HelpLinks />
          <DonateLink />
        </div>
      </div>
      <SettingGroup>
        <AutoUpdateRow />
      </SettingGroup>
    </>
  );
}
