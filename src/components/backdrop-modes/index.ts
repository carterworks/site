import type { Mode } from "./mode";
import { mote } from "./mote";
import { shimmer } from "./shimmer";

/** Every backdrop mode, in menu order; the first is the default. */
export const MODES: Mode[] = [shimmer, mote];
