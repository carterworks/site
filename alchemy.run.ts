import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

// Alchemy replaces the `cf` config: this Stack is the composition root for the
// site's Cloudflare Worker. `Cloudflare.state()` persists resource state in a
// Worker-backed store so local and CI deploys agree on what is deployed.
export default Alchemy.Stack(
  "carterworks",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const site = yield* Cloudflare.Website.StaticSite("Website", {
      // Mirrors `worker.name` from the previous `cf` config so the existing
      // custom domain attachment keeps pointing at this Worker. Drop it to get
      // per-stage Worker names.
      name: "carterworks",
      compatibility: { date: "2024-09-03" },
      // Pin the build so local dev and deploys share one command.
      command: "pnpm run build",
      outdir: "dist",
      dev: { command: "pnpm run dev" },
      assets: { notFoundHandling: "404-page" },
    });

    return { url: site.url };
  }),
);
