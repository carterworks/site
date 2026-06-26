import { execFile, spawn } from "node:child_process";
import { access, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import sharp from "sharp";

const exec = promisify(execFile);
const imageExtensions = new Set([".jpeg", ".jpg", ".png", ".webp"]);
const videoExtensions = new Set([".m4v", ".mov", ".mp4"]);

const usage = `Usage: pnpm assets [path...] [--widths=600,1000,1400] [--quality=60] [--out=public/assets|same]

Examples:
  pnpm assets
  pnpm assets ./incoming
  pnpm assets ./photo.png ./more-photos
  pnpm assets ./incoming --out=same
  pnpm assets ./incoming --widths=480,960 --quality=55`;

/** @typedef {{ inputs: string[], out: string, outDir?: string, quality: number, widths: number[] }} Options */
/** @typedef {"image" | "video"} AssetKind */

/**
 * @param {string} message
 * @returns {never}
 */
const fail = (message) => {
  console.error(message);
  console.error(usage);
  process.exit(1);
};

/** @returns {Options} */
const options = () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      out: { type: "string", default: "public/assets" },
      quality: { type: "string", default: "60" },
      widths: { type: "string", default: "600,1000,1400" },
    },
  });

  if (values.help) {
    console.log(usage);
    process.exit(0);
  }

  return {
    inputs: positionals,
    out: values.out,
    quality: Number.parseInt(values.quality, 10),
    widths: values.widths
      .split(",")
      .map((value) => Number.parseInt(value, 10))
      .filter((width) => Number.isFinite(width) && width > 0),
  };
};

const assetPath = (file) =>
  file === "public/assets" || file.startsWith("public/assets/");

/**
 * @param {string} value
 * @returns {string}
 */
const slug = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * @param {string} file
 * @returns {Promise<boolean>}
 */
const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};

/**
 * @param {string} file
 * @returns {AssetKind | undefined}
 */
const kind = (file) => {
  const extension = path.extname(file).toLowerCase();
  const basename = path.basename(file, extension);

  if (imageExtensions.has(extension) && !/-\d+$/.test(basename)) return "image";
  if (videoExtensions.has(extension)) return "video";
};

/**
 * @param {string[]} command
 * @param {"ignore" | "inherit"} [stdio]
 * @returns {Promise<void>}
 */
const run = (command, stdio = "inherit") =>
  new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command[0]} exited with ${code}`)),
    );
  });

/** @returns {Promise<void>} */
const requireFfmpeg = () =>
  run(["ffmpeg", "-version"], "ignore").catch(() =>
    fail("ffmpeg is required to convert video assets."),
  );

/**
 * @param {string} input
 * @returns {Promise<string[]>}
 */
const collect = async (input) => {
  const inputPath = path.resolve(input);
  const inputStat = await stat(inputPath);

  if (inputStat.isFile()) return kind(inputPath) ? [inputPath] : [];

  /** @type {string[]} */
  const files = [];
  for (const entry of await readdir(inputPath, { withFileTypes: true })) {
    files.push(...(await collect(path.join(inputPath, entry.name))));
  }
  return files;
};

/** @returns {Promise<string[]>} */
const gitFiles = async () => {
  const { stdout } = await exec("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);

  return stdout
    .split("\n")
    .filter((file) => file && !assetPath(file) && kind(file));
};

/**
 * @param {string} input
 * @param {Options} opts
 * @returns {Promise<string>}
 */
const outputDir = async (input, opts) => {
  const dir = opts.out === "same" ? path.dirname(input) : opts.out;
  await mkdir(dir, { recursive: true });
  return dir;
};

/**
 * @param {string} input
 * @param {Options} opts
 * @returns {Promise<string[]>}
 */
const convertImage = async (input, opts) => {
  const metadata = await sharp(input).metadata();
  if (!metadata.width)
    throw new Error(`Could not determine image width: ${input}`);

  const name = slug(path.basename(input, path.extname(input)));
  if (!name) throw new Error(`Invalid output name: ${input}`);

  const widths = [...new Set(opts.widths)]
    .sort((a, b) => a - b)
    .filter((width) => width <= metadata.width);
  /** @type {{ width: number, output: string }[]} */
  const outputs = (widths.length ? widths : [metadata.width]).map((width) => ({
    width,
    output: path.join(opts.outDir, `${name}-${width}.avif`),
  }));

  /** @type {string[]} */
  const generated = [];
  for (const { output, width } of outputs) {
    if (await exists(output)) continue;
    await sharp(input)
      .resize({ width, withoutEnlargement: true })
      .avif({ quality: opts.quality, effort: 6, chromaSubsampling: "4:2:0" })
      .toFile(output);
    generated.push(output);
  }
  return generated;
};

/**
 * @param {string} input
 * @param {Options} opts
 * @returns {Promise<string[]>}
 */
const convertVideo = async (input, opts) => {
  const name = slug(path.basename(input, path.extname(input)));
  if (!name) throw new Error(`Invalid output name: ${input}`);

  const output = path.join(opts.outDir, `${name}.webm`);
  if (await exists(output)) return [];

  await run([
    "ffmpeg",
    "-hide_banner",
    "-i",
    input,
    "-vf",
    "scale=min(1280\\,iw):-2",
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "34",
    "-b:v",
    "0",
    "-deadline",
    "good",
    "-cpu-used",
    "2",
    "-row-mt",
    "1",
    "-an",
    output,
  ]);

  return [output];
};

const opts = options();
if (opts.widths.length === 0) fail("At least one width is required.");
if (!Number.isFinite(opts.quality) || opts.quality < 1 || opts.quality > 100) {
  fail("Quality must be a number between 1 and 100.");
}

/** @type {string[]} */
const inputs = [
  ...new Set(
    opts.inputs.length === 0
      ? await gitFiles()
      : (await Promise.all(opts.inputs.map(collect))).flat(),
  ),
].sort();
if (inputs.length === 0) {
  console.error("No source assets found.");
  process.exit(0);
}

if (inputs.some((input) => kind(input) === "video")) await requireFfmpeg();

/** @type {string[]} */
const generated = [];
for (const input of inputs) {
  opts.outDir = await outputDir(input, opts);
  generated.push(
    ...(kind(input) === "video"
      ? await convertVideo(input, opts)
      : await convertImage(input, opts)),
  );
}

if (generated.length === 0) {
  console.error(`No new assets needed for ${inputs.length} source asset(s).`);
  process.exit(0);
}

console.error("Generated:");
for (const file of generated) console.log(file);
console.error(`Processed ${inputs.length} source asset(s).`);
