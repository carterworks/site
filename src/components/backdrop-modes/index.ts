import type { Mode } from "./mode";
import { pinbed } from "./pinbed";
import { shimmer } from "./shimmer";

/** Every backdrop mode, in menu order; the first is the default. */
export const MODES: Mode[] = [shimmer, pinbed];
