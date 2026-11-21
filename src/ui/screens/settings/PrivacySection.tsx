import { useContext, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { HiddenList } from "../../recs/HiddenList";
import { SearchQuery, SettingGroup } from "./controls";
import { KeyProtectionRow } from "./KeyProtectionRow";
import { matchesQuery } from "./sections";
import { StatsPauseRow } from "./StatsPauseRow";
import styles from "./controls.module.css";

const HIDDEN = "ui.recs.hidden.section";
const HIDDEN_DESCRIPTION = "ui.recs.hidden.description";

export function PrivacySection(): JSX.Element {
  const { t } = useTranslation();
  const query = useContext(SearchQuery);

  return (
    <>
      <SettingGroup>
        <StatsPauseRow />
        <KeyProtectionRow />
      </SettingGroup>
      {matchesQuery(query, [HIDDEN, HIDDEN_DESCRIPTION, "settings.find.hidden"]) ? (
        <section className={styles.stack} data-setting={HIDDEN}>
          <h3 className={styles.groupLabel}>{t(HIDDEN)}</h3>
          <p className={styles.groupNote}>{t(HIDDEN_DESCRIPTION)}</p>
          <HiddenList />
        </section>
      ) : null}
    </>
  );
}
