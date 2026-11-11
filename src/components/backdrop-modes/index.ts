import type { Mode } from "./mode";
import { shimmer } from "./shimmer";
import { wax } from "./wax";

/** Every backdrop mode, in menu order; the first is the default. */
export const MODES: Mode[] = [shimmer, wax];
