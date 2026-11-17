export type Edition = "plain" | "encrypted";

export const editionOf = (manifest: { nuvoEdition?: unknown }): Edition => (manifest.nuvoEdition === "encrypted" ? "encrypted" : "plain");

// The encrypted edition keeps the feed every release before the editions reads, so those installs stay encrypted
export const updateChannel = (edition: Edition): string | null => (edition === "plain" ? "plain" : null);
