#!/usr/bin/env node
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? null : process.argv[index + 1];
  if (!value) throw new Error(`--${name} is required`);
  return path.resolve(value);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

async function main() {
  const input = argument("input");
  const metadataPath = argument("metadata");
  const output = argument("output");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const { width, height } = metadata.viewport;
  const rectangles = (metadata.redactions ?? [])
    .map((entry) => {
      const x = clamp(entry.x, 0, width - 1);
      const y = clamp(entry.y, 0, height - 1);
      return {
        x,
        y,
        width: clamp(entry.width, 1, width - x),
        height: clamp(entry.height, 1, height - y),
      };
    })
    .filter((entry) => entry.width > 0 && entry.height > 0);
  const filter = rectangles.length
    ? rectangles
        .map(
          (entry) =>
            `drawbox=x=${entry.x}:y=${entry.y}:w=${entry.width}:h=${entry.height}:color=0x202124@1:t=fill`,
        )
        .join(",")
    : "null";

  await mkdir(path.dirname(output), { recursive: true });
  const result = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", input, "-vf", filter, "-frames:v", "1", "-y", output],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `ffmpeg exited with ${result.status}`);
  }
  await rm(input, { force: true });
}

main().catch((error) => {
  console.error(`Screenshot redaction failed: ${error.message}`);
  process.exitCode = 1;
});
