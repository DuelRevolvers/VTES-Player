/**
 * The crypt widening (docs/pool-widening-design.md §2–§3).
 *
 * The registry admits vampires from outside the V5 sets, and — since
 * tranche 3 (§6) — implemented library cards too. What this pins is
 * the NEGATIVE space, because every failure mode here is silent: a library
 * card admitted by accident makes decks unplayable, an Imbued admitted by
 * accident puts a card in the crypt nothing can play, and a legacy set's
 * half-built precons would appear in the deck picker looking like real
 * decks. None of those throws; all of them just look broken later.
 */

import { describe, expect, it } from "vitest";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";
import v5Sets from "../../config/v5-sets.json";
import cryptGroups from "../../config/crypt-groups.json";

const reg = registry as unknown as CardRegistry;
const cards = Object.values(reg.entries).map((e) => e.card);
const crypt = cards.filter((c) => c.kind === "crypt");
const library = cards.filter((c) => c.kind === "library");
const sets = v5Sets as string[];
const groups = (cryptGroups as { groups: number[] }).groups;

/** A card admitted by the widening rather than by the V5 set list. */
const widened = crypt.filter((c) => !c.sets.some((s) => sets.includes(s)));
const widenedLib = library.filter((c) => !c.sets.some((s) => sets.includes(s)));
const bySupport = new Map(Object.values(reg.entries).map((e) => [e.card.id, e.supported]));

describe("what the widening admits", () => {
  it("admits a legacy library card ONLY when it is implemented", () => {
    // The asymmetry the whole plan rests on: an unimplemented library card
    // makes a deck unplayable, an unimplemented crypt ability is inert.
    // So the crypt gets a config and a wholeness gate, and the library
    // gets no config at all — `widenedLibrary` reads `supported.json` and
    // nothing else, which is why this can be stated as an absolute (§6).
    const strays = widenedLib.filter((c) => !bySupport.get(c.id));
    expect(strays.map((c) => c.name)).toEqual([]);
  });

  it("…and some are actually admitted — the control for the line above", () => {
    // Without this, the assertion above passes on a library that was
    // never widened at all, which is exactly how it read before tranche 3.
    expect(widenedLib.length).toBeGreaterThan(0);
  });

  it("admits no Imbued", () => {
    // `isCryptRaw` counts Imbued as crypt, because the V5 pool has none and
    // the distinction never came up. They are a different card type with
    // their own resource and the engine has no model for them.
    const imbued = crypt.filter((c) => /^(Imbued|Avenger|Defender|Innocent|Judge|Martyr|Redeemer|Visionary)\b/i.test(c.cardText.trim()));
    expect(imbued.map((c) => c.name)).toEqual([]);
  });

  it("admits only the configured groups", () => {
    const wrong = widened.filter((c) => !groups.includes(Number(c.group)));
    expect(wrong.map((c) => `${c.name} (group ${String(c.group)})`)).toEqual([]);
  });

  it("admits no sect the engine cannot represent", () => {
    // A sect outside `Sect` parses to null, and a sectless vampire is
    // quietly wrong rather than loudly wrong — so Laibon is excluded
    // rather than relabelled (docs/pool-widening-design.md §4a).
    const laibon = crypt.filter((c) => /^Laibon\b/i.test(c.cardText.trim()));
    expect(laibon.map((c) => c.name)).toEqual([]);
  });

  it("leaves the precons V5-only — a legacy set's decks are half-built here", () => {
    const outside = reg.precons.filter((p) => !sets.includes(p.set));
    expect(outside.map((p) => `${p.set}: ${p.name}`)).toEqual([]);
  });
});

describe("what the widened cards carry", () => {
  it("matches the config — widened when groups are open, empty when not", () => {
    // THE CONTROL, and it has to work in both directions. With groups
    // open, an empty `widened` would make every negative-space assertion
    // above pass by doing nothing. With groups closed, a NON-empty one
    // would mean the rollback did not take. Asserting the state the
    // config asks for catches both.
    if (groups.length === 0) expect(widened).toEqual([]);
    else expect(widened.length).toBeGreaterThan(0);
  });

  it("admits only WHOLE cards — §0, enforced by the builder", () => {
    // The gate that replaced the first widening. Every admitted vampire
    // either has an implementation or prints no ability to implement;
    // there is no third case, and "its stats are right" is not one.
    const partial = widened.filter(
      (c) =>
        !bySupport.get(c.id) &&
        !/^[^.:]*\.\s*$/.test(c.cardText.trim().replace(/^Advanced,\s*/i, "")),
    );
    expect(partial.map((c) => c.name)).toEqual([]);
  });

  it("gives every one of them a capacity and a clan", () => {
    // NOT disciplines: a couple of capacity-1 vampires (Sandra White,
    // Smudge the Ignored) genuinely print none, so requiring them would
    // be the test asserting something the cards do not say.
    const broken = widened.filter((c) => !(c.capacity > 0) || !c.clan || c.clan === "Unknown");
    expect(broken.map((c) => c.name)).toEqual([]);
  });

  it("gives all but a handful of them disciplines", () => {
    // The weaker claim, which is the true one — and still worth pinning,
    // because a parse that dropped the discipline line entirely would
    // leave every vampire with none and nothing else would notice.
    const none = widened.filter((c) => Object.keys(c.disciplines).length === 0);
    expect(none.length).toBeLessThan(5);
    expect(none.length).toBeLessThan(Math.max(1, widened.length));
  });

  it("keeps every clan name inside the engine's vocabulary", () => {
    // `CLANS` is what Consanguineous Boon offers, and p. 49 says it must
    // be every clan in the pool. A widened clan the engine does not know
    // would be unnameable in a referendum.
    const known = new Set(crypt.map((c) => c.clan));
    expect(widened.every((c) => known.has(c.clan))).toBe(true);
  });
});
