import { mote } from "./mote";
import { pinbed } from "./pinbed";
import { pond } from "./pond";
import { shimmer } from "./shimmer";
import { silt } from "./silt";
import type { Toy } from "./toy";

/**
 * Every backdrop toy, in menu order; the first is the default. Culture and
 * Wax still use the old mode API (see `./mode`) and rejoin as each is
 * ported to `Toy`.
 */
export const MODES: Toy[] = [shimmer, pond, pinbed, silt, mote];
