# [carter.works](carter.works)

👋 and ‹ from [Google's Noto Emoji](https://fonts.google.com/noto/specimen/Noto+Emoji).

## Development

This project uses Node.js and [pnpm](https://pnpm.io) for dependency management and command execution.

```sh
pnpm install
pnpm run dev
pnpm run check
pnpm run build
```

`pnpm perf` measures what a frame of each toy costs on each display, in
headless Chromium; its options are at the top of
[`scripts/perf.mjs`](./scripts/perf.mjs). Install its browser once with
`pnpm exec playwright install --no-shell chromium`. On NixOS, run it as
`nix-shell --run "pnpm perf"`. Every pull request that touches the site runs
it with `--against` its base, and reports how each frame cost moved, with the
noise to read it by; it never fails.

`pnpm budgets` builds the site and fails if it misses a performance budget:
script and font bytes, leaks, layouts and style recalculations during play, and
the canvas pixels, render passes, offscreen pixels and blended pixels each frame
asks for, each limit in [`scripts/budgets.mjs`](./scripts/budgets.mjs) with what
it covers. Each is an exact count for the pinned Chromium, never a time, so a
busy machine cannot move it; time is `pnpm perf --against`'s to report. Every
pull request runs it. It needs the same browser; on NixOS, run it as
`nix-shell --run "pnpm budgets"`. A change that does less lowers its limit too;
one that must do more raises it to the value the run printed, with the reason in
its commit.

## Deployment

The site deploys to Cloudflare as a Worker serving static assets, defined in
[`alchemy.run.ts`](./alchemy.run.ts). Alchemy builds the site, hashes `dist/`,
and uploads it.

```sh
pnpm run deploy
```

Locally, authenticate first with `pnpm exec alchemy profile edit`. CI runs the
same command as `alchemy deploy --stage prod` using `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`.

# Blog post format

Blog posts are `/content/blog/*.md`. They are `[slug].md`. `pubDate` is required frontmatter in the format `YYYY-MM-DD`. `title` and `description` are optional. Posts without a title derive one from the first non-empty line of the body.

```md
---
title: "Hello world!"
pubDate: 2024-01-02
description: "Why are there so many hello world posts and not more hello country posts? Start small, dummy."
draft: false
---

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Eleifend mi in nulla posuere sollicitudin aliquam ultrices. Luctus venenatis lectus magna fringilla urna porttitor rhoncus dolor. Suspendisse in est ante in nibh. Eros in cursus turpis massa tincidunt dui ut ornare. Porta lorem mollis aliquam ut porttitor leo. Eu volutpat odio facilisis mauris sit amet massa vitae. Amet nisl purus in mollis nunc sed id semper. Consequat id porta nibh venenatis cras sed felis. Purus faucibus ornare suspendisse sed nisi lacus sed. Maecenas volutpat blandit aliquam etiam erat velit scelerisque in. Penatibus et magnis dis parturient montes nascetur ridiculus mus. Lacus luctus accumsan tortor posuere. At auctor urna nunc id cursus. Risus nullam eget felis eget nunc lobortis mattis. Fringilla phasellus faucibus scelerisque eleifend. Imperdiet nulla malesuada pellentesque elit eget. Orci nulla pellentesque dignissim enim sit amet. Pellentesque diam volutpat commodo sed egestas.

<img src="https://placehold.co/600x400/10252C/DDD8CA?text=Hello+World" alt="A 800 placeholder image saying &quot;Hello world!&quot;" title="Hello world, but which world?" width="600" height="400" loading="lazy" decoding="async">
_The image caption goes here lorem ipsum_

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Eleifend mi in nulla posuere sollicitudin aliquam ultrices. Luctus venenatis lectus magna fringilla urna porttitor rhoncus dolor. Suspendisse in est ante in nibh. Eros in cursus turpis massa tincidunt dui ut ornare. Porta lorem mollis aliquam ut porttitor leo. Eu volutpat odio facilisis mauris sit amet massa vitae. Amet nisl purus in mollis nunc sed id semper. Consequat id porta nibh venenatis cras sed felis. Purus faucibus ornare suspendisse sed nisi lacus sed. Maecenas volutpat blandit aliquam etiam erat velit scelerisque in. Penatibus et magnis dis parturient montes nascetur ridiculus mus. Lacus luctus accumsan tortor posuere. At auctor urna nunc id cursus. Risus nullam eget felis eget nunc lobortis mattis. Fringilla phasellus faucibus scelerisque eleifend. Imperdiet nulla malesuada pellentesque elit eget. Orci nulla pellentesque dignissim enim sit amet. Pellentesque diam volutpat commodo sed egestas.

Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Eleifend mi in nulla posuere sollicitudin aliquam ultrices. Luctus venenatis lectus magna fringilla urna porttitor rhoncus dolor. Suspendisse in est ante in nibh. Eros in cursus turpis massa tincidunt dui ut ornare. Porta lorem mollis aliquam ut porttitor leo. Eu volutpat odio facilisis mauris sit amet massa vitae. Amet nisl purus in mollis nunc sed id semper. Consequat id porta nibh venenatis cras sed felis. Purus faucibus ornare suspendisse sed nisi lacus sed. Maecenas volutpat blandit aliquam etiam erat velit scelerisque in. Penatibus et magnis dis parturient montes nascetur ridiculus mus. Lacus luctus accumsan tortor posuere. At auctor urna nunc id cursus. Risus nullam eget felis eget nunc lobortis mattis. Fringilla phasellus faucibus scelerisque eleifend. Imperdiet nulla malesuada pellentesque elit eget. Orci nulla pellentesque dignissim enim sit amet. Pellentesque diam volutpat commodo sed egestas.
```
