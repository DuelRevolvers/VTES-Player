/**
 * Masters that reach across the table
 * (docs/cross-table-masters-design.md).
 *
 * Giant's Blood (100824), Golconda: Inner Peace (100842),
 * Archon Investigation (100085), Anarch Troublemaker (100058),
 * The Coven (100435).
 *
 * The shared property is that another Methuselah is a PARTICIPANT, not a
 * bystander — and two of the mechanics are new gates: pay-to-cancel
 * (which retires the True Love's Face deferral) and removing a card from
 * the game (p. 16).
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function maybe(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

function seat(state: GameState, id: string) {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}

function entryOf(state: GameState, name: string): { entry: PermanentInPlay; seat: string } | null {
  for (const s of state.seats) {
    const p = s.permanents.find((x) => x.card.name === name);
    if (p) return { entry: p, seat: s.id };
  }
  return null;
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/**
 * A game where Alice holds `cards`, walked forward to the first decision
 * that actually offers the first of them.
 *
 * `threeSeatGame()` opens at `turn.minion` — the master phase of turn 1
 * has already gone by — so a master-card test has to walk to the next
 * one rather than assuming it is the first decision.
 */
function atMasterPhase(
  cards: string[],
  tweak: (state: GameState) => void = () => {},
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  cards.forEach((n, i) => state.seats[0]!.hand.push({ id: `a${i}`, name: n }));
  tweak(state);
  const engine = new VtesEngine(state, testRegistry);
  const found = walkTo(engine, `play:${cards[0]}`);
  if (!found) throw new Error(`never offered play:${cards[0]}`);
  return { state, engine };
}

/** Answer everything the cheapest way until `prefix` is on the table. */
function walkTo(engine: VtesEngine, prefix: string, limit = 120): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

// ---------------------------------------------------------------------------

describe("Giant's Blood (100824)", () => {
  it("fills the chosen vampire to capacity — any Methuselah's", () => {
    const { state, engine } = atMasterPhase(["Giant's Blood"], (s) => {
      Object.assign(find(s, "M"), { blood: 1, capacity: 5 });
    });
    const ids = optionIds(engine).filter((id) => id.startsWith("play:Giant's Blood"));
    // Bob's vampire is a legal choice; the card says "a vampire".
    expect(ids.some((id) => id.includes(":M:"))).toBe(true);
    runTrace(engine, [
      [`Alice`, ids.find((id) => id.includes(":M:"))!],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "M").blood).toBe(5);
  });

  it("NEGATIVE SPACE: a vampire already at capacity is not offered", () => {
    // V1 stays fillable so the card IS on the table — otherwise this
    // would pass for the wrong reason.
    const { engine } = atMasterPhase(["Giant's Blood"], (s) => {
      Object.assign(find(s, "M"), { blood: 5, capacity: 5 });
      Object.assign(find(s, "V1"), { blood: 1, capacity: 4 });
    });
    const ids = optionIds(engine).filter((id) => id.startsWith("play:Giant's Blood"));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => id.includes(":M:"))).toBe(false);
  });

  it("GAME-WIDE uniqueness: a second copy is unplayable even after the first resolves", () => {
    const { state, engine } = atMasterPhase(["Giant's Blood", "Giant's Blood"], (s) => {
      Object.assign(find(s, "V1"), { blood: 1, capacity: 4 });
    });
    const first = optionIds(engine).find((id) => id.startsWith("play:Giant's Blood"))!;
    runTrace(engine, [
      ["Alice", first],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(find(state, "V1").blood).toBe(4);
    // Even though the first card is in nobody's play area, the EVENT LOG
    // remembers it — stricter than "in play", which is the point.
    expect(optionIds(engine).some((id) => id.startsWith("play:Giant's Blood"))).toBe(false);
  });
});

