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

    if (stage === "prod") {
      const zone = yield* Cloudflare.Zone.Zone("CarterWorks", {
        name: "carter.works",
      }).pipe(adopt(true));

      // The apex record the route depends on. Points at the Worker's
      // workers.dev origin rather than the retired Pages project, so the
      // record still resolves even if the route is ever dropped.
      yield* Cloudflare.DNS.Record("CarterWorksApex", {
        zoneId: zone.zoneId,
        name: "carter.works",
        type: "CNAME",
        content: "carterworks.carterworks.workers.dev",
        proxied: true,
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
