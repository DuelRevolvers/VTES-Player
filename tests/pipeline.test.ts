import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadRawCards,
  isCryptRaw,
  parseCost,
  parseCryptDisciplines,
} from "../scripts/krcg-common.mts";

/** Minimal fixture in the KRCG shape the pipeline relies on. */
const FIXTURE = [
  {
    id: 200001,
    name: "Test Vampire",
    types: ["Vampire"],
    clans: ["Malkavian"],
    capacity: 6,
    group: 6,
    disciplines: ["aus", "DOM", "obf"],
    card_text: "Camarilla primogen: +1 bleed.",
    sets: { "Fifth Edition": {}, "Promo-2021": {} },
    url: "https://static.krcg.org/card/testvampire.jpg",
  },
  {
    id: 100001,
    name: "Test Action",
    types: ["Action"],
    disciplines: ["dom"],
    blood_cost: "1",
    card_text: "(D) Bleed with +2 bleed.",
    sets: { "Fifth Edition": {} },
    url: "https://static.krcg.org/card/testaction.jpg",
  },
  {
    id: 100002,
    name: "Test X Cost",
    types: ["Master"],
    pool_cost: "X",
    card_text: "Put X counters on this card.",
    sets: { "Legacy Set": {} },
  },
];

async function writeFixture(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "vtes-fixture-"));
  const p = path.join(dir, "vtes-raw.json");
  await writeFile(p, JSON.stringify(FIXTURE), "utf-8");
  return p;
}

describe("KRCG pipeline helpers", () => {
  it("loads raw cards from an array snapshot", async () => {
    const p = await writeFixture();
    const cards = await loadRawCards(p);
    expect(cards).toHaveLength(3);
    expect(cards[0]?.name).toBe("Test Vampire");
  });

  it("also accepts an object-keyed snapshot", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vtes-fixture-"));
    const p = path.join(dir, "vtes-raw.json");
    const byId = Object.fromEntries(FIXTURE.map((c) => [c.id, c]));
    await writeFile(p, JSON.stringify(byId), "utf-8");
    const cards = await loadRawCards(p);
    expect(cards).toHaveLength(3);
  });

  it("classifies crypt vs library", async () => {
    const p = await writeFixture();
    const cards = await loadRawCards(p);
    expect(cards.filter(isCryptRaw)).toHaveLength(1);
  });

  it("parses numeric, string, X, and absent costs", () => {
    expect(parseCost(2)).toEqual({ value: 2 });
    expect(parseCost("1")).toEqual({ value: 1 });
    expect(parseCost("X")).toEqual({ value: null, raw: "X" });
    expect(parseCost(undefined)).toEqual({ value: null });
  });

  it("maps discipline case to basic/superior", () => {
    const d = parseCryptDisciplines(["aus", "DOM", "obf"]);
    expect(d["Aus"]).toBe("basic");
    expect(d["Dom"]).toBe("superior");
    expect(d["Obf"]).toBe("basic");
  });
});
