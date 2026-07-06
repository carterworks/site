import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { render } from "takumi-js";

const width = 1200;
const height = 630;
const outDir = "public/og";
const font = await readFile("public/InterVariable.woff2");
const avatar = await sharp("public/assets/avatar-460.avif")
  .resize(96, 96)
  .png()
  .toBuffer();
const avatarSrc = `data:image/png;base64,${avatar.toString("base64")}`;

/** @typedef {{ description?: string, draft: boolean, id: string, pathLabel: string, title: string }} Card */

/**
 * @param {string} file
 * @returns {string}
 */
const slug = (file) =>
  path.basename(file, path.extname(file)).toLowerCase().replaceAll(".", "");

/**
 * @param {string} value
 * @returns {string}
 */
const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/**
 * @param {string} markdown
 * @returns {string}
 */
const markdownToText = (markdown) =>
  markdown
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_~#>]/g, "")
    .trim();

/**
 * @param {string} file
 * @returns {Promise<Card>}
 */
const readPost = async (file) => {
  const source = await readFile(file, "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`Missing frontmatter: ${file}`);

  const data = Object.fromEntries(
    match[1].split("\n").flatMap((line) => {
      const separator = line.indexOf(":");
      if (separator === -1) return [];
      const key = line.slice(0, separator).trim();
      const value = line
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");
      return [[key, value]];
    }),
  );

  const firstLine = match[2]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  const title = data.title?.trim() || markdownToText(firstLine ?? "Untitled");
  const description = data.description?.trim() || undefined;
  return {
    description,
    draft: data.draft === "true",
    id: slug(file),
    pathLabel: "/blog",
    title,
  };
};

/**
 * @param {string} dir
 * @returns {Promise<Card[]>}
 */
const collectPosts = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const posts = await Promise.all(
    entries.map((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectPosts(file);
      return path.extname(entry.name) === ".md" && !entry.name.startsWith("_")
        ? readPost(file)
        : [];
    }),
  );
  return posts.flat();
};

/**
 * @param {string} title
 * @param {string | undefined} description
 * @param {string} pathLabel
 * @returns {string}
 */
const card = (title, description, pathLabel) => `
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

await mkdir(outDir, { recursive: true });

/** @type {string[]} */
const generated = [];
const cards = [
  {
    draft: false,
    id: "index",
    pathLabel: "",
    title: "Carter | A developer from Utah.",
  },
  {
    description: "A software engineer's blog? How original.",
    draft: false,
    id: "blog",
    pathLabel: "/blog",
    title: "All blog posts",
  },
  ...(await collectPosts("content/blog")),
];

for (const entry of cards.filter((entry) => !entry.draft)) {
  const output = path.join(outDir, `${entry.id}.webp`);
  const image = await render(
    card(entry.title, entry.description, entry.pathLabel),
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

  const current = await readFile(output).catch(() => undefined);
  if (current && Buffer.compare(current, image) === 0) continue;

  await writeFile(output, image);
  generated.push(output);
}

if (generated.length === 0) {
  console.error("No OG images changed.");
} else {
  console.error("Generated:");
  for (const file of generated) console.log(file);
}
