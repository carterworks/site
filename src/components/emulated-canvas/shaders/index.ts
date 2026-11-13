import type { Shader } from "../shader";
import { ghost } from "./ghost";
import { noise } from "./noise";
import { palette } from "./palette";

/**
 * Per-pixel passes over the logical bitmap, in order. To add an effect, write a
 * `Shader` and add it to this list.
 */
export const SHADERS: readonly Shader[] = [noise, palette, ghost];
