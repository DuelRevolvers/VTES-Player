/**
 * The Praxis Seizures — tranche 3 wave 5
 * (docs/pool-widening-design.md §6).
 *
 * Thirteen political actions that differ only in the city name: a
 * successful referendum puts the card on the acting vampire, and it
 * represents the unique Camarilla title of Prince of that city.
 *
 * `ReferendumFrame.cardInstanceId` has carried a comment since it was
 * written — "kept so a title-granting referendum can attach it on a pass"
 * — and this is the first card to use it.
 *
 * WHAT IS WORTH PINNING is not the referendum (politics-design.md owns
 * that) but the three things that fail silently: the title never being
 * granted, the card attaching to the wrong place, and the FAIL path
 * granting it anyway.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const CITIES: Array<[number, string, string]> = [
  [101447, "Amsterdam", "Praxis Seizure: Amsterdam"],
  [101449, "Atlanta", "Praxis Seizure: Atlanta"],
  [101452, "Boston", "Praxis Seizure: Boston"],
  [101455, "Chicago", "Praxis Seizure: Chicago"],
  [101456, "Cleveland", "Praxis Seizure: Cleveland"],
  [101457, "Dallas", "Praxis Seizure: Dallas"],
  [101458, "Dublin", "Praxis Seizure: Dublin"],
  [101459, "Frankfurt", "Praxis Seizure: Frankfurt"],
  [101462, "Houston", "Praxis Seizure: Houston"],
  [101464, "London", "Praxis Seizure: London"],
  [101465, "Miami", "Praxis Seizure: Miami"],
  [101469, "Seattle", "Praxis Seizure: Seattle"],
  [102307, "York", "Praxis Seizure: York"],
];

function v1(state: GameState): MinionState {
  return state.seats[0]!.minions[0]!;
}

/** Alice's V1 — a Camarilla vampire with no title — calls the seizure.
 *  `votesFor` decides whether it passes: V1 has no votes of its own, so
 *  the caller's own ballot is what the trace supplies. */
function callSeizure(city: string): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  Object.assign(v1(state), { sect: "camarilla" as const, title: null });
  state.seats[0]!.hand.push({ id: "px", name: `Praxis Seizure: ${city}` });
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", `play:Praxis Seizure: ${city}`],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → polling
  ]);
  return { state, engine };
}

/** Answer the polling step to the end, letting the referendum resolve. */
function settle(engine: VtesEngine, state: GameState): void {
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision();
    if (!dp || !state.frames.some((f) => f.kind === "referendum")) return;
    runTrace(engine, [[dp.seat, (dp.options.find((o) => o.id === "pass") ?? dp.options[0]!).id]]);
  }
}

describe("every city grants its own princedom", () => {
  for (const [id, city, full] of CITIES) {
    it(`Praxis Seizure: ${city} (${id}) makes the caller a prince`, () => {
      const { state, engine } = callSeizure(city);
      // A referendum with no votes cast either way FAILS (ties fail), so
      // the caller has to actually vote for it.
      runTrace(engine, [["Alice", "vote:caller:for"]]);
      settle(engine, state);
      expect(v1(state).title).toBe("prince");
      // …and the card is ON the vampire, not at seat level: a title that
      // sits in the wrong zone leaves nothing to contest and nothing to
      // burn.
      expect(v1(state).attached.map((p) => p.card.name)).toContain(full);
      expect(state.seats[0]!.permanents.map((p) => p.card.name)).not.toContain(full);
    });
  }
});

describe("the negative space", () => {
  it("a FAILED referendum grants no title and leaves no card in play", () => {
    // The control for all thirteen above. Alice declines to vote, so the
    // tally is 0–0 and a tie fails (p. 28).
    const { state, engine } = callSeizure("Chicago");
    settle(engine, state);
    expect(v1(state).title).toBeNull();
    expect(v1(state).attached.map((p) => p.card.name)).not.toContain("Praxis Seizure: Chicago");
  });

  it("is not offered to a NON-Camarilla vampire", () => {
    // "Requires a Camarilla vampire" — the `meetsRequirements` shape that
    // has now been forgotten four times in this codebase.
    const state = threeSeatGame();
    Object.assign(v1(state), { sect: "anarch" as const, title: null });
    state.seats[0]!.hand.push({ id: "px", name: "Praxis Seizure: Chicago" });
    const engine = new VtesEngine(state, testRegistry);
    const ids = engine.decision()!.options.map((o) => o.id);
    expect(ids.some((o) => o.startsWith("play:Praxis Seizure"))).toBe(false);

    // …and IS offered to a Camarilla one, so the line above is the sect
    // gate rather than the card being missing entirely.
    Object.assign(v1(state), { sect: "camarilla" as const });
    const after = new VtesEngine(state, testRegistry).decision()!.options.map((o) => o.id);
    expect(after.some((o) => o.startsWith("play:Praxis Seizure"))).toBe(true);
  });
});

