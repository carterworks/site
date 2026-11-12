import { culture } from "./culture";
import { mote } from "./mote";
import { pendulums } from "./pendulums";
import { pinbed } from "./pinbed";
import { pond } from "./pond";
import { shimmer } from "./shimmer";
import { silt } from "./silt";
import { wax } from "./wax";
import type { Toy } from "./toy";

/**
 * Every backdrop toy, in menu order; the first is the default.
 */
export const MODES: Toy[] = [
  shimmer,
  pond,
  pinbed,
  culture,
  wax,
  silt,
  mote,
  pendulums,
];
