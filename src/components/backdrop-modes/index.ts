import type { Mode } from "./mode";
import { shimmer } from "./shimmer";
import { silt } from "./silt";

/** Every backdrop mode, in menu order; the first is the default. */
export const MODES: Mode[] = [shimmer, silt];
