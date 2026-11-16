/** Download official reference pages as HTML, preserving their links and notices. */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sources = [
  { file: "general-rulings.html", title: "General Rulings", url: "https://www.vekn.net/general-rulings" },
  { file: "detailed-play-summary.html", title: "Detailed Play Summary", url: "https://www.vekn.net/detailed-play-summary" },
] as const;

export async function fetchReferences(outputDir: string, fetcher: typeof fetch = fetch) {
  // Download and validate everything before writing anything: a failed fetch
  // must not silently replace a previously useful reference with an error page.
  const pages = [];
  for (const source of sources) {
    const response = await fetcher(source.url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${source.url}: HTTP ${response.status}`);
    const type = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const expected = source.title === "Detailed Play Summary" ? "OUTLINE OVERVIEW" : source.title;
    if (!type.includes("text/html") || body.length < 10000 || !body.toUpperCase().includes(expected.toUpperCase())) {
      throw new Error(`${source.url}: odpowiedź nie wygląda jak kompletny dokument HTML`);
    }
    pages.push({ ...source, body, sha256: createHash("sha256").update(body, "utf8").digest("hex") });
  }
  await mkdir(outputDir, { recursive: true });
  for (const page of pages) await writeFile(resolve(outputDir, page.file), page.body, "utf8");
  const metadata = {
    fetchedAt: new Date().toISOString(),
    note: "Unmodified HTML snapshots of VEKN pages; rights and notices remain with their respective holders.",
    sources: pages.map(({ file, title, url, sha256 }) => ({ file, title, url, sha256 })),
  };
  await writeFile(resolve(outputDir, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n", "utf8");
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  fetchReferences(resolve(process.cwd(), "docs/rules-reference/vekn"))
    .then(meta => console.log(`Pobrano ${meta.sources.length} dokumenty do docs/rules-reference/vekn/`))
    .catch(error => { console.error("Nie udało się pobrać dokumentów VEKN:", error); process.exitCode = 1; });
}
