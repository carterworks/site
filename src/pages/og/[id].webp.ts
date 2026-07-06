import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { render } from "takumi-js";
import {
  getPostDescription,
  getPostTitle,
  getPublishedPosts,
} from "../../lib/blog";
import { getPageMetadata } from "../../lib/pages";

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
  const repeatedDescription = description && title.includes(description);
  const content = `
    <div><strong>${escapeHtml(title)}</strong></div>
    ${description && !repeatedDescription ? `<div style="margin-top:1.3em;">${escapeHtml(description)}</div>` : ""}
  `;

  return `
    <div style="width:100%;height:100%;display:flex;flex-direction:column;background:oklch(98% 0 0);color:oklch(18% 0 0);padding:48px;font-family:InterVariable,sans-serif;font-size:52px;font-weight:400;line-height:1.3;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:48px;">
        <div style="display:flex;align-items:center;">
          <img src="${avatarSrc}" alt="" style="width:39px;height:39px;border-radius:999px;margin-right:12px;" />
          <div>Carter McBride | carter.works</div>
        </div>
        ${pathLabel ? `<div>${escapeHtml(pathLabel)}</div>` : ""}
      </div>
      <div>${content}</div>
    </div>
  `;
}

function pathLabel(path: string): string {
  return path === "/" ? "" : path.replace(/\/$/, "");
}

export async function getStaticPaths() {
  const posts = await getPublishedPosts();
  const pagePaths = ["/", "/blog/"];
  const cards: Card[] = [
    ...pagePaths.map((path) => {
      const metadata = getPageMetadata(path);
      if (!metadata) throw new Error(`Missing page metadata: ${path}`);
      return {
        description: metadata.description,
        id: metadata.id,
        pathLabel: pathLabel(path),
        title: metadata.ogTitle,
      };
    }),
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
