import { mote } from "./mote";
import { shimmer } from "./shimmer";
import type { Toy } from "./toy";

/**
 * Every backdrop toy, in menu order; the first is the default. Pond, Pinbed,
 * Culture, Wax and Silt still use the old mode API (see `./mode`) and
 * rejoin as each is ported to `Toy`.
 */
export const MODES: Toy[] = [shimmer, mote];
