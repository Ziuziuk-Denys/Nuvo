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

export function phraseText(title: string, words: string[]): string {
  return `${title}\n\n${words.map((word, index) => `${index + 1}. ${word}`).join("\n")}\n`;
}
