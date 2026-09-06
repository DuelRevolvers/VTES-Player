/**
 * Actions that take what belongs to another Methuselah
 * (docs/taking-actions-design.md).
 *
 * Far Mastery (100703), Graverobbing (100852), Puppet Master (101215),
 * Slaughtering the Herd (101801), Break the Bonds (102247).
 *
 * The one genuinely new mechanic is TEMPORARY control (Puppet Master):
 * every control change before this was permanent.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function maybe(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
}

/** Which seat currently holds a minion — the whole point of this wave. */
function holderOf(state: GameState, id: string): string | null {
  for (const s of state.seats) if (s.minions.some((m) => m.id === id)) return s.id;
  return null;
}

function entryOn(state: GameState, minion: string, name: string): PermanentInPlay | undefined {
  return maybe(state, minion)?.attached.find((p) => p.card.name === name);
}

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Answer everything the cheapest way until `prefix` is on the table. */
function walkTo(engine: VtesEngine, prefix: string, limit = 140): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
  return false;
}

/**
 * Alice holds `cards` and her V1 has `disc`; walked to the first decision
 * that offers the first card. `threeSeatGame()` opens at `turn.minion` on
 * Alice's turn, so an action card is usually offered straight away.
 */
function setup(
  cards: string[],
  disc: Record<string, "basic" | "superior">,
  tweak: (state: GameState) => void = () => {},
): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), { disciplines: disc, blood: 6, capacity: 8 });
  cards.forEach((n, i) => state.seats[0]!.hand.push({ id: `a${i}`, name: n }));
  tweak(state);
  const engine = new VtesEngine(state, testRegistry);
  if (!walkTo(engine, `play:${cards[0]}`)) throw new Error(`never offered ${cards[0]}`);
  return { state, engine };
}

/**
 * Play `optionId`, then pass until the action frame is gone.
 *
 * A fixed pass-trace does NOT work here: every card in this wave is a
 * DIRECTED action, and a directed action's announce and block cycles
 * carry only the actor and the defenders, so the number of passes varies
 * with the target. Walking is the reliable form.
 */
function playAndResolve(engine: VtesEngine, state: GameState, optionId: string): void {
  const seat = engine.decision()!.seat;
  runTrace(engine, [[seat, optionId]]);
  for (let i = 0; i < 40; i++) {
    if (!state.frames.some((f) => f.kind === "action" || f.kind === "cardPlay")) return;
    const dp = engine.decision();
    if (!dp) return;
    const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, pick.id]]);
  }
}

// ---------------------------------------------------------------------------

describe("Far Mastery (100703)", () => {
  const withRetainer = (s: GameState) => {
    find(s, "M").attached.push({
      card: { id: "r1", name: "Raven Spy" },
      controller: "Bob",
      owner: "Bob",
      statics: {},
      tags: ["retainer"],
      locked: false,
      usedThisPhase: false,
      life: 1,
    });
  };

  it("inferior steals a RETAINER — a card in play, moved to the actor", () => {
    const { state, engine } = setup(["Far Mastery"], { dom: "basic" }, withRetainer);
    const id = optionIds(engine).find((o) => o.startsWith("play:Far Mastery:basic"))!;
    playAndResolve(engine, state, id);
    expect(entryOn(state, "M", "Raven Spy")).toBeUndefined();
    const moved = entryOn(state, "V1", "Raven Spy");
    expect(moved).toBeDefined();
    expect(moved?.controller).toBe("Alice");
  });

  it("superior steals an ALLY — a MINION, so the whole seat changes", () => {
    const { state, engine } = setup(["Far Mastery"], { dom: "superior" }, (s) => {
      s.seats[1]!.minions.push({
        ...find(s, "M"),
        id: "ALLY",
        name: "Thug",
        kind: "ally",
        controller: "Bob",
        owner: "Bob",
        attached: [],
      });
    });
    const id = optionIds(engine).find(
      (o) => o.startsWith("play:Far Mastery:superior") && o.includes(":ALLY"),
    )!;
    expect(id).toBeDefined();
    playAndResolve(engine, state, id);
    expect(holderOf(state, "ALLY")).toBe("Alice");
  });

  it("the two modes differ in SCOPE: 'another vampire' vs 'another Methuselah'", () => {
    // A retainer on Alice's OWN other vampire is a legal inferior target
    // (the card says "another vampire"), and the superior's ally clause
    // says "another Methuselah" — a real narrowing, not decoration.
    const { engine } = setup(["Far Mastery"], { dom: "basic" }, (s) => {
      s.seats[0]!.minions.push({
        ...find(s, "V1"),
        id: "V2",
        name: "Second",
        attached: [
          {
            card: { id: "r2", name: "Raven Spy" },
            controller: "Alice",
            owner: "Alice",
            statics: {},
            tags: ["retainer"],
            locked: false,
            usedThisPhase: false,
            life: 1,
          },
        ],
      });
    });
    expect(optionIds(engine).some((o) => o.includes(":r2"))).toBe(true);
  });
});

