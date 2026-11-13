import { culture } from "./culture";
import { mote } from "./mote";
import { pinbed } from "./pinbed";
import { pond } from "./pond";
import { shimmer } from "./shimmer";
import { silt } from "./silt";
import { wax } from "./wax";
import { bubblewrap } from "./bubblewrap";
import { fireflies } from "./fireflies";
import { dominoes } from "./dominoes";
import { cradle } from "./cradle";
import type { Toy } from "./toy";

/**
 * Every backdrop toy, in menu order; the first is the default.
 */
export const TOYS: Toy[] = [
  shimmer,
  pond,
  pinbed,
  culture,
  wax,
  silt,
  mote,
  bubblewrap,
  fireflies,
  dominoes,
  cradle,
];
