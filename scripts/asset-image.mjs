import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";

const defaultWidths = [600, 1000, 1400];
const defaultQuality = 60;
const defaultOutputDir = "public/assets";

const usage = `Usage: pnpm asset:image <input> [name] [--widths=600,1000,1400] [--quality=60] [--out=public/assets]

Examples:
  pnpm asset:image ./photo.png
  pnpm asset:image ./photo.png my-photo
  pnpm asset:image ./photo.png --widths=480,960 --quality=55`;

const parseCli = () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      out: { type: "string" },
      quality: { type: "string" },
      widths: { type: "string" },
    },
  });

  return {
    help: values.help,
    input: positionals[0],
    name: positionals[1],
    outputDir: values.out || defaultOutputDir,
    quality: values.quality
      ? Number.parseInt(values.quality, 10)
      : defaultQuality,
    widths: values.widths
      ? values.widths
          .split(",")
          .map((value) => Number.parseInt(value, 10))
          .filter((width) => Number.isFinite(width) && width > 0)
      : defaultWidths,
  };
};

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const uniqueSorted = (values) => [...new Set(values)].sort((a, b) => a - b);

const fail = (message) => {
  console.error(message);
  console.error(usage);
  process.exit(1);
};

const options = parseCli();

if (options.help) {
  console.log(usage);
  process.exit(0);
}

if (!options.input) {
  fail("Missing input image.");
}

if (options.widths.length === 0) {
  fail("At least one width is required.");
}

if (
  !Number.isFinite(options.quality) ||
  options.quality < 1 ||
  options.quality > 100
) {
  fail("Quality must be a number between 1 and 100.");
}

const inputPath = path.resolve(options.input);
const inputName = path.basename(options.input, path.extname(options.input));
const outputName = slugify(options.name || inputName);

if (!outputName) {
  fail("Output name must contain at least one letter or number.");
}

const image = sharp(inputPath);
const metadata = await image.metadata();

if (!metadata.width) {
  fail("Could not determine image width.");
}

const widths = uniqueSorted(options.widths).filter(
  (width) => width <= metadata.width,
);
const outputWidths = widths.length > 0 ? widths : [metadata.width];

await mkdir(options.outputDir, { recursive: true });

const outputs = [];

for (const width of outputWidths) {
  const file = `${outputName}-${width}.avif`;
  const outputPath = path.join(options.outputDir, file);

  await sharp(inputPath)
    .resize({ width, withoutEnlargement: true })
    .avif({ quality: options.quality, effort: 6, chromaSubsampling: "4:2:0" })
    .toFile(outputPath);

  outputs.push({ file, width, outputPath });
}

const assetPaths = outputs.map(({ file }) => `/assets/${file}`);
const srcset = outputs
  .map(({ file, width }) => `/assets/${file} ${width}w`)
  .join(", ");

console.log("Generated:");
for (const { outputPath } of outputs) {
  console.log(`  ${outputPath}`);
}

console.log("\nSrcset:");
console.log(`  ${srcset}`);

console.log("\nFallback src:");
console.log(`  ${assetPaths[Math.floor(assetPaths.length / 2)]}`);