describe("Graverobbing (100852)", () => {
  const torpid = (s: GameState) => {
    Object.assign(find(s, "M"), { inTorpor: true, locked: false });
  };

  it("inferior takes control but leaves them in torpor", () => {
    const { state, engine } = setup(["Graverobbing"], { dom: "basic" }, torpid);
    const id = optionIds(engine).find((o) => o.startsWith("play:Graverobbing:basic"))!;
    playAndResolve(engine, state, id);
    expect(holderOf(state, "M")).toBe("Alice");
    expect(find(state, "M").inTorpor).toBe(true);
  });

  it("superior can also pay 2 blood to bring them to the ready region", () => {
    const { state, engine } = setup(["Graverobbing"], { dom: "superior" }, torpid);
    const ready = optionIds(engine).find(
      (o) => o.startsWith("play:Graverobbing:superior") && o.includes(":M:1:"),
    );
    expect(ready).toBeDefined();
    const before = find(state, "V1").blood;
    playAndResolve(engine, state, ready!);
    expect(holderOf(state, "M")).toBe("Alice");
    expect(find(state, "M").inTorpor).toBe(false);
    expect(find(state, "V1").blood).toBe(before - 2);
  });

  it("…and can decline the move: control changes, torpor stays", () => {
    const { state, engine } = setup(["Graverobbing"], { dom: "superior" }, torpid);
    const stay = optionIds(engine).find(
      (o) => o.startsWith("play:Graverobbing:superior") && o.includes(":M:0:"),
    );
    expect(stay).toBeDefined();
    const before = find(state, "V1").blood;
    playAndResolve(engine, state, stay!);
    expect(find(state, "M").inTorpor).toBe(true);
    expect(find(state, "V1").blood).toBe(before);
  });

  it("NEGATIVE SPACE: a vampire who is NOT in torpor is not a target", () => {
    const { engine } = setup(["Graverobbing"], { dom: "basic" }, (s) => {
      // W is torpid so the card is on the table; M is upright.
      Object.assign(find(s, "W"), { inTorpor: true });
    });
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Graverobbing"));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((o) => o.includes(":M"))).toBe(false);
  });
});

