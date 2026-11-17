export type Edition = "plain" | "encrypted";

export const editionOf = (manifest: { nuvoEdition?: unknown }): Edition => (manifest.nuvoEdition === "encrypted" ? "encrypted" : "plain");

// The standard edition keeps the feed every earlier release reads, so those installs update into it
export const updateChannel = (edition: Edition): string | null => (edition === "encrypted" ? "encrypted" : null);
