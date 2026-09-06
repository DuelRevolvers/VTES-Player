/**
 * Touch of Oblivion (102283) — the second counter sink
 * (docs/counter-sinks-design.md), and the one that pays for *unlocking*
 * rather than for replacement draws.
 *
 *   [obl] Strike: put this card on the opposing minion with 2 counters.
 *   The attached minion burns 1 counter from this card instead of
 *   unlocking as normal. If this card has no counters, burn it.
 *   [OBL] Strike: send the opposing vampire to torpor or burn the
 *   opposing ally.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { makeAlly, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** V1 (Alice, acting) bleeds Bob; M (Bob) blocks → combat, at Before Range. */
function enterCombat(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"],
    ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

const toStrikes: Array<[string, string]> = [
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
  ["Alice", "pass"], ["Bob", "pass"], // range → close
  ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
];

/** Alice's V1 with Oblivion and the blood to pay for it. */
function game(level: "basic" | "superior"): GameState {
  const state = threeSeatGame();
  Object.assign(state.seats[0]!.minions[0]!, {
    disciplines: { obl: level },
    blood: 4,
  });
  state.seats[1]!.minions.find((m) => m.id === "M")!.blood = 3;
  state.seats[0]!.hand.push({ id: "to", name: "Touch of Oblivion" });
  return state;
}

function find(state: GameState, id: string): MinionState | undefined {
  return state.seats.flatMap((s) => s.minions).find((m) => m.id === id);
}

describe("Touch of Oblivion — inferior (attach with counters)", () => {
  it("puts itself on the opposing minion with 2 counters, controlled by its player", () => {
    const state = game("basic");
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ...toStrikes,
      ["Alice", "play:Touch of Oblivion:basic"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Bob", "strike:hand"],
    ]);

    const attached = find(state, "M")!.attached.find((p) => p.card.id === "to")!;
    expect(attached.counters).toBe(2);
    expect(attached.controller).toBe("Alice"); // p. 16
    expect(state.seats[0]!.minions[0]!.blood).toBe(2); // the 2-blood cost
  });

  it("burns a counter instead of unlocking, then burns out", () => {
    const state = threeSeatGame();
    // Skip the combat: put the card on M directly, as its strike would.
    const m = find(state, "M")!;
    m.locked = true;
    m.attached.push({
      card: { id: "to", name: "Touch of Oblivion" },
      controller: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Touch of Oblivion"],
      counters: 2,
      counterSink: { instead: "unlock", burnWhenEmpty: true },
    });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
    }
    const engine = new VtesEngine(state, testRegistry);
    engine.decision(); // settle runs Bob's unlock phase

    expect(find(state, "M")!.locked).toBe(true); // held down
    expect(find(state, "M")!.attached[0]!.counters).toBe(1);

    // A second unlock phase spends the last counter and burns the card…
    const tf2 = state.frames[0]!;
    if (tf2.kind === "turn") {
      tf2.phase = "unlock";
      tf2.unlockDone = false;
      tf2.unlockAbilitiesDone = false;
    }
    engine.decision();
    expect(find(state, "M")!.locked).toBe(true);
    expect(find(state, "M")!.attached).toHaveLength(0);

    // …and the third finds nothing holding it, so it unlocks.
    const tf3 = state.frames[0]!;
    if (tf3.kind === "turn") {
      tf3.phase = "unlock";
      tf3.unlockDone = false;
      tf3.unlockAbilitiesDone = false;
    }
    engine.decision();
    expect(find(state, "M")!.locked).toBe(false);
  });

  it("spends no counter on a minion that was not going to unlock anyway", () => {
    const state = threeSeatGame();
    const m = find(state, "M")!;
    m.locked = false; // already unlocked
    m.attached.push({
      card: { id: "to", name: "Touch of Oblivion" },
      controller: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["Touch of Oblivion"],
      counters: 2,
      counterSink: { instead: "unlock", burnWhenEmpty: true },
    });
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.seat = "Bob";
      tf.phase = "unlock";
      tf.unlockDone = false;
      tf.unlockAbilitiesDone = false;
    }
    new VtesEngine(state, testRegistry).decision();

    expect(find(state, "M")!.attached[0]!.counters).toBe(2);
  });
});

describe("Touch of Oblivion — superior (incapacitate)", () => {
  it("sends the opposing vampire to torpor", () => {
    const state = game("superior");
    const engine = new VtesEngine(state, testRegistry);
    enterCombat(engine);

    runTrace(engine, [
      ...toStrikes,
      ["Alice", "play:Touch of Oblivion:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Bob", "strike:hand"],
    ]);

    expect(find(state, "M")!.inTorpor).toBe(true);
    // M's own hand strike still landed — strikes resolve simultaneously
    // (p. 30) — so damage resolution runs before the combat can end.
    runTrace(engine, [
      ["Alice", "pass"], // damage resolution (V1 takes M's hand strike)
      // "The round and the combat end immediately" (p. 30), but the End
      // of Round step still occurs (p. 32).
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    expect(state.frames.some((f) => f.kind === "combat")).toBe(false);
  });

  it("burns the opposing ally instead", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, {
      disciplines: { obl: "superior" },
      blood: 4,
    });
    // Bob blocks with an ally rather than a vampire.
    state.seats[1]!.minions = [makeAlly("A1", "Bob", 3)];
    state.seats[0]!.hand.push({ id: "to", name: "Touch of Oblivion" });
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:A1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ...toStrikes,
      ["Alice", "play:Touch of Oblivion:superior"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Bob", "strike:hand"],
    ]);

    expect(find(state, "A1")).toBeUndefined(); // burned, not torpored
  });
});