describe("Puppet Master (101215)", () => {
  const younger = (s: GameState) => {
    Object.assign(find(s, "M"), { capacity: 3, locked: false });
  };

  it("superior attaches, locks the bearer, and stops them unlocking", () => {
    const { state, engine } = setup(["Puppet Master"], { dom: "superior" }, younger);
    const id = optionIds(engine).find(
      (o) => o.startsWith("play:Puppet Master:superior") && o.includes(":M:"),
    )!;
    playAndResolve(engine, state, id);
    const entry = entryOn(state, "M", "Puppet Master");
    expect(entry).toBeDefined();
    // p. 16: Alice's card even though it sits on Bob's vampire.
    expect(entry?.controller).toBe("Alice");
    expect(entry?.preventsUnlock).toBe("M");
    expect(find(state, "M").locked).toBe(true);
  });

  it("TEMPORARY CONTROL: cashing it in borrows the vampire, who goes home at end of turn", () => {
    const { state, engine } = setup(["Puppet Master"], { dom: "superior" }, younger);
    const id = optionIds(engine).find(
      (o) => o.startsWith("play:Puppet Master:superior") && o.includes(":M:"),
    )!;
    playAndResolve(engine, state, id);
    expect(holderOf(state, "M")).toBe("Bob");
    // "During your NEXT minion phase" — a turn cycle away.
    expect(walkTo(engine, "ability:Puppet Master")).toBe(true);
    const cash = optionIds(engine).find((o) => o.startsWith("ability:Puppet Master"))!;
    runTrace(engine, [["Alice", cash]]);
    expect(holderOf(state, "M")).toBe("Alice");
    expect(find(state, "M").locked).toBe(false);
    // …and back to Bob once Alice's turn ends.
    for (let i = 0; i < 60; i++) {
      if (holderOf(state, "M") === "Bob") break;
      const dp = engine.decision();
      if (!dp) break;
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    expect(holderOf(state, "M")).toBe("Bob");
  });

  it("NEGATIVE SPACE: an OLDER vampire is not a legal bearer", () => {
    const { engine } = setup(["Puppet Master"], { dom: "superior" }, (s) => {
      Object.assign(find(s, "V1"), { capacity: 3 });
      Object.assign(find(s, "M"), { capacity: 9 });
      Object.assign(find(s, "W"), { capacity: 2 }); // keeps the card on the table
    });
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Puppet Master:superior"));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((o) => o.includes(":M"))).toBe(false);
  });
});

describe("Slaughtering the Herd (101801)", () => {
  /** Alice's predator is Carol, so the bearer must be one of Carol's. */
  const setupHerd = () =>
    setup(["Slaughtering the Herd"], { dom: "superior" }, (s) => {
      // The buy-off costs 4 blood, so the bearer needs it to be offered.
      Object.assign(find(s, "N"), { blood: 6, capacity: 8 });
    });

  it("attaches to a PREDATOR's vampire and remembers who played it", () => {
    const { state, engine } = setupHerd();
    const id = optionIds(engine).find((o) => o.startsWith("play:Slaughtering the Herd:superior"))!;
    expect(id).toBeDefined();
    playAndResolve(engine, state, id);
    const entry = entryOn(state, "N", "Slaughtering the Herd");
    expect(entry).toBeDefined();
    expect(entry?.controller).toBe("Alice");
    // The card is ABOUT Alice's vampire without being attached to it.
    expect(entry?.linkedMinion).toBe("V1");
  });

  it("siphons 1 blood each time the attached vampire ANNOUNCES an action", () => {
    const { state, engine } = setupHerd();
    const id = optionIds(engine).find((o) => o.startsWith("play:Slaughtering the Herd:superior"))!;
    playAndResolve(engine, state, id);
    const bearerBefore = find(state, "N").blood;
    const actorBefore = find(state, "V1").blood;
    // Walk until Carol's N announces something.
    for (let i = 0; i < 90; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const act = dp.options.find((o) => o.id === "bleed:N" || o.id === "hunt:N");
      const pick = act ?? dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
      if (act) break;
    }
    expect(find(state, "N").blood).toBe(bearerBefore - 1);
    expect(find(state, "V1").blood).toBe(actorBefore + 1);
  });

  it("the bearer can burn 4 blood to be rid of it — bearerCanBurn's second user", () => {
    const { state, engine } = setupHerd();
    const id = optionIds(engine).find((o) => o.startsWith("play:Slaughtering the Herd:superior"))!;
    playAndResolve(engine, state, id);
    let used = false;
    for (let i = 0; i < 150 && !used; i++) {
      const dp = engine.decision();
      if (!dp) break;
      const buy = dp.options.find((o) => o.id.startsWith("ability:Slaughtering the Herd"));
      if (buy && dp.seat === "Carol") {
        runTrace(engine, [["Carol", buy.id]]);
        used = true;
        break;
      }
      const pick = dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
      runTrace(engine, [[dp.seat, pick.id]]);
    }
    expect(used).toBe(true);
    expect(entryOn(state, "N", "Slaughtering the Herd")).toBeUndefined();
  });

  it("burns when the ACTING vampire leaves the ready region, not the bearer", () => {
    const { state, engine } = setupHerd();
    const id = optionIds(engine).find((o) => o.startsWith("play:Slaughtering the Herd:superior"))!;
    playAndResolve(engine, state, id);
    expect(entryOn(state, "N", "Slaughtering the Herd")).toBeDefined();
    // Burning V1 — Alice's own vampire, not the bearer — kills the card.
    const raw = engine as unknown as { burnMinion(id: string): void; settle(): void };
    raw.burnMinion("V1");
    expect(entryOn(state, "N", "Slaughtering the Herd")).toBeUndefined();
  });
});

describe("Break the Bonds (102247)", () => {
  it("is one COMBINED mode built from the actor's Disciplines, not three choices", () => {
    const { engine } = setup(["Break the Bonds"], { ani: "basic", pre: "basic" }, (s) => {
      find(s, "V1").sect = "anarch";
      s.seats[0]!.uncontrolled.push({
        card: makeMinion("u1", "Alice", { name: "Recruit", capacity: 3 }),
        counters: 0,
      });
    });
    const ids = optionIds(engine).filter((o) => o.startsWith("play:Break the Bonds"));
    expect(ids.length).toBeGreaterThan(0);
    // `multiDiscipline` collapses the printed clauses: offering a mode to
    // pick would be offering a lie, since they are additive.
    expect(ids.every((o) => !o.includes(":obf:"))).toBe(true);
  });

  it("NEGATIVE SPACE: requires an Anarch", () => {
    // Built directly rather than through `setup`, which walks forward to
    // the card and would throw before the assertion could run.
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), {
      disciplines: { ani: "basic" },
      blood: 6,
      sect: "camarilla",
    });
    state.seats[0]!.hand.push({ id: "a0", name: "Break the Bonds" });
    const engine = new VtesEngine(state, testRegistry);
    expect(optionIds(engine).some((o) => o.startsWith("play:Break the Bonds"))).toBe(false);
    // …and the control case: the same card IS offered to an Anarch.
    const ok = threeSeatGame();
    Object.assign(find(ok, "V1"), { disciplines: { ani: "basic" }, blood: 6, sect: "anarch" });
    ok.seats[0]!.hand.push({ id: "a0", name: "Break the Bonds" });
    const engine2 = new VtesEngine(ok, testRegistry);
    expect(optionIds(engine2).some((o) => o.startsWith("play:Break the Bonds"))).toBe(true);
  });
});
