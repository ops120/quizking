// scripts/make-icons.mjs
// One-shot icon rasterizer for src/icons/icon.svg -> icon{16,48,128}.png.
// Strategy:
//   1. Try `sharp` via dynamic import. If it's not on the resolution path,
//      look for a sibling tooling install at ../_icontools/node_modules and
//      register it via `require` so Node's resolver can pick it up.
//   2. Otherwise, spawn an external rasterizer through child_process in this
//      order: inkscape > ImageMagick `magick` > ImageMagick legacy `convert`
//      (skipping Windows' filesystem CONVERT.EXE) > rsvg-convert.
//
// Usage:
//   node scripts/make-icons.mjs
//
// Outputs PNGs alongside icon.svg. Idempotent.

import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ICONS_DIR = resolve(ROOT, "src", "icons");
const SVG_PATH = resolve(ICONS_DIR, "icon.svg");
const TOOL_NODE_MODULES = resolve(ROOT, "_icontools", "node_modules");
const SIZES = [16, 48, 128];

function log(...args) {
  console.log("[make-icons]", ...args);
}

// Make a sibling tooling install visible without mutating global require cache
// or the repo's package.json.
function tryRegisterTooling() {
  if (!existsSync(TOOL_NODE_MODULES)) return false;
  if (process.env.NODE_PATH && process.env.NODE_PATH.includes(TOOL_NODE_MODULES)) return true;
  const require = createRequire(`${ROOT}/_preload.js`);
  try {
    require.resolve("sharp", { paths: [TOOL_NODE_MODULES] });
  } catch {
    return false;
  }
  // Append to NODE_PATH so subsequent dynamic imports resolve.
  process.env.NODE_PATH = process.env.NODE_PATH
    ? `${process.env.NODE_PATH};${TOOL_NODE_MODULES}`
    : TOOL_NODE_MODULES;
  // Module._initPaths() is internal; use Module's cache invalidation through require.
  const Module = require("module");
  if (typeof Module._initPaths === "function") Module._initPaths();
  return true;
}

function which(bin) {
  const cmd = process.platform === "win32" ? "where" : "which";
  const r = spawnSync(cmd, [bin], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const first = r.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .find((line) => !/\bconvert\.exe$/i.test(line));
  return first || null;
}

async function loadSharp() {
  try {
    const mod = await import("sharp");
    return mod.default ?? mod;
  } catch {}
  if (existsSync(resolve(TOOL_NODE_MODULES, "sharp"))) {
    const { createRequire } = await import("node:module");
    const req = createRequire(`${TOOL_NODE_MODULES}/_preload.js`);
    return req("sharp");
  }
  return null;
}

async function renderWithSharp(svgBuf) {
  const sharp = await loadSharp();
  if (!sharp) throw new Error("sharp module is not installed");
  const out = {};
  for (const size of SIZES) {
    const png = await sharp(svgBuf, { density: 384 })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    out[size] = png;
  }
  return out;
}

function renderWithInkscape(svgPath) {
  const out = {};
  for (const size of SIZES) {
    const target = resolve(ICONS_DIR, `icon${size}.png`);
    const r = spawnSync(
      "inkscape",
      [svgPath, "--export-type=png", `--export-filename=${target}`, "-w", String(size), "-h", String(size)],
      { encoding: "utf8" }
    );
    if (r.status !== 0) throw new Error(`inkscape failed for ${size}: ${r.stderr || r.stdout}`);
    out[size] = target;
  }
  return out;
}

function renderWithImageMagick(svgPath) {
  let bin = which("magick");
  let modern = true;
  if (!bin) {
    const legacy = which("convert");
    if (!legacy) throw new Error("neither magick nor (real) convert found in PATH");
    bin = legacy;
    modern = false;
  }
  const out = {};
  for (const size of SIZES) {
    const target = resolve(ICONS_DIR, `icon${size}.png`);
    const args = modern
      ? [svgPath, "-resize", `${size}x${size}`, target]
      : [svgPath, "-resize", `${size}x${size}`, target];
    const r = spawnSync(bin, args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${bin} failed for ${size}: ${r.stderr || r.stdout}`);
    out[size] = target;
  }
  return out;
}

function renderWithRsvg(svgPath) {
  const bin = which("rsvg-convert");
  if (!bin) throw new Error("rsvg-convert not found in PATH");
  const out = {};
  for (const size of SIZES) {
    const target = resolve(ICONS_DIR, `icon${size}.png`);
    const r = spawnSync(bin, ["-w", String(size), "-h", String(size), svgPath, "-o", target], {
      encoding: "utf8"
    });
    if (r.status !== 0) throw new Error(`rsvg-convert failed for ${size}: ${r.stderr || r.stdout}`);
    out[size] = target;
  }
  return out;
}

async function main() {
  if (!existsSync(SVG_PATH)) {
    console.error(`[make-icons] missing SVG: ${SVG_PATH}`);
    process.exit(1);
  }
  await mkdir(ICONS_DIR, { recursive: true });

  tryRegisterTooling();

  const svgBuf = await readFile(SVG_PATH);
  let pngBuffers = null;
  let renderedVia = null;

  try {
    pngBuffers = await renderWithSharp(svgBuf);
    renderedVia = "sharp";
  } catch (err) {
    log("sharp unavailable or failed:", err.message);
  }

  if (!pngBuffers) {
    const tries = [
      ["inkscape", () => renderWithInkscape(SVG_PATH)],
      ["imagemagick", () => renderWithImageMagick(SVG_PATH)],
      ["rsvg-convert", () => renderWithRsvg(SVG_PATH)]
    ];
    for (const [name, fn] of tries) {
      try {
        const paths = fn();
        renderedVia = name;
        pngBuffers = {};
        for (const [size, p] of Object.entries(paths)) {
          pngBuffers[size] = await readFile(p);
        }
        break;
      } catch (err) {
        log(`${name} failed:`, err.message);
      }
    }
  }

  if (!pngBuffers) {
    console.error("[make-icons] no rasterizer available (sharp / inkscape / magick / rsvg-convert).");
    process.exit(2);
  }

  const results = [];
  for (const size of SIZES) {
    const outPath = resolve(ICONS_DIR, `icon${size}.png`);
    const buf = pngBuffers[size];
    if (!buf || buf.length === 0) {
      console.error(`[make-icons] empty render for ${size}px`);
      process.exit(3);
    }
    await writeFile(outPath, buf);
    const s = await stat(outPath);
    results.push({ size, path: outPath, bytes: s.size });
  }

  log(`rendered via ${renderedVia}`);
  for (const r of results) log(`icon${r.size}.png -> ${r.bytes} bytes`);
}

main().catch((err) => {
  console.error("[make-icons] fatal:", err);
  process.exit(99);
});
