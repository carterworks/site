import { shimmer } from "./shimmer";
import { silt } from "./silt";
import type { Toy } from "./toy";

/**
 * Every backdrop toy, in menu order; the first is the default. Pond, Pinbed,
 * Culture, Wax and Mote still use the old mode API (see `./mode`) and
 * rejoin as each is ported to `Toy`.
 */
export const MODES: Toy[] = [shimmer, silt];
