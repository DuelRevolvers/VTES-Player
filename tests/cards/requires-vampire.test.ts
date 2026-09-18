/**
 * "Requires a (ready) vampire" — the 2026-09-14 library audit found three
 * cards printing it with no gate, so an ally could play Surprise Influence
 * or Sense the Savage Way, or employ Ghoul Escort. `requiresVampire` is
 * read by `meetsRequirements`, which every enumerator funnels through.
 */

import { describe, expect, it } from "vitest";
import { cardSpecs } from "../../src/cards/effects/cards.ts";
import { meetsRequirements } from "../../src/cards/effects/compile.ts";
import { makeAlly, makeMinion } from "../engine/fixtures.ts";

describe("requiresVampire (p. 10 requirements)", () => {
  for (const name of ["Surprise Influence", "Sense the Savage Way", "Ghoul Escort"]) {
    it(`${name}: a vampire meets it, an ally does not`, () => {
      const spec = cardSpecs.find((s) => s.name === name)!;
      expect(spec.requiresVampire).toBe(true);
      expect(meetsRequirements(makeMinion("V", "Alice", { capacity: 8 }), spec)).toBe(true);
      expect(meetsRequirements(makeAlly("A", "Alice", 8), spec)).toBe(false);
    });
  }
});
