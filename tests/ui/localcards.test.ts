/**
 * The Card Database switch (owner request 2026-09-25): scans from a local
 * folder, matched by KRCG's file names, falling back to KRCG per card.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cardDatabase, scanUrl, setLocalScans, useKrcg } from "../../src/ui/localcards.ts";

const MAGNUM = "https://static.krcg.org/card/44magnum.jpg";
const ABBOT = "https://static.krcg.org/card/abbot.jpg";

afterEach(async () => {
  await useKrcg();
});

describe("the card database", () => {
  it("is krcg.org by default, and passes every URL through untouched", () => {
    expect(cardDatabase()).toEqual({ kind: "krcg" });
    expect(scanUrl(MAGNUM)).toBe(MAGNUM);
  });

  it("serves a card from the folder by its KRCG file name, any image type, any case", () => {
    const n = setLocalScans("scans", [
      { name: "44Magnum.PNG", url: "local:magnum" },
      { name: "notes.txt", url: "local:notes" },
    ]);
    // The text file is not an image and is not counted.
    expect(n).toBe(1);
    expect(cardDatabase()).toEqual({ kind: "local", folder: "scans", images: 1 });
    expect(scanUrl(MAGNUM)).toBe("local:magnum");
  });

  it("falls back to krcg.org for a card the folder does not have", () => {
    setLocalScans("scans", [{ name: "44magnum.jpg", url: "local:magnum" }]);
    expect(scanUrl(ABBOT)).toBe(ABBOT);
  });

  it("goes back to krcg.org when asked", async () => {
    setLocalScans("scans", [{ name: "44magnum.jpg", url: "local:magnum" }]);
    await useKrcg();
    expect(cardDatabase()).toEqual({ kind: "krcg" });
    expect(scanUrl(MAGNUM)).toBe(MAGNUM);
  });
});
