import { culture } from "./culture";
import { filings } from "./filings";
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
  filings,
  pendulums,
  curtain,
  tray,
  bubblewrap,
  fireflies,
  dominoes,
];