describe("the title is a real title", () => {
  it("carries the `title` tag and the prince's votes", () => {
    // A title that grants no votes is the whole point missed: princes are
    // worth votes (p. 28), and a card filtering on titled minions reads
    // the tag.
    const { state, engine } = callSeizure("London");
    runTrace(engine, [["Alice", "vote:caller:for"]]);
    settle(engine, state);
    const entry = v1(state).attached.find((p) => p.card.name === "Praxis Seizure: London");
    expect(entry?.tags).toContain("title");
    expect(state.eventLog.some((e) => e.type === "TitleGranted" && e.title === "prince")).toBe(true);
  });
});

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all thirteen are in the pool, implemented, and named as printed", () => {
    const wrong = CITIES.filter(([id, , full]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== full;
    });
    expect(wrong.map(([id, , full]) => `${full} (${id})`)).toEqual([]);
  });

  it("the other fourteen Praxis Seizures stayed OUT — they print riders", () => {
    // Athens raises a Tremere prince's capacity, Berlin and the rest each
    // add a clause. §0: a card comes in when ALL of it is built, so the
    // ones with riders wait for a wave that builds the rider.
    const inPool = Object.values(reg.entries).filter((e) =>
      e.card.name.startsWith("Praxis Seizure:"),
    );
    expect(inPool.length).toBe(13);
    expect(inPool.every((e) => e.supported)).toBe(true);
  });
});

describe("the contested title", () => {
  it("two Princes of the SAME city contest — the printed clause, reachable", () => {
    // "This could lead to a contested title." The engine's contest
    // detector gates on `registry[name].isUnique`, so a card that only
    // DESCRIBES the contest without being unique prints a clause that can
    // never fire. Bob already holds Prince of Chicago; Alice seizes it.
    const state = threeSeatGame();
    Object.assign(v1(state), { sect: "camarilla" as const, title: null });
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.attached.push({
      card: { id: "bobPx", name: "Praxis Seizure: Chicago" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Prince of Chicago", "title"],
    });
    state.seats[0]!.hand.push({ id: "px", name: "Praxis Seizure: Chicago" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Praxis Seizure: Chicago"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → polling
      ["Alice", "vote:caller:for"],
    ]);
    settle(engine, state);

    // Both copies go face down into their holders' contested piles (p. 17)
    // and neither vampire is prince while the contest stands.
    const contestedNames = state.seats.flatMap((s) =>
      (s.contested ?? []).map((c) => c.card.name),
    );
    expect(contestedNames.filter((n) => n === "Praxis Seizure: Chicago").length).toBe(2);
    expect(v1(state).title).toBeNull();
    expect(m.title ?? null).toBeNull();
  });

  it("NEGATIVE SPACE: two DIFFERENT cities do not contest", () => {
    // The control. Uniqueness is the city, not the card type — a Prince
    // of Chicago and a Prince of London coexist, and a contest detector
    // keyed on the wrong thing would take both titles away.
    const state = threeSeatGame();
    Object.assign(v1(state), { sect: "camarilla" as const, title: null });
    const m = state.seats[1]!.minions.find((x) => x.id === "M")!;
    m.attached.push({
      card: { id: "bobPx", name: "Praxis Seizure: London" },
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Prince of London", "title"],
    });
    state.seats[0]!.hand.push({ id: "px", name: "Praxis Seizure: Chicago" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Praxis Seizure: Chicago"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "vote:caller:for"],
    ]);
    settle(engine, state);
    expect(state.seats.flatMap((s) => s.contested ?? [])).toEqual([]);
    expect(v1(state).title).toBe("prince");
  });
});
