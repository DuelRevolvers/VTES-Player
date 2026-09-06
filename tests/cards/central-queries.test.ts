/**
 * The central queries every handler must answer.
 *
 * `compileSpec` gives a spec-compiled card `costTypes`,
 * `requiresDisciplines` and `modesPlayableBy` for free. A handler written
 * entirely by hand answers none of them unless somebody remembers — and
 * when it does not, it becomes INVISIBLE to every card that reasons about
 * other cards, silently:
 *
 *   - a play-cost modifier keyed on "master cards" (Secure Haven) skipped
 *     Blood Doll and Vessel, because their `costTypes` was undefined;
 *   - "equip with an equipment from your hand" (Contraband) skipped
 *     .44 Magnum for the same reason.
 *
 * Neither shows up as a failure anywhere: an option list that is empty for
 * the wrong reason looks exactly like one empty for the right reason, and
 * a cost modifier that does not fire produces a perfectly plausible number.
 * `backfillCentralQueries` supplies the defaults; this pins that it ran.
 */

import { describe, expect, it } from "vitest";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, threeSeatGame } from "../engine/fixtures.ts";

describe("every registered handler answers the central queries", () => {
  const registry = buildHandlerRegistry();
  const names = Object.keys(registry);

  it("has handlers to check", () => {
    expect(names.length).toBeGreaterThan(200);
  });

  it("names at least one printed type — every LIBRARY card", () => {
    const m = makeMinion("probe", "Alice");
    const silent: string[] = [];
    for (const name of names) {
      const h = registry[name]!;
      // A CRYPT card has no printed library type and must answer none:
      // every play-cost modifier and cancel effect names a library type,
      // and a vampire is never played (docs/crypt-wave-1.md §1). Asserted
      // rather than skipped, so a crypt handler that starts claiming one
      // fails here.
      if (h.isCryptCard) {
        expect(h.costTypes?.(null, undefined) ?? []).toEqual([]);
        continue;
      }
      const types = h.costTypes?.(null, undefined) ?? [];
      if (types.length === 0) silent.push(name);
      // The other two must at least be callable and total.
      expect(h.requiresDisciplines?.(null, undefined)).toBeDefined();
      expect(h.modesPlayableBy?.(m)).toBeDefined();
    }
    expect(silent).toEqual([]);
  });

  it("EVERY playCard option reports what it costs", () => {
    // A cost that appears on some cards and not others is worse than
    // none: the UI would price half its buttons and an agent would think
    // the unpriced half was free. `compileSpec` supplies the live cost
    // and `backfillCentralQueries` the printed one, so a hand-rolled
    // handler cannot be the exception — which is exactly how `costTypes`
    // silently skipped Blood Doll and .44 Magnum
    // (docs/richer-options-design.md §2).
    const state = threeSeatGame();
    const engine = new VtesEngine(state, registry);
    const silent: string[] = [];
    for (let i = 0; i < 400; i++) {
      const dp = engine.decision();
      if (!dp) break;
      for (const o of dp.options) {
        if (o.kind === "playCard" && o.cost === undefined) silent.push(o.id);
      }
      engine.choose(dp.options.find((x) => x.id === "pass")?.id ?? dp.options[0]!.id);
    }
    expect(silent).toEqual([]);
  });

  it("the crypt handlers are actually being checked above", () => {
    // Guarding the guard: the skip is only honest if crypt handlers exist.
    const crypt = names.filter((n) => registry[n]!.isCryptCard);
    expect(crypt.length).toBeGreaterThan(0);
  });

  it("gives the hand-rolled .44 Magnum its equipment type and one version", () => {
    const magnum = registry[".44 Magnum"]!;
    expect(magnum.costTypes?.(null, undefined)).toEqual(["equipment"]);
    expect(magnum.modesPlayableBy?.(makeMinion("probe", "Alice"))).toEqual([null]);
  });

  it("gives the hand-rolled masters their master type", () => {
    for (const name of ["Blood Doll", "Vessel", "The Barrens", "Sudden Reversal"]) {
      expect(registry[name]?.costTypes?.(null, undefined), name).toEqual(["master"]);
    }
  });
});
