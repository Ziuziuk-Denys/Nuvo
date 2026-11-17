import { collage } from "./collage";
import { flow } from "./flow";
import { kinetic } from "./kinetic";
import { paper } from "./paper";
import type { LyricAnimation } from "./types";
import { wipe } from "./wipe";

export const ANIMATIONS: Record<string, LyricAnimation> = { flow, paper, kinetic, collage, wipe };
