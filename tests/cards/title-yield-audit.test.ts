import { describe, expect, it } from "vitest";
import { titleContestKey, VtesEngine } from "../../src/engine/index.ts";
import type { GameState, MinionState } from "../../src/engine/index.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function attach(m: MinionState, name: string) {
  const self = testRegistry[name]!.cryptEntry!();
  m.attached.push({ card: { id: `self-${m.id}`, name }, locked: false, usedThisPhase: false, statics: self.statics, tags: self.tags });
}
function unlockPhase(state: GameState, seat: string) {
  const tf = state.frames[0]!;
  if (tf.kind !== "turn") throw new Error("no turn");
  tf.seat = seat; tf.phase = "unlock"; tf.unlockDone = false; tf.edgeDone = false;
  tf.unlockAbilitiesDone = false; tf.unlockOthersDone = [];
  delete tf.contestsDone; delete tf.contestsHandled;
}
function setup(name: string, clan: string) {
  const state = threeSeatGame();
  const boss = state.seats[0]!.minions[0]!;
  const rival = state.seats[1]!.minions[0]!;
  boss.clan = clan; rival.clan = clan;
  boss.title = "innerCircle"; rival.title = "innerCircle";
  attach(boss, name);
  const engine = new VtesEngine(state, testRegistry);
  engine.decision(); // settle the contest
  return { state, boss, rival };
}

describe.each([
  ["Hardestadt (G4)", "Ventrue"], ["Rafael de Corazon (G4)", "Toreador"],
])("%s forces title yield", (name, clan) => {
  it("forces the rival to yield without a pay option, including while in torpor", () => {
    const { state, boss, rival } = setup(name, clan);
    expect(boss.titleContest?.title).toBe("innerCircle");
    expect(rival.titleContest?.title).toBe("innerCircle");
    boss.inTorpor = true;
    const blood = rival.blood;
    unlockPhase(state, "Bob");
    const engine = new VtesEngine(state, testRegistry);
    const decision = engine.decision();
    expect(rival.titleContest).toBeUndefined();
    expect(rival.title).toBeNull();
    expect(rival.blood).toBe(blood);
    expect(decision?.options.some(o => o.id.includes(":pay"))).toBe(false);
    expect(state.eventLog.some(e => e.type === "TitleYielded" && e.minion === rival.id)).toBe(true);
    expect(boss.titleContest?.title).toBe("innerCircle");
  });
  it("does not force himself to yield and can pay to contest normally", () => {
    const { state, boss } = setup(name, clan);
    unlockPhase(state, "Alice");
    const engine = new VtesEngine(state, testRegistry);
    const pay = engine.decision()!.options.find(o => o.id.includes(":pay"));
    expect(pay).toBeDefined();
    engine.choose(pay!.id);
    expect(boss.titleContest?.title).toBe("innerCircle");
  });
  it("works for a newly acquired city title and preserves it on recovery", () => {
    const { state, boss, rival } = setup(name, clan);
    delete boss.titleContest; delete rival.titleContest;
    boss.title = "prince"; boss.titleCity = "Chicago";
    rival.title = "archbishop"; rival.titleCity = "Chicago";
    new VtesEngine(state, testRegistry).decision();
    unlockPhase(state, "Bob");
    new VtesEngine(state, testRegistry).decision();
    expect(rival.titleContest).toBeUndefined();
    unlockPhase(state, "Alice");
    new VtesEngine(state, testRegistry).decision();
    expect(boss.title).toBe("prince");
    expect(boss.titleCity).toBe("Chicago");
    expect(titleContestKey(boss)).toBe("city:chicago");
  });
  it("does not affect contests for a different title", () => {
    const { state, boss, rival } = setup(name, clan);
    delete boss.titleContest;
    boss.title = "prince"; boss.titleCity = "Berlin";
    const other = state.seats[2]!.minions[0]!;
    other.clan = clan; other.title = "innerCircle";
    new VtesEngine(state, testRegistry).decision();
    unlockPhase(state, "Bob");
    const dp = new VtesEngine(state, testRegistry).decision();
    expect(rival.titleContest).toBeDefined();
    expect(dp!.options.some(o => o.id.includes(":pay"))).toBe(true);
  });
});
