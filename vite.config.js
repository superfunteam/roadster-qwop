import { defineConfig } from "vite";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Finalize after Vite has copied public/ and emitted its hashed asset names.
// Every release gets a content-addressed cache; no stale hand-written filenames.
function offlineGame() {
  let config;
  return {
    name: "roadster-offline-game",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      const output = path.resolve(config.root, config.build.outDir);
      async function filesUnder(directory) {
        const files = [];
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) files.push(...(await filesUnder(file)));
          else files.push(file);
        }
        return files;
      }
      const files = (await filesUnder(output))
        .filter(
          (file) => path.basename(file) !== "sw.js" && !file.endsWith(".map"),
        )
        .sort();
      const hash = createHash("sha256");
      const urls = [];
      for (const file of files) {
        const url = "/" + path.relative(output, file).split(path.sep).join("/");
        urls.push(url);
        hash.update(url).update(await readFile(file));
      }
      const source = await readFile(
        path.join(config.root, "public/sw.js"),
        "utf8",
      );
      const worker = source
        .replace("__BUILD_VERSION__", hash.digest("hex").slice(0, 16))
        .replace(/\/\*__PRECACHE__\*\/\s*\[\]/, JSON.stringify(urls));
      if (
        worker.includes("__BUILD_VERSION__") ||
        worker.includes("/*__PRECACHE__*/")
      ) {
        throw new Error("Offline worker template markers were not replaced.");
      }
      await writeFile(path.join(output, "sw.js"), worker);
      console.log(`Offline game: ${urls.length} production assets precached.`);
    },
  };
}

export default defineConfig({
  // Netlify supplies the deployed commit. Reports can identify a stale build
  // without collecting additional device data or making a network request.
  define: { __ROADSTER_BUILD__: JSON.stringify(process.env.COMMIT_REF || "local") },
  plugins: [offlineGame()],
  // Exercise cross-origin and opaque-origin player frames in local QA.
  server: {
    cors: {
      origin: [
        /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/,
        "null",
      ],
    },
  },
  preview: { cors: true },
  build: {
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      input: {
        game: fileURLToPath(new URL("./index.html", import.meta.url)),
        player: fileURLToPath(new URL("./player/index.html", import.meta.url)),
      },
    },
  },
});
