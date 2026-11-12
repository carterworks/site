import { pinbed } from "./pinbed";
import { shimmer } from "./shimmer";
import type { Toy } from "./toy";

/**
 * Every backdrop toy, in menu order; the first is the default. Pond,
 * Culture, Wax, Silt and Mote still use the old mode API (see `./mode`) and
 * rejoin as each is ported to `Toy`.
 */
export const MODES: Toy[] = [shimmer, pinbed];
