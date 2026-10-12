import { adopt } from "alchemy/AdoptPolicy";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Stage from "alchemy/Stage";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "carterworks",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Stage.Stage;
    const site = yield* Cloudflare.Website.StaticSite("Website", {
      name: "carterworks",
      compatibility: { date: "2024-09-03" },
      command: "pnpm run build",
      outdir: "dist",
      dev: { command: "pnpm run dev" },
      assets: { notFoundHandling: "404-page" },
    });

    // Serve the Worker on carter.works with a route instead of a custom
    // domain. The hostname already carries proxied DNS records from the old
    // Pages project, which a Workers custom domain refuses to attach over.
    // Routes win over custom domains, so adopting the existing route (if
    // Pages created one) repoints the hostname at this Worker without
    // touching DNS.
    if (stage === "prod") {
      const zone = yield* Cloudflare.Zone.Zone("CarterWorks", {
        name: "carter.works",
      }).pipe(adopt(true));

      yield* Cloudflare.Workers.WorkerRoute("CarterWorksRoute", {
        zoneId: zone.zoneId,
        pattern: "carter.works/*",
        script: site.workerName,
      }).pipe(adopt(true));
    }

    return { url: site.url };
  }),
);
