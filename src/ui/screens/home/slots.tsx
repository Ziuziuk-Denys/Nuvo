import type { JSX } from "react";
import type { Track } from "../../ports/recs";
import { ColdStart } from "./ColdStart";
import { HiddenLink } from "./HiddenLink";

export function ColdStartSlot({ ring }: { ring: Track[] | null }): JSX.Element {
  return (
    <div data-slot="cold-start">
      <ColdStart ring={ring} />
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
