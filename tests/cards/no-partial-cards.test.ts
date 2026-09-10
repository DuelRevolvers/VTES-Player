/**
 * §0, NO PARTIAL CARDS — the whole pool, in one assertion.
 *
 * Owner rule, 2026-09-08: *"We can't half-ass any card, ever. We need all
 * cards added to this platform working at 100% entirely or we literally
 * can't play the game correctly."*
 *
 * A card is in the pool only when it does everything it prints. There are
 * exactly two ways to satisfy that:
 *
 *   - it is implemented (`config/supported.json`), or
 *   - it prints no ability to implement — a crypt card whose text is a
 *     bare sect/title clause and nothing else.
 *
 * This is the guard that a widening cannot get past. The 2026-09-08 crypt
 * widening admitted 1,104 vampires with inert abilities by opening a
 * group in a config file and looking no further; the builder now gates on
 * wholeness, and this asserts the result rather than trusting it.
 *
 * It is deliberately a REGISTRY-wide check and not a widening check: the
 * standard is the same for a V5 card and a legacy one.
 */

import { describe, expect, it } from "vitest";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const reg = registry as unknown as CardRegistry;
const entries = Object.values(reg.entries);

/** A crypt card whose text is only a sect/title clause needs no code.
 *  "Advanced," is stripped first — it sits BEFORE the clause, and reading
 *  it as part of the text calls every advanced vampire an ability-bearer. */
function printsNoAbility(cardText: string): boolean {
  return /^[^.:]*\.\s*$/.test(cardText.trim().replace(/^Advanced,\s*/i, ""));
}

describe("no partial cards", () => {
  it("every card in the pool does everything it prints", () => {
    const partial = entries.filter(
      (e) => !e.supported && !(e.card.kind === "crypt" && printsNoAbility(e.card.cardText)),
    );
    // Named, not counted: if this ever fails, the list is the work.
    expect(
      partial.slice(0, 20).map((e) => `${e.card.name} [${e.card.kind}]`),
      `${partial.length} card(s) in the pool have an unimplemented printed ability`,
    ).toEqual([]);
  });

  it("every LIBRARY card is implemented — none of them can print no ability", () => {
    // The library has no "needs no code" case: a library card is its text.
    // Without this, a library card could sneak through the check above if
    // its text happened to be one short clause.
    const unimplemented = entries.filter((e) => e.card.kind === "library" && !e.supported);
    expect(unimplemented.map((e) => e.card.name)).toEqual([]);
  });

  it("counts up — the two whole kinds account for the entire pool", () => {
    // The control. All three assertions here would pass on an EMPTY
    // registry, which is exactly the "empty for the wrong reason" trap.
    const implemented = entries.filter((e) => e.supported);
    const noAbility = entries.filter(
      (e) => !e.supported && e.card.kind === "crypt" && printsNoAbility(e.card.cardText),
    );
    expect(entries.length).toBeGreaterThan(600);
    expect(implemented.length + noAbility.length).toBe(entries.length);
    // …and both kinds are actually represented, so neither branch is
    // passing vacuously.
    expect(implemented.length).toBeGreaterThan(0);
    expect(noAbility.length).toBeGreaterThan(0);
  });
});
