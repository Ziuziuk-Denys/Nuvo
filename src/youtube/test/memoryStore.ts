/** In-memory account store for the account tests. */
import { DEFAULT_PREFERENCES, type AccountStore, type Preferences, type StoredSession } from "../account/store";

export class MemoryStore implements AccountStore {
  session: StoredSession | null = null;
  preferences: Preferences = { ...DEFAULT_PREFERENCES };
  saves = 0;
  async load() {
    return { session: this.session, preferences: { ...this.preferences } };
  }
  async saveSession(session: StoredSession) {
    this.saves += 1;
    this.session = { ...session };
  }
  async dropSession() {
    this.session = null;
  }
  async patchPreferences(patch: Partial<Preferences>) {
    this.preferences = { ...this.preferences, ...patch };
    return { ...this.preferences };
  }
}
