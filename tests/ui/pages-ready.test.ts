/**
 * PHASE 9 — is this thing publishable? (docs/pages-design.md)
 *
 * The client is served from GitHub Pages as a plain static bundle at
 * `https://<user>.github.io/<repo>/` — a SUBDIRECTORY, with no server
 * behind it. Three classes of thing break there and nowhere else, and all
 * three are invisible when you run the dev server at the root:
 *
 *  1. an asset referenced from the site ROOT (`/assets/...`) 404s, because
 *     the site does not live at the root;
 *  2. anything that needed the dev server (the game-log sink) is simply
 *     not there;
 *  3. the things a published page owes its visitors — a title, a favicon,
 *     and, for this project, the Dark Pack attribution — are easy to leave
 *     until "later" and then ship without.
 *
 * These are source-level checks on purpose. A test that inspected `dist/`
 * would only run after a build and would pass vacuously when there was
 * none; these fail the moment somebody writes the thing that would break
 * the deploy.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CREDITS } from "../../src/ui/rules.ts";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string): string => readFileSync(join(root, p), "utf8");

describe("the published bundle", () => {
  it("builds with a RELATIVE base, so it works from a subdirectory", () => {
    // `base: "./"` is the one line that makes the same bundle work at
    // /<repo>/ without the repo name being compiled into it.
    const config = read("vite.config.ts");
    expect(config).toMatch(/base:\s*"\.\/"/);
  });

  it("keeps the dev-only log sink out of the published site", () => {
    // `apply: "serve"` is what stops the log middleware being part of the
    // build. Without it the plugin would run in `vite build` and the
    // published client would POST to an endpoint that does not exist.
    const config = read("vite.config.ts");
    expect(config).toMatch(/apply:\s*"serve"/);
  });

  it("has a deploy workflow that publishes dist/", () => {
    const wf = read(".github/workflows/pages.yml");
    expect(wf).toContain("actions/deploy-pages");
    expect(wf).toMatch(/path:\s*dist/);
    expect(wf).toContain("npm run build");
  });
});

describe("what a visitor gets", () => {
  const html = read("index.html");

  it("names itself in the tab, and says what it is", () => {
    expect(html).toMatch(/<title>[^<]*Vampire[^<]*<\/title>/);
    expect(html).toMatch(/<meta\s+name="description"/);
  });

  it("carries a favicon that cannot 404 from a subdirectory", () => {
    // A data URI fetches nothing and needs no path, which is the point:
    // a `/favicon.ico` would be looked for at the SITE root, not the
    // app's, and would 404 on Pages for every visitor.
    expect(html).toMatch(/rel="icon"/);
    expect(html).toContain("data:image/svg+xml");
    expect(html).not.toMatch(/rel="icon"[^>]*href="\//);
  });

  it("references no asset from the site root", () => {
    // `/src/main.ts` is rewritten by the build; anything else absolute is
    // a 404 waiting to happen.
    const absolute = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]);
    expect(absolute.filter((p) => p !== "/src/main.ts")).toEqual([]);
  });
});

describe("the Dark Pack obligation", () => {
  /** Prose is wrapped in source, so a phrase can straddle a line break —
   *  the assertion is about the WORDS being there, not the wrapping. */
  const flat = (s: string): string => s.replace(/\s+/g, " ");

  it("states the notice, in full, in the credits", () => {
    // Non-negotiable for this project: a non-commercial fan work under
    // Paradox's Dark Pack, with card data and scans from KRCG.
    const credits = flat(CREDITS);
    expect(credits).toContain("Dark Pack");
    expect(credits).toContain("Paradox Interactive");
    expect(credits).toContain("worldofdarkness.com");
    expect(credits).toContain("KRCG");
  });

  it("also puts it on the FIRST SCREEN, not only behind a modal", () => {
    // It lived only in How to Play, which a visitor has to go looking
    // for. Published, the attribution should be readable without hunting.
    const shell = read("src/ui/shell.ts");
    const menu = flat(
      shell.slice(shell.indexOf("menuScreen"), shell.indexOf("// --- new game")),
    );
    expect(menu).toContain("Dark Pack");
    expect(menu).toContain("Paradox Interactive");
    expect(menu).toContain("KRCG");
  });
});
