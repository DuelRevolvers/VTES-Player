/**
 * Granted hunts (docs/granted-hunts-design.md): Week of Nightmares' "steal
 * 1 blood from another Ravnos as a +1 stealth hunt action" is a HUNT.
 *
 * It was announced as a plain card action, which was invisible while no
 * card read hunt actions. Restricted Vitae reads them, and so does p. 19's
 * mandatory hunt, which the aura's "do not hunt as normal" collides with
 * for a Ravnos with no blood. Every case pins its negative space too: an
 * option list that is too wide looks exactly as plausible as a right one.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine, blockEligibleSeats } from "../../src/engine/index.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const STEAL = "act:Week of Nightmares:won:steal";

const ids = (engine: VtesEngine): string[] => engine.decision()!.options.map((o) => o.id);
const minion = (state: GameState, id: string): MinionState => {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
};
const action = (state: GameState) => {
  const af = state.frames.find((f) => f.kind === "action");
  return af?.kind === "action" ? af : null;
};
const entry = (id: string, name: string, extra: Partial<PermanentInPlay> = {}): PermanentInPlay => ({
  card: { id, name },
  locked: false,
  usedThisPhase: false,
  statics: {},
  tags: [],
  ...extra,
});

function week(): PermanentInPlay {
  return entry("won", "Week of Nightmares", {
    controller: "Alice",
    tags: ["Week of Nightmares"],
    counters: 10,
    aura: { scope: "global", clan: "Ravnos", bleed: 1, strength: 1, cannotHunt: true },
  });
}

const vitae = (): PermanentInPlay =>
  entry("rv", "Restricted Vitae", { statics: { huntingRestricted: true }, tags: ["event", "gehenna"] });

/** Alice's minion phase. Every vampire is Ravnos and Week of Nightmares is
 *  in play. V1 (Alice), W and M (Bob), N (Carol). */
function nightmareTable(): GameState {
  const state = threeSeatGame();
  for (const s of state.seats) for (const m of s.minions) m.clan = "Ravnos";
  state.seats[0]!.permanents.push(week());
  return state;
}

/** Announce `id`, then pass every window until the action has resolved. */
function steal(engine: VtesEngine, state: GameState, id: string): void {
  runTrace(engine, [["Alice", id]]);
  while (action(state)) runTrace(engine, [[engine.decision()!.seat, "pass"]]);
}

describe("a Ravnos with no blood (p. 19)", () => {
  it("makes its mandatory hunt with the steal, not the basic hunt", () => {
    const state = nightmareTable();
    minion(state, "V1").blood = 0;
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { clan: "Brujah" }));
    const o = ids(new VtesEngine(state, testRegistry));

    // The aura took the basic hunt away — in THIS branch too.
    expect(o).not.toContain("hunt:V1");
    expect(o).toContain(`${STEAL}:V1:W`);
    // The hunt is owed, so nothing else is offered, and the phase can't end.
    expect(o).not.toContain("bleed:V2");
    expect(o).not.toContain("end");

    // Control: without the card, the same vampire hunts as normal.
    const plain = threeSeatGame();
    minion(plain, "V1").blood = 0;
    expect(ids(new VtesEngine(plain, testRegistry))).toContain("hunt:V1");
  });

  it("is stuck when it has no way to hunt, and holds nobody back", () => {
    const state = threeSeatGame();
    Object.assign(minion(state, "V1"), { clan: "Ravnos", blood: 0 });
    state.seats[0]!.permanents.push(week());
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { clan: "Brujah" }));
    const engine = new VtesEngine(state, testRegistry);
    const options = engine.decision()!.options;

    // No other Ravnos to steal from and no hunt card: no action at all.
    expect(options.filter((x) => "minion" in x && x.minion === "V1")).toEqual([]);
    // "This does not prevent your other minions from performing actions."
    expect(options.map((x) => x.id)).toContain("bleed:V2");
    expect(options.map((x) => x.id)).toContain("end");

    // Control: a second Ravnos enters the table, and the hunt is owed again.
    minion(state, "W").clan = "Ravnos";
    const o = ids(engine);
    expect(o).toContain(`${STEAL}:V1:W`);
    expect(o).not.toContain("bleed:V2");
  });
});

