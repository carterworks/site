import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { render, type Node } from "takumi-js";
import {
  DISPLAYS,
  type DisplayLook,
} from "../../components/pixel-backdrop/backdrop-displays";
import { getPostTitle, getPublishedPosts } from "../../lib/blog";
import { formatDateLong } from "../../lib/date";
import {
  cardLandscape,
  HORIZON,
  litText,
  OG_HEIGHT,
  OG_WIDTH,
  paint,
  PEAKS,
  seedOf,
  type Look,
} from "../../lib/og-pixels";
import { pages } from "../../lib/pages";

type Scene = "horizon" | "peaks" | "display";

type Card = {
  id: string;
  label: string;
  line?: string;
  scene: Scene;
  title?: string;
};

const SIZE = 48;
const PAGE = "oklch(98% 0 0)";
const TEXT = "oklch(18% 0 0)";
/** The backdrop's light-mode ink, `--backdrop-light-ink` in global.css. */
const SITE_LOOK: Look = { ink: "#8a8a99", gap: 2, levels: 5 };
const POCKET = DISPLAYS.find(({ id }) => id === "pocket-lcd")
  ?.look as DisplayLook;
/** Finer than the backdrop's grid, so a title lit into it stays legible. */
const DISPLAY_COLUMNS = 120;

const fonts = [
  {
    name: "InterVariable",
    data: await readFile("public/InterVariable.woff2"),
    weight: 400,
    style: "normal" as const,
  },
];
const avatar = await sharp("public/assets/avatar-460.avif")
  .resize(96, 96)
  .png()
  .toBuffer();

const pathLabel = (path: string) => (path === "/" ? "" : path.slice(0, -1));

export async function getStaticPaths() {
  const posts = await getPublishedPosts();
  const pageCards: Record<string, Partial<Card>> = {
    index: { title: undefined, scene: "peaks" },
    blog: { line: `${posts.length} posts` },
    play: { scene: "display" },
  };
  const cards: Card[] = [
    ...Object.entries(pages).map(([path, metadata]) => ({
      id: metadata.id,
      label: pathLabel(path),
      scene: "horizon" as const,
      title: metadata.ogTitle,
      ...pageCards[metadata.id],
    })),
    ...posts.map((post) => ({
      id: post.id,
      label: "/blog",
      line: formatDateLong(post.data.pubDate),
      scene: "horizon" as const,
      title: getPostTitle(post),
    })),
  ];

  return cards.map((card) => ({ params: { id: card.id }, props: { card } }));
}

const text = (content: string, style = {}): Node => ({
  type: "text",
  text: content,
  style,
});

/** The site's header: everything is one size, and only names are bold. */
function header({ label }: Card, plate?: string): Node {
  const plated = plate ? { backgroundColor: plate, padding: "0 12px" } : {};
  return {
    type: "container",
    style: {
      alignItems: "center",
      display: "flex",
      justifyContent: "space-between",
    },
    children: [
      {
        type: "container",
        style: { alignItems: "center", display: "flex", ...plated },
        children: [
          {
            type: "image",
            src: avatar,
            style: {
              borderRadius: 999,
              height: SIZE,
              marginRight: 16,
              width: SIZE,
            },
          },
          text("Carter McBride", { fontWeight: 700 }),
        ],
      },
      ...(label ? [text(label, plated)] : []),
    ],
  };
}

async function backdrop(card: Card) {
  const seed = seedOf(card.id);
  if (card.scene !== "display") {
    const terrain = card.scene === "peaks" ? PEAKS : HORIZON;
    return paint(cardLandscape(seed, terrain), SITE_LOOK);
  }
  const mask = await render(
    {
      type: "container",
      style: {
        alignItems: "flex-end",
        backgroundColor: "#000",
        color: "#fff",
        display: "flex",
        fontFamily: "InterVariable",
        fontSize: 150,
        fontWeight: 800,
        height: "100%",
        padding: "0 80px 110px",
        width: "100%",
      },
      children: [text(card.title ?? "")],
    },
    { width: OG_WIDTH, height: OG_HEIGHT, format: "raw", fonts },
  );
  return paint(litText(mask, seed, DISPLAY_COLUMNS), POCKET);
}

async function cardNode(card: Card): Promise<Node> {
  const display = card.scene === "display";
  return {
    type: "container",
    style: {
      backgroundColor: display ? POCKET.base : PAGE,
      color: display ? POCKET.ink : TEXT,
      display: "flex",
      flexDirection: "column",
      fontFamily: "InterVariable",
      fontSize: SIZE,
      height: "100%",
      lineHeight: 1.3,
      padding: "56px 64px",
      width: "100%",
    },
    children: [
      {
        type: "image",
        src: await backdrop(card),
        style: {
          height: OG_HEIGHT,
          inset: 0,
          position: "absolute",
          width: OG_WIDTH,
        },
      },
      header(card, display ? POCKET.base : undefined),
      ...(display
        ? []
        : [
            {
              type: "container" as const,
              style: {
                display: "flex",
                flexDirection: "column" as const,
                marginTop: SIZE * 1.3,
                maxWidth: 960,
              },
              children: [
                ...(card.title ? [text(card.title, { fontWeight: 700 })] : []),
                ...(card.line ? [text(card.line)] : []),
              ],
            },
          ]),
    ],
  };
}

export async function GET({ props }: { props: { card: Card } }) {
  const image = await render(await cardNode(props.card), {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    format: "webp",
    quality: 85,
    fonts,
    emoji: "from-font",
  });

  const body = new ArrayBuffer(image.byteLength);
  new Uint8Array(body).set(image);

  return new Response(body, {
    headers: {
      "Content-Type": "image/webp",
    },
  });
}
