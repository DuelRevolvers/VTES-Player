/**
 * Lilith's Blessing (101108): a master phase action that locks the card to
 * search the library for a Discipline master and put it on a ready non-Bahari
 * vampire with no blood, which then gains 3 blood and becomes Bahari.
 */
import { describe, expect, it } from "vitest";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  for (const s of state.seats) {
    const m = s.minions.find((x) => x.id === id);
    if (m) return m;
  }
  throw new Error(`no minion ${id}`);
}

const BLESS = "ability:Lilith's Blessing:lb:bless:V1";

/** Alice's game with Lilith's Blessing in play, V1 at no blood, and a Potence in her library. */
function setup(opts: { clan?: string } = {}) {
  const state = threeSeatGame();
  const v1 = find(state, "V1");
  if (opts.clan !== undefined) v1.clan = opts.clan;
  state.seats[0]!.permanents.push({
    card: { id: "lb", name: "Lilith's Blessing" },
    controller: "Alice",
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [],
  } as never);
  state.seats[0]!.library.push({ id: "pot", name: "Potence" });
  return { state, engine: new VtesEngine(state, testRegistry) };
}

/**
 * Pass or end through Alice's turn until she is in her master phase, then set
 * V1's blood. A turn's earlier windows move blood on V1 (it reads 1 by the
 * master phase), so the condition is set where the card reads it.
 */
function intoAliceMaster(engine: VtesEngine, blood = 0): void {
  for (let i = 0; i < 40; i++) {
    const dp = engine.decision();
    if (!dp) return;
    if (dp.window === "turn.master" && dp.seat === "Alice") {
      for (const s of engine.state.seats) for (const m of s.minions) if (m.id === "V1") m.blood = blood;
      return;
    }
    const opt = dp.options.find((o) => o.id === "end") ?? dp.options.find((o) => o.id === "pass") ?? dp.options[0]!;
    runTrace(engine, [[dp.seat, opt.id]]);
  }
}

function masterOptions(engine: VtesEngine): string[] {
  const dp = engine.decision();
  return dp?.window === "turn.master" && dp.seat === "Alice" ? dp.options.map((o) => o.id) : [];
}

describe("Lilith's Blessing (101108)", () => {
  it("offers the master phase action for a ready vampire with no blood", () => {
    const { engine } = setup();
    intoAliceMaster(engine);
    expect(masterOptions(engine)).toContain(BLESS);
  });

  it("the search puts a Discipline master on the vampire, gives 3 blood, and makes it Bahari; the card locks", () => {
    const { state, engine } = setup();
    intoAliceMaster(engine);
    engine.choose(BLESS);
    engine.choose("choice:Lilith's Blessing:lb:blessing:pot");
    const v1 = find(state, "V1");
    expect(v1.attached.some((p) => p.card.name === "Potence")).toBe(true);
    expect(v1.blood).toBe(3);
    expect(v1.clan).toBe("Bahari");
    expect(state.seats[0]!.permanents.find((p) => p.card.id === "lb")?.locked).toBe(true);
    // The Discipline card came out of the library.
    expect(state.seats[0]!.library.some((c) => c.name === "Potence")).toBe(false);
  });

  it("'if any': finding nothing still gives 3 blood and the clan", () => {
    const { state, engine } = setup();
    intoAliceMaster(engine);
    engine.choose(BLESS);
    engine.choose("choice:Lilith's Blessing:lb:blessing:none");
    const v1 = find(state, "V1");
    expect(v1.attached.some((p) => p.card.name === "Potence")).toBe(false);
    expect(v1.blood).toBe(3);
    expect(v1.clan).toBe("Bahari");
  });

  it("NEGATIVE SPACE: a vampire with blood is not offered", () => {
    const { engine } = setup();
    intoAliceMaster(engine, 2);
    expect(masterOptions(engine).some((id) => id.startsWith("ability:Lilith's Blessing"))).toBe(false);
  });

  it("NEGATIVE SPACE: a vampire already Bahari is not offered", () => {
    const { engine } = setup({ clan: "Bahari" });
    intoAliceMaster(engine);
    expect(masterOptions(engine).some((id) => id.startsWith("ability:Lilith's Blessing"))).toBe(false);
  });

  it("NEGATIVE SPACE: a locked card is not offered", () => {
    const { state, engine } = setup();
    intoAliceMaster(engine);
    expect(masterOptions(engine)).toContain(BLESS);
    // The card is locked in this master phase (it unlocks again only in
    // the unlock phase), and the offer is re-read.
    const lb = state.seats[0]!.permanents.find((p) => p.card.id === "lb")!;
    lb.locked = true;
    expect(masterOptions(engine).some((id) => id.startsWith("ability:Lilith's Blessing"))).toBe(false);
  });
});
