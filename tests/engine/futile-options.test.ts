/**
 * Options that would do nothing (docs/futile-options-design.md).
 *
 * Found in an owner playtest: 8 pool poured onto a 7-capacity vampire,
 * and a Blood Doll happily offering to feed a vampire already at
 * capacity. Both are legal moves that accomplish nothing, and both spend
 * a real resource — a transfer, a pool counter, a card's once-per-phase
 * use.
 *
 * The rule they share is p. 6: "A vampire cannot have more blood than
 * their capacity; if an effect puts more blood on them than their
 * capacity allows, the excess is always moved to the blood bank
 * immediately." So the engine's DRAIN was always right; what was wrong
 * was offering the move in the first place.
 *
 * Every case is tested in BOTH directions — the option appears when the
 * minion has room and vanishes when it does not — because an option list
 * that is empty for the wrong reason looks exactly like one that is
 * correctly empty.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine, canGainBlood, capacityOf } from "../../src/engine/index.ts";
import { makeAlly, makeMinion, testRegistry, threeSeatGame } from "./fixtures.ts";

function optionIds(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}

/** Walk to a decision offering `prefix`, or run out. */
function walkTo(engine: VtesEngine, prefix: string, limit = 160): boolean {
  for (let i = 0; i < limit; i++) {
    const dp = engine.decision();
    if (!dp) return false;
    if (dp.options.some((o) => o.id.startsWith(prefix))) return true;
    const pick =
      dp.options.find((o) => o.id === "pass") ??
      dp.options.find((o) => o.id === "end") ??
      dp.options[0]!;
    engine.choose(pick.id);
  }
  return false;
}

describe("the rule itself", () => {
  it("canGainBlood reads DERIVED capacity, so a granted point counts", () => {
    const m = makeMinion("V", "Alice", { blood: 5, capacity: 5 });
    expect(canGainBlood(m)).toBe(false);
    // A Discipline master raising capacity opens the door again.
    m.attached.push({
      card: { id: "cap", name: "Potence" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: { capacityBonus: 1 },
      tags: [],
    });
    expect(capacityOf(m)).toBe(6);
    expect(canGainBlood(m)).toBe(true);
  });
});

describe("influence transfers stop at capacity", () => {
  /** Alice's influence phase, with one uncontrolled vampire. */
  function atInfluence(counters: number, capacity: number): VtesEngine {
    const state = threeSeatGame();
    const seat = state.seats[0]!;
    seat.pool = 20;
    seat.uncontrolled = [
      { card: makeMinion("U1", "Alice", { blood: 0, capacity }), counters },
    ];
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "inf:");
    return engine;
  }

  it("offers the transfer while there is room", () => {
    const engine = atInfluence(3, 7);
    expect(optionIds(engine)).toContain("inf:add:U1");
  });

  it("STOPS offering it once the counters reach capacity", () => {
    // This is the owner's bug: at 7 of 7 the engine kept offering more,
    // and every extra counter drained to the blood bank on entry (p. 6).
    const engine = atInfluence(7, 7);
    expect(optionIds(engine)).not.toContain("inf:add:U1");
    // …and the vampire can be brought out instead, so the phase is not
    // simply dead — the list is empty for the RIGHT reason.
    expect(optionIds(engine)).toContain("inf:out:U1");
  });

  it("leaves room to add again once capacity rises", () => {
    // The gate reads DERIVED capacity, so a card that raises it reopens
    // the transfer rather than stranding the counters.
    const engine = atInfluence(7, 8);
    expect(optionIds(engine)).toContain("inf:add:U1");
  });
});

describe("Blood Doll does not offer a futile feed", () => {
  function withBloodDoll(blood: number, capacity: number): VtesEngine {
    const state = threeSeatGame();
    const v = state.seats[0]!.minions[0]!;
    v.blood = blood;
    v.capacity = capacity;
    state.seats[0]!.pool = 10;
    v.attached.push({
      card: { id: "bd1", name: "Blood Doll" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: [],
    });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "ability:Blood Doll");
    return engine;
  }

  it("offers pool → vampire while the vampire has room", () => {
    const engine = withBloodDoll(3, 7);
    expect(optionIds(engine)).toContain("ability:Blood Doll:bd1:toVampire");
  });

  it("does NOT offer it to a vampire at capacity", () => {
    const engine = withBloodDoll(7, 7);
    expect(optionIds(engine)).not.toContain("ability:Blood Doll:bd1:toVampire");
    // The other direction still works, so Blood Doll is not simply gone.
    expect(optionIds(engine)).toContain("ability:Blood Doll:bd1:toPool");
  });
});

describe("hunting grounds do not offer a futile feed", () => {
  function withHuntingGround(blood: number, capacity: number): VtesEngine {
    const state = threeSeatGame();
    const v = state.seats[0]!.minions[0]!;
    v.blood = blood;
    v.capacity = capacity;
    v.clan = "Ventrue";
    state.seats[0]!.permanents.push({
      card: { id: "ahg", name: "Academic Hunting Ground" },
      controller: "Alice",
      owner: "Alice",
      locked: false,
      usedThisPhase: false,
      statics: {},
      tags: ["location", "hunting ground"],
    });
    const engine = new VtesEngine(state, testRegistry);
    walkTo(engine, "ability:Academic Hunting Ground");
    return engine;
  }

  it("offers blood to a Ventrue with room", () => {
    const engine = withHuntingGround(2, 7);
    expect(optionIds(engine).some((o) => o.startsWith("ability:Academic Hunting Ground"))).toBe(
      true,
    );
  });

  it("does NOT offer it to a Ventrue at capacity", () => {
    // The location's once-per-phase use would be spent for nothing. All
    // thirteen hunting grounds share one mechanic, so this covers them.
    const engine = withHuntingGround(7, 7);
    expect(optionIds(engine).some((o) => o.startsWith("ability:Academic Hunting Ground"))).toBe(
      false,
    );
  });
});

describe("an ALLY is capped by its printed starting life the same way", () => {
  it("canGainBlood answers for allies too (p. 11: life IS its blood)", () => {
    const full = makeAlly("A", "Alice", 3, { capacity: 3 });
    expect(canGainBlood(full)).toBe(false);
    const hurt = makeAlly("B", "Alice", 1, { capacity: 3 });
    expect(canGainBlood(hurt)).toBe(true);
  });
});

describe("the drain itself is unchanged, and goes to the BLOOD BANK", () => {
  it("excess blood is destroyed, not returned to the controller's pool", () => {
    // p. 6, and again on the uncontrolled→ready transition: "any blood
    // counters in excess of the capacity drain back to the blood bank".
    // NOT to the Methuselah's pool — this is the half of the owner's
    // report where the engine was already right.
    const state: GameState = threeSeatGame();
    const v = state.seats[0]!.minions[0]!;
    v.capacity = 5;
    v.blood = 5;
    const poolBefore = state.seats[0]!.pool;
    const engine = new VtesEngine(state, testRegistry);
    engine.emit({ type: "BloodGained", minion: v.id, amount: 3 });
    const after = state.seats.flatMap((s) => s.minions).find((m) => m.id === v.id)!;
    expect(after.blood).toBe(5);
    expect(state.seats[0]!.pool).toBe(poolBefore);
  });
});
