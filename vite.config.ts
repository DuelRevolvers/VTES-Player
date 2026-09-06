import { appendFileSync, mkdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

/**
 * Writes each playthrough's log into `logs/` in the repo
 * (docs/game-log-design.md).
 *
 * DEV SERVER ONLY, and that is the whole design: the browser cannot write
 * to disk, but the owner plays through `Play VTES.bat`, which runs the dev
 * server — so the file lands in the repo, ready for Claude Code to read,
 * with nobody having to export anything. The published static site has no
 * such endpoint and the client falls back to keeping the log in memory.
 *
 * `basename` is not decoration: the file name arrives over HTTP, so
 * without it a request for `../../etc/passwd` would be honoured. It is
 * stripped to a bare name and forced under `logs/`.
 */
function gameLogPlugin(): Plugin {
  const dir = resolve(process.cwd(), "logs");
  return {
    name: "vtes-game-log",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (req.method !== "POST" || !url.startsWith("/__vtes_log/")) return next();

        const name = basename(decodeURIComponent(url.slice("/__vtes_log/".length)));
        if (!/^[\w.-]+\.log$/.test(name)) {
          res.statusCode = 400;
          res.end("bad log name");
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          try {
            mkdirSync(dir, { recursive: true });
            appendFileSync(resolve(dir, name), Buffer.concat(chunks));
            res.statusCode = 204;
            res.end();
          } catch (err) {
            // Never take the game down over a log line.
            server.config.logger.warn(`[vtes] could not write logs/${name}: ${String(err)}`);
            res.statusCode = 500;
            res.end("write failed");
          }
        });
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves from /<repo>/ — adjust base when the repo name is set.
  base: "./",
  plugins: [gameLogPlugin()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