describe("what the steal takes", () => {
  it("can aim at a Ravnos with no blood: the action succeeds, the hunt does not", () => {
    const state = nightmareTable();
    minion(state, "V1").blood = 0;
    minion(state, "W").blood = 0;
    // A "do not replace until a vampire successfully hunts" wait, with a
    // card to draw, so "not released" and "nothing to draw" differ.
    state.drawWhenCondition = [{ seat: "Alice", until: "vampireHunts" }];
    state.seats[0]!.library.push({ id: "lib", name: "Conditioning" });
    const engine = new VtesEngine(state, testRegistry);
    expect(ids(engine)).toContain(`${STEAL}:V1:W`);

    steal(engine, state, `${STEAL}:V1:W`);

    expect(minion(state, "V1").blood).toBe(0);
    expect(minion(state, "V1").locked).toBe(true);
    expect(state.seats[0]!.library).toHaveLength(1);
  });

  it("adds hunt value, capped at the victim's blood, and is paid once", () => {
    const state = nightmareTable();
    Object.assign(minion(state, "V1"), {
      blood: 1,
      attached: [entry("hb", "Hunt Bonus", { statics: { hunt: 1 } })],
    });
    minion(state, "W").blood = 3;
    const engine = new VtesEngine(state, testRegistry);
    steal(engine, state, `${STEAL}:V1:W`);
    // 1 printed + 1 hunt, all of it taken from the victim [RTR 20030519].
    expect(minion(state, "V1").blood).toBe(3);
    expect(minion(state, "W").blood).toBe(1);

    const capped = nightmareTable();
    Object.assign(minion(capped, "V1"), {
      blood: 1,
      attached: [entry("hb", "Hunt Bonus", { statics: { hunt: 1 } })],
    });
    minion(capped, "W").blood = 1;
    const e2 = new VtesEngine(capped, testRegistry);
    steal(e2, capped, `${STEAL}:V1:W`);
    // "Cannot steal more blood than the target has" [LSJ 20100915].
    expect(minion(capped, "V1").blood).toBe(2);
    expect(minion(capped, "W").blood).toBe(0);
  });

  it("does not reach a vampire that cannot be the target of other Methuselahs' actions", () => {
    const state = nightmareTable();
    minion(state, "W").attached.push(entry("sh", "Secure Haven", { statics: { untargetableByOthers: true } }));
    const o = ids(new VtesEngine(state, testRegistry));
    expect(o).not.toContain(`${STEAL}:V1:W`);
    expect(o).toContain(`${STEAL}:V1:N`);
  });

  it("stays once per turn", () => {
    const state = nightmareTable();
    const engine = new VtesEngine(state, testRegistry);
    steal(engine, state, `${STEAL}:V1:W`);
    minion(state, "V1").locked = false;
    expect(ids(engine).some((i) => i.startsWith(`${STEAL}:V1:`))).toBe(false);
    expect(ids(engine)).toContain("bleed:V1");
  });
});

describe("Restricted Vitae and the steal", () => {
  it("bars the steal unless the Ravnos must hunt", () => {
    const state = nightmareTable();
    state.seats[2]!.permanents.push(vitae());
    const o = ids(new VtesEngine(state, testRegistry));
    expect(o).not.toContain(`${STEAL}:V1:W`);
    expect(o).toContain("bleed:V1");

    // Control: the same table without the event offers it.
    const free = nightmareTable();
    expect(ids(new VtesEngine(free, testRegistry))).toContain(`${STEAL}:V1:W`);
  });

  it("leaves a hungry Ravnos both steals, and no basic hunt", () => {
    const state = nightmareTable();
    // Older than everyone, so Restricted Vitae's "younger vampire" steal
    // has targets.
    Object.assign(minion(state, "V1"), { blood: 0, capacity: 8 });
    state.seats[2]!.permanents.push(vitae());
    const o = ids(new VtesEngine(state, testRegistry));
    expect(o).toContain(`${STEAL}:V1:W`);
    // "Other non-standard hunt actions are still permitted" [LSJ 20090606].
    expect(o.some((i) => i.startsWith("hunt:V1:steal:"))).toBe(true);
    expect(o).not.toContain("hunt:V1");
  });

  it("is released by a successful steal", () => {
    const state = nightmareTable();
    minion(state, "V1").blood = 0;
    state.seats[2]!.permanents.push(vitae());
    state.drawWhenCondition = [{ seat: "Alice", until: "vampireHunts" }];
    state.seats[0]!.library.push({ id: "lib", name: "Conditioning" });
    const hand = state.seats[0]!.hand.length;
    const engine = new VtesEngine(state, testRegistry);

    steal(engine, state, `${STEAL}:V1:W`);

    expect(minion(state, "V1").blood).toBe(1);
    expect(state.seats[0]!.library).toHaveLength(0);
    expect(state.seats[0]!.hand.length).toBe(hand + 1);
  });
});

describe("whom the steal is directed at (p. 25)", () => {
  it("a rival's Ravnos: directed at that rival, who alone may block", () => {
    const state = nightmareTable();
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [["Alice", `${STEAL}:V1:W`]]);
    const af = action(state)!;
    expect(af.actionKind).toBe("hunt");
    expect(af.directed).toBe(true);
    expect(af.target).toBe("Bob");
    expect(blockEligibleSeats(state, af)).toEqual(["Bob"]);
    // A hunt, so Thirst's "who did not hunt" sees it.
    expect(minion(state, "V1").huntedThisPhase).toBe(true);
  });

  it("your own Ravnos: undirected, so prey and predator may block", () => {
    const state = nightmareTable();
    state.seats[0]!.minions.push(makeMinion("V2", "Alice", { clan: "Ravnos" }));
    const engine = new VtesEngine(state, testRegistry);
    expect(minion(state, "V1").huntedThisPhase).toBeFalsy();
    runTrace(engine, [["Alice", `${STEAL}:V1:V2`]]);
    const af = action(state)!;
    expect(af.directed).toBe(false);
    expect(af.target).toBeNull();
    expect([...blockEligibleSeats(state, af)].sort()).toEqual(["Bob", "Carol"]);
  });
});
