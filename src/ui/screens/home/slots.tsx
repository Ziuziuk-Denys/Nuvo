import type { JSX } from "react";
import { ColdStart } from "./ColdStart";
import { HiddenLink } from "./HiddenLink";

/*
 * Mount points for two Home parts that are their own components: the cold-start ask (ColdStart) and the quiet link
 * to what "Not interested" hides (HiddenLink). Home places them; each slot renders its component.
 */
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
