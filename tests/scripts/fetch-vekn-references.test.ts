import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchReferences } from "../../scripts/fetch-vekn-references.mts";

const html = (title: string) => `<html><body>${title}${" x".repeat(6000)}</body></html>`;
const reply = (title: string) => new Response(html(title), { headers: { "content-type": "text/html; charset=utf-8" } });

describe("VEKN references download", () => {
  it("saves both validated HTML snapshots with source metadata and hashes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vekn-reference-test-"));
    try {
      const mock = (async (url: string | URL | Request) => reply(String(url).includes("general-rulings") ? "General Rulings" : "OUTLINE OVERVIEW")) as typeof fetch;
      const metadata = await fetchReferences(dir, mock);
      expect(metadata.sources).toHaveLength(2);
      expect(metadata.sources[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(await readFile(join(dir, "general-rulings.html"), "utf8")).toBe(html("General Rulings"));
      expect(await readFile(join(dir, "detailed-play-summary.html"), "utf8")).toBe(html("OUTLINE OVERVIEW"));
      expect(JSON.parse(await readFile(join(dir, "metadata.json"), "utf8")).sources[0].url).toBe("https://www.vekn.net/general-rulings");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("does not overwrite the previous files if the second download fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vekn-reference-test-"));
    try {
      await writeFile(join(dir, "general-rulings.html"), "previous snapshot");
      const mock = (async (url: string | URL | Request) => String(url).includes("general-rulings") ? reply("General Rulings") : new Response("error", { status: 503 })) as typeof fetch;
      await expect(fetchReferences(dir, mock)).rejects.toThrow("HTTP 503");
      expect(await readFile(join(dir, "general-rulings.html"), "utf8")).toBe("previous snapshot");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("rejects short error pages even when the server returns 200", async () => {
    const dir = await mkdtemp(join(tmpdir(), "vekn-reference-test-"));
    try {
      const mock = (async () => new Response("General Rulings", { headers: { "content-type": "text/html" } })) as typeof fetch;
      await expect(fetchReferences(dir, mock)).rejects.toThrow("nie wygląda");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
