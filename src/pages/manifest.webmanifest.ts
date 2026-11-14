import { displaysFor } from "../components/pixel-backdrop/backdrop-displays";

const [site] = displaysFor("light");

export function GET() {
  return Response.json({
    name: "carter.works",
    short_name: "carter.works",
    description: "A developer from Utah.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: site.page.bg,
    theme_color: site.page.bg,
    icons: [
      { src: "/favicon.png", sizes: "32x32", type: "image/png" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  });
}
