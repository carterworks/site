import type { Mode } from "./mode";
import { pinbed } from "./pinbed";
import { pond } from "./pond";
import { shimmer } from "./shimmer";

/** Every backdrop mode, in menu order; the first is the default. */
export const MODES: Mode[] = [shimmer, pond, pinbed];
