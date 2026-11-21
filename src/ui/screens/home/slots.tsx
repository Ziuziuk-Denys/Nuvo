import type { JSX } from "react";
import { ColdStart } from "./ColdStart";
import { HiddenLink } from "./HiddenLink";

export function ColdStartSlot(): JSX.Element {
  return (
    <div data-slot="cold-start">
      <ColdStart />
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
