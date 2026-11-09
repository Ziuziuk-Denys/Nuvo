import type { JSX } from "react";
import { ColdStart } from "./ColdStart";
import { HiddenLink } from "./HiddenLink";

export function ColdStartSlot({ onImport }: { onImport?: () => void }): JSX.Element {
  return (
    <div data-slot="cold-start">
      <ColdStart onImport={onImport} />
    </div>
  );
}

export function HiddenLinkSlot(): JSX.Element {
  return (
    <div data-slot="hidden-link">
      <HiddenLink />
    </div>
  );
}
