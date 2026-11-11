import { culture } from "./culture";
import type { Mode } from "./mode";
import { pinbed } from "./pinbed";
import { pond } from "./pond";
import { shimmer } from "./shimmer";
import { silt } from "./silt";
import { wax } from "./wax";

/** Every backdrop mode, in menu order; the first is the default. */
export const MODES: Mode[] = [shimmer, pond, pinbed, culture, wax, silt];