describe("Golconda: Inner Peace (100842)", () => {
  const bigBob = (s: GameState) => {
    Object.assign(find(s, "M"), { capacity: 8, blood: 3 });
  };

  it("removes the vampire from the game and pays their controller their capacity", () => {
    const { state, engine } = atMasterPhase(["Golconda: Inner Peace"], bigBob);
    const bobPool = seat(state, "Bob").pool;
    const id = optionIds(engine).find((o) => o.startsWith("play:Golconda"))!;
    runTrace(engine, [
      ["Alice", id],
      // Bob may pay to cancel; he passes.
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(maybe(state, "M")).toBeUndefined();
    expect(seat(state, "Bob").pool).toBe(bobPool + 8);
  });

  it("is REMOVED, not burned — no MinionBurned event (p. 16)", () => {
    const { state, engine } = atMasterPhase(["Golconda: Inner Peace"], bigBob);
    const id = optionIds(engine).find((o) => o.startsWith("play:Golconda"))!;
    runTrace(engine, [
      ["Alice", id],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    const burned = state.eventLog.filter(
      (ev) => ev.type === "MinionBurned" && ev.minion === "M",
    );
    const removed = state.eventLog.filter(
      (ev) => ev.type === "MinionRemovedFromGame" && ev.minion === "M",
    );
    expect(burned.length).toBe(0);
    expect(removed.length).toBe(1);
  });

  it("PAY TO CANCEL: the target's controller can burn 2 pool to stop it", () => {
    const { state, engine } = atMasterPhase(["Golconda: Inner Peace"], bigBob);
    const bobPool = seat(state, "Bob").pool;
    const id = optionIds(engine).find((o) => o.startsWith("play:Golconda"))!;
    runTrace(engine, [["Alice", id]]);
    // Alice is cycled first in the as-played window; she has no cancel.
    expect(optionIds(engine).some((o) => o.startsWith("cancelpay:"))).toBe(false);
    runTrace(engine, [["Alice", "pass"]]);
    const bobOptions = optionIds(engine);
    expect(bobOptions.some((o) => o.startsWith("cancelpay:"))).toBe(true);
    runTrace(engine, [["Bob", bobOptions.find((o) => o.startsWith("cancelpay:"))!]]);
    // The vampire survives and Bob is down exactly the 2 pool.
    expect(maybe(state, "M")).toBeDefined();
    expect(seat(state, "Bob").pool).toBe(bobPool - 2);
  });

  it("NEGATIVE SPACE: a vampire under capacity 8 is not a legal target", () => {
    // Alice's own V1 is big enough, so the card IS on the table — this
    // must not pass because the whole card is missing.
    const { engine } = atMasterPhase(["Golconda: Inner Peace"], (s) => {
      Object.assign(find(s, "M"), { capacity: 7 });
      Object.assign(find(s, "V1"), { capacity: 8 });
    });
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Golconda"));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((o) => o.includes(":M:"))).toBe(false);
  });

  it("NEGATIVE SPACE: a controller who cannot afford 2 pool is offered no cancel", () => {
    const { engine } = atMasterPhase(["Golconda: Inner Peace"], (s) => {
      bigBob(s);
      seat(s, "Bob").pool = 2; // paying would oust them
    });
    const id = optionIds(engine).find((o) => o.startsWith("play:Golconda"))!;
    runTrace(engine, [["Alice", id], ["Alice", "pass"]]);
    expect(optionIds(engine).some((o) => o.startsWith("cancelpay:"))).toBe(false);
  });
});

describe("Archon Investigation (100085)", () => {
  /**
   * A bleed aimed AT ALICE, of the given size, stopped once it is on the
   * table.
   *
   * Seating is Alice → Bob → Carol, so Alice's PREDATOR is Carol: the
   * minion that can bleed Alice is Carol's `N`, not Bob's `M`. (Bob's
   * prey is Carol. Getting this backwards is what made the first version
   * of these tests fail.)
   */
  function bleedAtAlice(amount: number, holder = 0): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    state.seats[holder]!.hand.push({ id: `h${holder}`, name: "Archon Investigation" });
    // The MinionState field is `bleedAmount`. `bleed` is a static on a
    // card in play, and setting that here silently does nothing —
    // which is what made the first version of this fixture fail.
    Object.assign(find(state, "N"), { bleedAmount: amount });
    const engine = new VtesEngine(state, testRegistry);
    for (let i = 0; i < 60; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const bleed = dp.options.find((o) => o.id === "bleed:N");
      if (bleed) {
        runTrace(engine, [[dp.seat, bleed.id]]);
        break;
      }
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    return { state, engine };
  }

  it("burns the acting minion and fails the action", () => {
    const { state, engine } = bleedAtAlice(4);
    const alicePool = seat(state, "Alice").pool;
    expect(walkTo(engine, "play:Archon Investigation")).toBe(true);
    const id = optionIds(engine).find((o) => o.startsWith("play:Archon Investigation"))!;
    runTrace(engine, [
      ["Alice", id],
      ["Carol", "pass"], ["Alice", "pass"], ["Bob", "pass"],
    ]);
    expect(maybe(state, "N")).toBeUndefined();
    // "(The action is not successful.)" — Alice loses only the 3 pool the
    // card costs, not the 4 from a bleed that never landed.
    expect(seat(state, "Alice").pool).toBe(alicePool - 3);
  });

  it("NEGATIVE SPACE: not usable against a bleed of 3", () => {
    const { engine } = bleedAtAlice(3);
    expect(walkTo(engine, "play:Archon Investigation", 25)).toBe(false);
  });

  it("NEGATIVE SPACE: not usable by a Methuselah who is not the one being bled", () => {
    // Bob holds it; the bleed is aimed at Alice.
    const { engine } = bleedAtAlice(4, 1);
    expect(walkTo(engine, "play:Archon Investigation", 25)).toBe(false);
  });
});

describe("Anarch Troublemaker (100058)", () => {
  it("enters play, then hands itself to the prey as the price of burning their equipment", () => {
    // The equipment branch, not the lock branch, because by ALICE'S
    // unlock phase her prey's vampires are locked from their own turn —
    // they unlock at THEIR unlock phase, not hers. (Real behaviour, and
    // the reason the first version of this test failed: the engine was
    // right and the fixture's premise was wrong.)
    const { state, engine } = atMasterPhase(["Anarch Troublemaker"], (s) => {
      find(s, "M").attached.push({
        card: { id: "eq1", name: ".44 Magnum" },
        controller: "Bob",
        owner: "Bob",
        statics: {},
        tags: ["equipment"],
        locked: false,
        usedThisPhase: false,
      });
    });
    runTrace(engine, [
      ["Alice", "play:Anarch Troublemaker"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(entryOf(state, "Anarch Troublemaker")?.seat).toBe("Alice");
    // The ability lives in Alice's OWN unlock phase, next turn round.
    expect(walkTo(engine, "ability:Anarch Troublemaker")).toBe(true);
    const burn = optionIds(engine).find((o) => o.includes(":burn:"))!;
    expect(burn).toBeDefined();
    runTrace(engine, [["Alice", burn]]);
    expect(find(state, "M").attached.some((p) => p.card.id === "eq1")).toBe(false);
    // The handover is the PRICE, paid whichever payoff was taken: the
    // card is now controlled by Alice's prey (Bob).
    const e = entryOf(state, "Anarch Troublemaker");
    expect(e?.entry.controller ?? e?.seat).toBe("Bob");
  });

  it("NEGATIVE SPACE: only ONE copy — the unique gate", () => {
    const { engine } = atMasterPhase(["Anarch Troublemaker", "Anarch Troublemaker"]);
    runTrace(engine, [
      ["Alice", "play:Anarch Troublemaker"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(optionIds(engine).some((o) => o.startsWith("play:Anarch Troublemaker"))).toBe(false);
  });
});

describe("The Coven (100435)", () => {
  it("locks to add 2 blood to a ready vampire you control", () => {
    const { state, engine } = atMasterPhase(["The Coven"], (s) => {
      Object.assign(find(s, "V1"), { blood: 1, capacity: 6 });
    });
    runTrace(engine, [
      ["Alice", "play:The Coven"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(walkTo(engine, "ability:The Coven")).toBe(true);
    const id = optionIds(engine).find((o) => o.startsWith("ability:The Coven"))!;
    runTrace(engine, [[engine.decision()!.seat, id]]);
    expect(find(state, "V1").blood).toBe(3);
  });

  it("the handover to the predator is AUTOMATIC — 'takes control', not 'can'", () => {
    const { state, engine } = atMasterPhase(["The Coven"]);
    runTrace(engine, [
      ["Alice", "play:The Coven"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(entryOf(state, "The Coven")?.seat).toBe("Alice");
    // Walk to the end of Alice's own turn; her discard phase hands it on.
    for (let i = 0; i < 40; i++) {
      const e = entryOf(state, "The Coven");
      if ((e?.entry.controller ?? e?.seat) === "Carol") break;
      const dp = engine.decision();
      if (!dp) break;
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    // Alice's predator in a three-seat game is Carol.
    const e = entryOf(state, "The Coven");
    expect(e?.entry.controller ?? e?.seat).toBe("Carol");
  });
});
