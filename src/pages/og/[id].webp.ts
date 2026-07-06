import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { render } from "takumi-js";
import {
  getPostDescription,
  getPostTitle,
  getPublishedPosts,
} from "../../lib/blog";

type Card = {
  description?: string;
  id: string;
  pathLabel: string;
  title: string;
};

const width = 1200;
const height = 630;
const font = await readFile("public/InterVariable.woff2");
const avatar = await sharp("public/assets/avatar-460.avif")
  .resize(96, 96)
  .png()
  .toBuffer();
const avatarSrc = `data:image/png;base64,${avatar.toString("base64")}`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function card(
  title: string,
  description: string | undefined,
  pathLabel: string,
): string {
  return `
    <div style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:space-between;background:#f8f8f8;color:#111;padding:72px;font-family:InterVariable,sans-serif;">
      <div style="max-width:980px;">
        <div style="font-size:76px;font-weight:760;line-height:0.98;letter-spacing:-0.05em;">${escapeHtml(title)}</div>
        ${description ? `<div style="margin-top:28px;font-size:34px;font-weight:520;line-height:1.15;letter-spacing:-0.03em;color:#444;">${escapeHtml(description)}</div>` : ""}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:34px;font-weight:700;letter-spacing:-0.03em;">
        <div style="display:flex;align-items:center;">
          <img src="${avatarSrc}" alt="" style="width:48px;height:48px;border-radius:999px;margin-right:14px;" />
          <div>Carter McBride | carter.works</div>
        </div>
        ${pathLabel ? `<div>${escapeHtml(pathLabel)}</div>` : ""}
      </div>
    </div>
  `;
}

export async function getStaticPaths() {
  const posts = await getPublishedPosts();
  const cards: Card[] = [
    {
      id: "index",
      pathLabel: "",
      title: "Carter | A developer from Utah.",
    },
    {
      description: "A software engineer's blog? How original.",
      id: "blog",
      pathLabel: "/blog",
      title: "All blog posts",
    },
    ...posts.map((post) => ({
      description: getPostDescription(post),
      id: post.id,
      pathLabel: "/blog",
      title: getPostTitle(post),
    })),
  ];

  return cards.map((card) => ({
    params: { id: card.id },
    props: { card },
  }));
}

export async function GET(context: { props: { card: Card } }) {
  const image = await render(
    card(
      context.props.card.title,
      context.props.card.description,
      context.props.card.pathLabel,
    ),
    {
      width,
      height,
      format: "webp",
      quality: 85,
      fonts: [
        { name: "InterVariable", data: font, weight: 400, style: "normal" },
      ],
      emoji: "from-font",
    },
  );

  const body = new ArrayBuffer(image.byteLength);
  new Uint8Array(body).set(image);

  return new Response(body, {
    headers: {
      "Content-Type": "image/webp",
    },
  });
}
