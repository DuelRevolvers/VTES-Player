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
import { CLANS } from "../../src/engine/index.ts";
import registry from "../../src/cards/registry.json";

interface RegistryShape {
  entries: Record<string, { card: { kind: string; clan?: string; clans?: string[] } }>;
}

/**
 * The clans a VAMPIRE in this pool can be — crypt cards only.
 *
 * This is the set that matters, and the distinction became load-bearing
 * when the library widened past V5 (docs/pool-widening-design.md §6). A
 * library card carries a clan too, but it is an ICON or a requirement,
 * not a vampire: Morgue Hunting Ground is a Giovanni card and no Giovanni
 * exists in this pool. Letting those into the vocabulary would offer
 * "Giovanni" in a Consanguineous Boon referendum, where it can never
 * match anyone — the p. 49 list is the clans in the game, not the clans
 * printed on cardboard.
 */
function cryptClans(): Set<string> {
  const out = new Set<string>();
  for (const { card } of Object.values((registry as unknown as RegistryShape).entries)) {
    if (card.kind === "crypt" && card.clan) out.add(card.clan);
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
  const clans = cryptClans();

  it("uses V5 clan NAMES, whatever the pool's size", () => {
    // The count was pinned at fourteen until the crypt widened past the
    // V5 sets and the bloodlines arrived (docs/pool-widening-design.md
    // §3). The number was never the claim: what matters is that KRCG
    // gives V5 names, so a V5 clan filter matches a legacy vampire.
    expect(clans.has("Banu Haqim")).toBe(true);
    expect(clans.has("Ministry")).toBe(true);
    // The legacy names the card TEXT still prints are not clan values.
    expect(clans.has("Assamite")).toBe(false);
    expect(clans.has("Follower of Set")).toBe(false);
  });

  it("is exactly what CLANS offers — 'an EXISTING clan' means the pool's", () => {
    // Consanguineous Boon offers `CLANS` and the rulebook says it must be
    // every clan in the pool (p. 49), so a hand-listed engine constant and
    // the registry cannot be allowed to drift. This is the cross-check
    // that lets `CLANS` stay a plain list in the kernel.
    expect([...CLANS].sort()).toEqual([...clans].sort());
  });

  it("no card implementation filters on a clan no VAMPIRE in the pool has", () => {
    // These literals are compared against `MinionState.clan`, so the
    // standard is the crypt's vocabulary, not the registry's. A filter
    // naming a library card's clan icon ("Giovanni", "Osebo") compiles,
    // reads fine, and matches nobody — the same silent failure as the
    // "Assamite" bug, one widening later.
    for (const file of ["../../src/cards/effects/cards.ts", "../../src/cards/effects/compile.ts"]) {
      const bad = [...new Set(clanLiterals(source(file)))].filter((c) => !clans.has(c));
      expect(bad, `${file} compares against a clan no vampire in the pool has`).toEqual([]);
    }
  });

  it("the legacy library's clan icons stayed OUT of the vocabulary", () => {
    // The control for the split above: those names really are in the
    // registry, so `clans` excluding them is a decision this test is
    // making rather than a set that happens to be empty.
    const libraryClans = new Set<string>();
    for (const { card } of Object.values((registry as unknown as RegistryShape).entries)) {
      if (card.kind === "library") for (const c of card.clans ?? []) libraryClans.add(c);
    }
    const iconOnly = [...libraryClans].filter((c) => !clans.has(c));
    expect(iconOnly.length).toBeGreaterThan(0);
    expect(iconOnly.some((c) => CLANS.includes(c as (typeof CLANS)[number]))).toBe(false);
  });

  it("finds the bug it was written for, if it comes back", () => {
    // A guard on the guard: the scanner must actually see this shape.
    expect(clanLiterals('if (m.clan === "Assamite") return [];')).toEqual(["Assamite"]);
    expect(clanLiterals("lockGrant: { clan: \"Ravnos\" }")).toEqual(["Ravnos"]);
  });
});
