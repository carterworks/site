import { culture } from "./culture";
import { mote } from "./mote";
import { pinbed } from "./pinbed";
import { pond } from "./pond";
import { shimmer } from "./shimmer";
import { silt } from "./silt";
import { wax } from "./wax";
import { pendulums } from "./pendulums";
import { curtain } from "./curtain";
import { tray } from "./tray";
import { bubblewrap } from "./bubblewrap";
import { fireflies } from "./fireflies";
import { dominoes } from "./dominoes";
import { rake } from "./rake";
import { flipdots } from "./flipdots";
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
  pendulums,
  curtain,
  tray,
  bubblewrap,
  fireflies,
  dominoes,
  rake,
  flipdots,
  cradle,
];
