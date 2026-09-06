/**
 * The engine has exactly one clan vocabulary: the names the card registry
 * uses (docs/lock-grant-locations-design.md §7).
 *
 * Ten V5 library cards and two crypt cards still PRINT the legacy clan
 * names "Assamite" and "Follower of Set", but a `MinionState.clan` only
 * ever holds a registry name — "Banu Haqim", "Ministry" — because that is
 * where the phase-7 crypt importer reads it from. A card implementation
 * that filters on the printed name matches nothing and fails silently:
 * an empty option list looks exactly the same whether it is empty for the
 * right reason or the wrong one, which is why the fuzz harness cannot
 * catch this and why Priority Contract carried the bug undetected.
 *
 * So: scan the card sources for clan literals and check each against the
 * registry. This also catches a plain typo, which has the same symptom.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import registry from "../../src/cards/registry.json";

interface RegistryShape {
  entries: Record<string, { card: { kind: string; clan?: string; clans?: string[] } }>;
}

/** Every clan name the registry actually uses, from both card kinds. */
function registryClans(): Set<string> {
  const out = new Set<string>();
  for (const { card } of Object.values((registry as unknown as RegistryShape).entries)) {
    if (card.clan) out.add(card.clan);
    for (const c of card.clans ?? []) out.add(c);
  }
  return out;
}

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Clan literals in the card sources: `clan === "X"`, `clan: "X"` and
 * `clan !== "X"`. Deliberately narrow — it reads the places a clan is
 * compared or configured, not every string in the file.
 */
function clanLiterals(code: string): string[] {
  const out: string[] = [];
  const pattern = /\bclan\s*(?:===|!==|:)\s*"([^"]+)"/g;
  for (let m = pattern.exec(code); m !== null; m = pattern.exec(code)) {
    out.push(m[1]!);
  }
  return out;
}

describe("clan vocabulary", () => {
  const clans = registryClans();

  it("the registry uses the fourteen V5 clan names", () => {
    expect(clans.size).toBe(14);
    expect(clans.has("Banu Haqim")).toBe(true);
    expect(clans.has("Ministry")).toBe(true);
    // The legacy names the card TEXT still prints are not clan values.
    expect(clans.has("Assamite")).toBe(false);
    expect(clans.has("Follower of Set")).toBe(false);
  });

  it("no card implementation filters on a clan the registry does not use", () => {
    for (const file of ["../../src/cards/effects/cards.ts", "../../src/cards/effects/compile.ts"]) {
      const bad = [...new Set(clanLiterals(source(file)))].filter((c) => !clans.has(c));
      expect(bad, `${file} compares against non-registry clan name(s)`).toEqual([]);
    }
  });

  it("finds the bug it was written for, if it comes back", () => {
    // A guard on the guard: the scanner must actually see this shape.
    expect(clanLiterals('if (m.clan === "Assamite") return [];')).toEqual(["Assamite"]);
    expect(clanLiterals("lockGrant: { clan: \"Ravnos\" }")).toEqual(["Ravnos"]);
  });
});
