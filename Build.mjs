import { cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "dist");
const excluded = new Set([
  ".git",
  ".netlify",
  "dist",
  "node_modules",
  "netlify",
]);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const name of await readdir(root)) {
  if (excluded.has(name) || name.startsWith(".") || name === "build.mjs") continue;

  const source = path.join(root, name);
  const destination = path.join(output, name);
  const info = await stat(source);

  if (info.isDirectory()) {
    await cp(source, destination, { recursive: true });
  } else if (info.isFile()) {
    await cp(source, destination);
  }
}

console.log("Static site copied to dist; Netlify functions remain outside the publish directory.");
