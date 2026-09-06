/**
 * Derived traits + the six Discipline master cards
 * (docs/derived-traits-design.md): "+1 level of <D> and +1 capacity".
 *
 * Capacity and Disciplines used to be plain stored fields. These tests pin
 * the derived behaviour, because a card that raises either must change what
 * the card compiler, the blood ceiling and the influence phase all see.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { capacityOf, disciplinesOf, VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

/** Alice holds the named Discipline card, with a master phase action to
 *  spend (the shared fixture starts mid-turn, in the minion phase). */
function game(card: string, disc: Record<string, "basic" | "superior"> = {}): GameState {
  const state = threeSeatGame();
  const tf = state.frames[0]!;
  if (tf.kind === "turn") {
    tf.phase = "master";
    tf.masterActionsLeft = 1;
  }
  Object.assign(state.seats[0]!.minions[0]!, { disciplines: disc });
  state.seats[0]!.hand = [{ id: "c", name: card }];
  return state;
}

/** Play the master card and let its as-played window close. */
function playMaster(engine: VtesEngine, optionPrefix: string): void {
  runTrace(engine, [
    ["Alice", optionPrefix],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
  ]);
}

describe("derived traits", () => {
  it("capacityOf and disciplinesOf pass through an untouched vampire", () => {
    const m = makeMinion("X", "Alice", { capacity: 5, disciplines: { dom: "basic" } });
    expect(capacityOf(m)).toBe(5);
    // The same object, not a copy — the common case allocates nothing.
    expect(disciplinesOf(m)).toBe(m.disciplines);
  });

  it("raises none → basic → superior, and stops at superior", () => {
    const boost = (code: string) => ({
      card: { id: `d-${code}`, name: "Celerity" },
      locked: false,
      usedThisPhase: false,
      statics: { disciplineBoost: code, capacityBonus: 1 },
      tags: [],
    });
    const m = makeMinion("X", "Alice", { capacity: 4, disciplines: { pot: "basic" } });

    m.attached.push(boost("cel"));
    expect(disciplinesOf(m)["cel"]).toBe("basic"); // had none
    expect(capacityOf(m)).toBe(5);

    m.attached.push(boost("cel"));
    expect(disciplinesOf(m)["cel"]).toBe("superior"); // two copies stack
    expect(capacityOf(m)).toBe(6);

    m.attached.push(boost("pot"));
    expect(disciplinesOf(m)["pot"]).toBe("superior"); // basic → superior
    m.attached.push(boost("pot"));
    expect(disciplinesOf(m)["pot"]).toBe("superior"); // ceiling holds
  });
});

describe("Discipline master cards", () => {
  it("puts Celerity on a vampire and grants the level and the capacity", () => {
    const state = game("Celerity");
    const engine = new VtesEngine(state, testRegistry);
    playMaster(engine, "play:Celerity");

    const v1 = find(state, "V1");
    expect(v1.attached.map((p) => p.card.name)).toContain("Celerity");
    expect(disciplinesOf(v1)["cel"]).toBe("basic");
    expect(capacityOf(v1)).toBe(v1.capacity + 1);
  });

  it("is not playable on a vampire who already has the superior Discipline", () => {
    const state = game("Celerity", { cel: "superior" });
    const engine = new VtesEngine(state, testRegistry);
    expect(
      engine.decision()!.options.some((o) => o.id.includes("Celerity")),
    ).toBe(false);
  });

  it("IS playable on a vampire with only the basic Discipline", () => {
    const state = game("Dominate", { dom: "basic" });
    const engine = new VtesEngine(state, testRegistry);
    playMaster(engine, "play:Dominate");
    expect(disciplinesOf(find(state, "V1"))["dom"]).toBe("superior");
  });

  it("unlocks a card the vampire could not otherwise play", () => {
    // The integration that matters: the card compiler's discipline gate has
    // to read disciplinesOf, not the printed record. Lost in Crowds needs
    // Obfuscate, and V1 has none of its own.
    const offered = (withCard: boolean): boolean => {
      const state = threeSeatGame();
      const v1 = state.seats[0]!.minions[0]!;
      v1.disciplines = {};
      if (withCard) {
        v1.attached.push({
          card: { id: "obf1", name: "Obfuscate" },
          locked: false,
          usedThisPhase: false,
          statics: { disciplineBoost: "obf", capacityBonus: 1 },
          tags: ["discipline"],
        });
      }
      state.seats[0]!.hand = [{ id: "lic", name: "Lost in Crowds" }];
      const engine = new VtesEngine(state, testRegistry);
      // Bleed, then let Bob block so the +1 stealth is "needed" (p. 26).
      runTrace(engine, [
        ["Alice", "bleed:V1"],
        ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
        ["Alice", "pass"],
        ["Bob", "block:M"],
      ]);
      return engine.decision()!.options.some((o) => o.id.includes("Lost in Crowds"));
    };

    expect(offered(false)).toBe(false); // no Obfuscate of its own
    expect(offered(true)).toBe(true); // the master card supplies it
  });

  it("raises the blood ceiling — the vampire can hold the extra point", () => {
    const state = game("Potence");
    const v1 = state.seats[0]!.minions[0]!;
    v1.capacity = 4;
    v1.blood = 4; // already full at the PRINTED capacity
    const engine = new VtesEngine(state, testRegistry);
    playMaster(engine, "play:Potence");

    expect(capacityOf(find(state, "V1"))).toBe(5);
    // A hunt now has somewhere to put a point that would otherwise have
    // drained straight back to the blood bank (p. 11).
    runTrace(engine, [
      ["Alice", "pass"], // end the master phase
      ["Alice", "hunt:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // effects
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "V1").blood).toBe(5);
  });

  it("covers all six Disciplines", () => {
    for (const [name, code] of [
      ["Celerity", "cel"],
      ["Dominate", "dom"],
      ["Obfuscate", "obf"],
      ["Potence", "pot"],
      ["Protean", "pro"],
      ["Oblivion", "obl"],
    ] as const) {
      const state = game(name);
      const engine = new VtesEngine(state, testRegistry);
      playMaster(engine, `play:${name}`);
      expect(disciplinesOf(find(state, "V1"))[code], name).toBe("basic");
    }
  });
});
