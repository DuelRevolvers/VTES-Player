/**
 * Legacy action modifiers — tranche 3 wave 9
 * (docs/pool-widening-design.md §6).
 *
 * Mantle of the Moon, Stiff Contempt, Spoils of War, Acheron Vortex.
 *
 * Each asked the vocabulary for one more knob, and two of them are the
 * kind of card that is wrong in a direction nobody notices:
 *
 *  - **Stiff Contempt** taxes VAMPIRES. Without the kind filter an ally
 *    facing a blood-only toll cannot pay and so cannot block at all
 *    (p. 22) — the card would read "vampires pay 1" and behave as
 *    "allies cannot block".
 *  - **Acheron Vortex** exempts two disciplines no vampire in this pool
 *    has, so today it hits everyone. Both halves are asserted, the
 *    exemption with a vampire given the discipline by hand.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";

const WAVE: Array<[number, string]> = [
  [101162, "Mantle of the Moon"],
  [101870, "Stiff Contempt"],
  [101854, "Spoils of War"],
  [100016, "Acheron Vortex"],
];

/** Alice's V1 hunts (+1 inherent stealth, p. 21) with `name` in hand. */
function hunting(name: string, setup: (s: GameState) => void = () => {}) {
  const state = threeSeatGame();
  state.seats[0]!.minions[0]!.blood = 2;
  setup(state);
  state.seats[0]!.hand.push({ id: "am", name });
  const engine = new VtesEngine(state, testRegistry);
  // The announce cycle first: an action modifier is offered in the
  // EFFECTS window that follows it, not at the moment of announcement.
  runTrace(engine, [
    ["Alice", "hunt:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}

function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Play the modifier and close its AS-PLAYED window, which is when the
 *  effects actually land — reading the board before that closes shows a
 *  card that has done nothing yet, and a "no blocks offered" assertion
 *  taken there passes because the decision belongs to Alice. */
function playThen(engine: VtesEngine, name: string, rest: Array<[string, string]>): void {
  const opt = ids(engine).find((o) => o.startsWith(`play:${name}`));
  if (!opt) throw new Error(`${name} not offered: ${ids(engine).join(", ")}`);
  runTrace(engine, [
    ["Alice", opt],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ...rest,
  ]);
}

describe("Mantle of the Moon (101162) — the action is unblockable", () => {
  it("takes every blocker off the table, ally and vampire alike", () => {
    const { state, engine } = hunting("Mantle of the Moon", (s) => {
      s.seats[0]!.minions[0]!.blood = 5; // it costs 4 blood
      s.seats[1]!.minions.push(makeMinion("A1", "Bob", { kind: "ally" }));
    });
    playThen(engine, "Mantle of the Moon", [["Alice", "pass"]]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob"); // read it at BOB's decision, or it is vacuous
    expect(dp.options.some((o) => o.id.startsWith("block:"))).toBe(false);
  });

  it("NEGATIVE SPACE: without it, both of them can block", () => {
    // The control. A hunt is +1 stealth and these blockers have 0
    // intercept, but an ATTEMPT is still legal — being unable to win is
    // not the same as being barred.
    const { engine } = hunting("Mantle of the Moon", (s) => {
      s.seats[1]!.minions.push(makeMinion("A1", "Bob", { kind: "ally" }));
    });
    runTrace(engine, [["Alice", "pass"]]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("block:"))).toBe(true);
  });
});

describe("Stiff Contempt (101870) — vampires pay to attempt", () => {
  function contempt() {
    return hunting("Stiff Contempt", (s) => {
      s.seats[1]!.minions.push(makeMinion("A1", "Bob", { kind: "ally", blood: 2 }));
      s.seats[1]!.minions.find((m) => m.id === "M")!.blood = 2;
    });
  }

  it("still lets an ALLY block for free — the kind filter", () => {
    // The whole reason the filter exists. An ally has life, not blood
    // (p. 22), so a blood toll it is not exempt from bars it outright.
    const { engine } = contempt();
    playThen(engine, "Stiff Contempt", [["Alice", "pass"]]);
    expect(ids(engine)).toContain("block:A1");
  });

  it("charges the vampire 1 blood to attempt", () => {
    const { state, engine } = contempt();
    playThen(engine, "Stiff Contempt", [["Alice", "pass"], ["Bob", "block:M"]]);
    expect(state.seats[1]!.minions.find((m) => m.id === "M")!.blood).toBe(1);
  });

  it("NEGATIVE SPACE: a vampire with no blood cannot attempt at all", () => {
    const { engine } = hunting("Stiff Contempt", (s) => {
      s.seats[1]!.minions.find((m) => m.id === "M")!.blood = 0;
      s.seats[1]!.minions.find((m) => m.id === "W")!.blood = 0;
    });
    playThen(engine, "Stiff Contempt", [["Alice", "pass"]]);
    const dp = engine.decision()!;
    expect(dp.seat).toBe("Bob");
    expect(dp.options.some((o) => o.id.startsWith("block:"))).toBe(false);
  });
});

describe("Acheron Vortex (100016) — −1 intercept, with an exemption", () => {
  it("is offered with NO block attempt underway [LSJ 20020612]", () => {
    // The p. 26 override. Every other intercept-shifting modifier waits
    // for a live attempt; this one says otherwise in a ruling.
    const { engine } = hunting("Acheron Vortex");
    expect(ids(engine).some((o) => o.startsWith("play:Acheron Vortex"))).toBe(true);
  });

  it("drops intercept for a minion without either discipline", () => {
    const { state, engine } = hunting("Acheron Vortex");
    playThen(engine, "Acheron Vortex", []);
    expect(
      state.eventLog.some(
        (e) => e.type === "ActionInterceptModified" && e.source === "Acheron Vortex",
      ),
    ).toBe(true);
  });

  it("spares a minion that HAS one of them", () => {
    // The exemption, tested with a vampire given `nec` by hand — nothing
    // in this pool carries it, so without this the exempt branch would
    // never run and the field could be inert.
    const { state, engine } = hunting("Acheron Vortex", (s) => {
      s.seats[1]!.minions.find((m) => m.id === "M")!.disciplines = { nec: "basic" };
    });
    playThen(engine, "Acheron Vortex", [["Alice", "pass"], ["Bob", "block:M"]]);
    // M has 0 printed intercept and is exempt, so it is still 0 rather
    // than −1: the block attempt is live, which it could not be if the
    // card had barred it.
    expect(state.frames.some((f) => f.kind === "action")).toBe(true);
  });
});

describe("Spoils of War (101854)", () => {
  it("pays 1 blood and 1 pool after a successful DIRECTED action", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.blood = 1;
    state.seats[0]!.hand.push({ id: "am", name: "Spoils of War" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"], // a bleed is directed
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → unblocked
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
    const opt = ids(engine).find((o) => o.startsWith("play:Spoils of War"));
    expect(opt).toBeDefined();
    runTrace(engine, [
      ["Alice", opt!],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
    ]);
    expect(state.seats[0]!.minions[0]!.blood).toBe(2);
    expect(state.seats[0]!.pool).toBe(11);
  });

  it("NEGATIVE SPACE: not offered after an UNDIRECTED action", () => {
    // A hunt is undirected (p. 21). Same trace otherwise, and the card
    // must not appear — "directed" is half the printed clause.
    const { engine } = hunting("Spoils of War");
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // A → unblocked
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // C → resolve
    ]);
    expect(ids(engine).some((o) => o.startsWith("play:Spoils of War"))).toBe(false);
  });
});

describe("the admission path (§6)", () => {
  const reg = registry as unknown as CardRegistry;

  it("all four are in the pool, implemented, and named as printed", () => {
    const wrong = WAVE.filter(([id, name]) => {
      const e = reg.entries[id];
      return !e || !e.supported || e.card.name !== name;
    });
    expect(wrong.map(([id, name]) => `${name} (${id})`)).toEqual([]);
  });
});
