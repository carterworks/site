import { createClient } from "@sanity/client";
import {
  SANITY_API_VERSION,
  SANITY_DATASET,
  SANITY_PROJECT_ID,
} from "astro:env/server";

if (!SANITY_PROJECT_ID) {
  throw new Error("Missing SANITY_PROJECT_ID. Add it to .env before building.");
}

export const sanity = createClient({
  projectId: SANITY_PROJECT_ID,
  dataset: SANITY_DATASET,
  apiVersion: SANITY_API_VERSION,
  useCdn: false,
});
