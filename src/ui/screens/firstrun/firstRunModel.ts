/** localStorage flag written when the first run is finished, or found unnecessary on an existing profile. */
export const DONE_KEY = "nuvo_onboarding_done_v1";

export function shouldOnboard(input: { phrasePending: boolean; fresh: boolean; done: boolean }): boolean {
  if (input.done) return false;
  return input.phrasePending || input.fresh;
}

export function isDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markDone(): void {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    // storage blocked: the first run shows again next launch, nothing is lost
  }
}

/** The phrase as a saved file reads it: a heading, then one numbered word per line. */
export function phraseText(title: string, words: string[]): string {
  return `${title}\n\n${words.map((word, index) => `${index + 1}. ${word}`).join("\n")}\n`;
}
