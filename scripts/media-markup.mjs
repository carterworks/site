import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const defaultInput = "public/assets";
const imageExtensions = new Set([".avif", ".jpeg", ".jpg", ".png", ".webp"]);

const toPosix = (value) => value.split(path.sep).join("/");

const escapeAttribute = (value) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

const publicPath = (file) => {
  const relative = toPosix(path.relative("public", file));
  return relative.startsWith("..") ? toPosix(file) : `/${relative}`;
};

const collect = async (input) => {
  const inputPath = path.resolve(input);
  const inputStat = await stat(inputPath);

  if (inputStat.isFile()) {
    return imageExtensions.has(path.extname(inputPath)) ? [inputPath] : [];
  }

  const files = [];
  for (const entry of await readdir(inputPath, { withFileTypes: true })) {
    files.push(...(await collect(path.join(inputPath, entry.name))));
  }
  return files;
};

const groupKey = (file) => {
  const extension = path.extname(file).toLowerCase();
  const basename = path.basename(file, extension);
  return path.join(path.dirname(file), basename.replace(/-\d+$/, ""));
};

const image = async (file) => {
  const metadata = await sharp(file).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image size: ${file}`);
  }
  return { file, height: metadata.height, width: metadata.width };
};

const markup = (variants) => {
  const sorted = variants.toSorted((a, b) => a.width - b.width);
  const largest = sorted.at(-1);
  const attributes = [`src="${escapeAttribute(publicPath(largest.file))}"`];

  if (sorted.length > 1) {
    attributes.push(
      `srcset="${escapeAttribute(
        sorted
          .map((variant) => `${publicPath(variant.file)} ${variant.width}w`)
          .join(", "),
      )}"`,
      `sizes="(max-width: ${largest.width}px) 100vw, ${largest.width}px"`,
    );
  }

  attributes.push(
    'alt=""',
    `width="${largest.width}"`,
    `height="${largest.height}"`,
    'loading="lazy"',
    'decoding="async"',
  );

  return `<img ${attributes.join(" ")}>`;
};

const inputs = process.argv.slice(2);
const files = [
  ...new Set(
    (await Promise.all((inputs.length ? inputs : [defaultInput]).map(collect))).flat(),
  ),
];
const groups = Map.groupBy(files, groupKey);

const snippets = await Promise.all(
  [...groups.values()].map(async (files) =>
    markup(await Promise.all(files.map(image))),
  ),
);

console.log(snippets.sort().join("\n\n"));
