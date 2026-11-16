/**
 * Registry support-label accounting only: the `supported` flag is metadata,
 * not proof that the printed ability is complete. See docs/card-audit/README.md
 * and the manual findings for actual reviewed discrepancies.
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

describe("registry support-label accounting", () => {
  it("every card has a support label or a bare crypt text", () => {
    const partial = entries.filter(
      (e) => !e.supported && !(e.card.kind === "crypt" && printsNoAbility(e.card.cardText)),
    );
    // Named, not counted: if this ever fails, the list is the work.
    expect(
      partial.slice(0, 20).map((e) => `${e.card.name} [${e.card.kind}]`),
      `${partial.length} card(s) lack a support label and a bare crypt text`,
    ).toEqual([]);
  });

  it("every library card has the supported label", () => {
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
    // Either category can legitimately be empty; the nonempty registry and
    // accounting assertion above still detect a vacuous or incomplete sum.
    expect(implemented.length).toBeGreaterThan(0);
  });
});
