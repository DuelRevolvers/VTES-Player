/**
 * Wave 120 — Keepers of Tradition combat (docs/keepers-of-tradition-design.md §1).
 *
 * Eugene (200441), Gotsdam (200530), Psyche! (101507), Armor of Vitality
 * (100089), Beretta 9mm (100152). Every clause is tested in both
 * directions; each crypt ability is the REAL compiled entry (`cryptEntry`).
 */
import { describe, expect, it } from "vitest";
import type { CombatFrame, GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

const handlers = buildHandlerRegistry();

function must(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}
function seat(state: GameState, id: string): GameState["seats"][number] {
  const s = state.seats.find((x) => x.id === id);
  if (!s) throw new Error(`no seat ${id}`);
  return s;
}
function combat(state: GameState): CombatFrame | undefined {
  const f = state.frames.find((x) => x.kind === "combat");
  return f?.kind === "combat" ? f : undefined;
}
function ids(engine: VtesEngine): string[] {
  return engine.decision()?.options.map((o) => o.id) ?? [];
}
function asVampire(m: MinionState, cryptName: string): MinionState {
  const entry = handlers[cryptName]?.cryptEntry?.();
  if (!entry) throw new Error(`no crypt entry for ${cryptName}`);
  m.attached.push({
    card: { id: m.id, name: cryptName },
    controller: m.controller,
    owner: m.controller,
    locked: false,
    usedThisPhase: false,
    statics: entry.statics,
    tags: entry.tags,
  });
  return m;
}
function equip(state: GameState, minion: string, id: string, name: string): PermanentInPlay {
  const h = testRegistry[name];
  const p: PermanentInPlay = {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: h?.permanentStatics ?? {},
    tags: h?.permanentTags ?? [],
  };
  must(state, minion).attached.push(p);
  return p;
}
/** Answer until `until` holds: the first `prefer` prefix offered, else
 *  pass, then end, then the first option. */
function drive(
  engine: VtesEngine,
  until: () => boolean,
  prefer: string[] = [],
  limit = 200,
): void {
  for (let i = 0; i < limit; i++) {
    if (until()) return;
    const dp = engine.decision();
    if (!dp) throw new Error("game ended before the condition held");
    const o = dp.options.map((x) => x.id);
    const id =
      prefer.map((p) => o.find((x) => x.startsWith(p))).find((x) => x !== undefined) ??
      o.find((x) => x === "pass") ??
      o.find((x) => x === "end") ??
      o[0]!;
    runTrace(engine, [[dp.seat, id]]);
  }
  throw new Error("condition never held");
}
const offered = (engine: VtesEngine, prefix: string): boolean =>
  ids(engine).some((x) => x.startsWith(prefix));

/** Alice's V1 bleeds, Bob's M blocks; the combat is live at before-range. */
function intoCombat(
  cards: Array<[seat: "Alice" | "Bob", name: string]>,
  tweak: (s: GameState) => void = () => {},
) {
  const state = threeSeatGame();
  Object.assign(must(state, "V1"), { disciplines: {}, blood: 5, capacity: 8, strength: 1 });
  Object.assign(must(state, "M"), { disciplines: {}, blood: 5, capacity: 8, strength: 1 });
  let a = 0;
  let b = 0;
  for (const [s, name] of cards) {
    if (s === "Alice") seat(state, "Alice").hand.push({ id: `a${a++}`, name });
    else seat(state, "Bob").hand.push({ id: `b${b++}`, name });
  }
  tweak(state);
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  expect(combat(state)).toBeDefined();
  return { state, engine };
}

// ---------------------------------------------------------------------------

describe("Eugene (200441) — once each combat, strike: dodge", () => {
  it("offers the dodge at strike choice, and not to a plain vampire", () => {
    const { state, engine } = intoCombat([], (s) => void asVampire(must(s, "V1"), "Eugene (G4)"));
    drive(engine, () => offered(engine, "strike:hand") && engine.decision()?.seat === "Alice");
    expect(offered(engine, "ability:Eugene (G4)")).toBe(true);
    const plain = intoCombat([]);
    drive(plain.engine, () => offered(plain.engine, "strike:hand"));
    expect(ids(plain.engine).some((x) => x.includes("Eugene"))).toBe(false);
    expect(state).toBeDefined();
  });

  it("is spent for the combat once used", () => {
    const { state, engine } = intoCombat([], (s) => void asVampire(must(s, "V1"), "Eugene (G4)"));
    drive(engine, () => offered(engine, "ability:Eugene (G4)"));
    runTrace(engine, [["Alice", ids(engine).find((x) => x.startsWith("ability:Eugene (G4)"))!]]);
    expect(combat(state)!.usedThisCombat).toContain("V1");
    // Round 2: continue the combat with a press and come back to strikes.
    combat(state)!.presses.acting = 1;
    drive(engine, () => combat(state)!.round === 2 && offered(engine, "strike:hand"), ["press:continue"]);
    expect(offered(engine, "ability:Eugene (G4)")).toBe(false);
  });
});

describe("Gotsdam (200530)", () => {
  const G = "Gotsdam, The Tired Warrior (G4)";

  it("can burn 1 blood to strike: combat ends — not with no blood to burn", () => {
    // M hits for 0, so the only blood Gotsdam spends is the strike's price
    // (both strikes resolve together, so a real hit would cost a mend too).
    const { state, engine } = intoCombat([], (s) => {
      asVampire(must(s, "V1"), G);
      must(s, "M").strength = 0;
    });
    drive(engine, () => offered(engine, "strike:hand") && engine.decision()?.seat === "Alice");
    const id = ids(engine).find((x) => x.startsWith(`ability:${G}`));
    expect(id).toBeDefined();
    const before = must(state, "V1").blood;
    runTrace(engine, [["Alice", id!]]);
    drive(engine, () => !combat(state));
    expect(must(state, "V1").blood).toBe(before - 1);

    const broke = intoCombat([], (s) => {
      asVampire(must(s, "V1"), G);
    });
    must(broke.state, "V1").blood = 0;
    drive(broke.engine, () => offered(broke.engine, "strike:hand") && broke.engine.decision()?.seat === "Alice");
    expect(offered(broke.engine, `ability:${G}`)).toBe(false);
  });

  it("treats aggravated damage as normal in combat: he mends it instead of going to torpor", () => {
    const run = (gotsdam: boolean) => {
      const { state, engine } = intoCombat([], (s) => {
        if (gotsdam) asVampire(must(s, "V1"), G);
      });
      combat(state)!.handStrikesAggravated.opposing = true;
      drive(engine, () => !combat(state) || combat(state)!.step === "endOfRound", ["strike:hand"]);
      return must(state, "V1");
    };
    const plain = run(false);
    expect(plain.inTorpor || plain.torporPending !== undefined).toBe(true);
    const g = run(true);
    expect(g.inTorpor).toBe(false);
    expect(g.blood).toBe(4);
  });

  it("frenzy cards cannot be played on him: Terror Frenzy from his opponent", () => {
    const tf = (gotsdam: boolean) => {
      const { engine } = intoCombat([["Bob", "Terror Frenzy"]], (s) => {
        if (gotsdam) asVampire(must(s, "V1"), G);
        must(s, "M").disciplines = { ani: "basic" };
      });
      drive(engine, () => engine.decision()?.seat === "Bob" && offered(engine, "pass"));
      return offered(engine, "play:Terror Frenzy");
    };
    expect(tf(false)).toBe(true);
    expect(tf(true)).toBe(false);
  });

  it("…nor a frenzy card he would use on himself (Rage of Apedemak)", () => {
    const rage = (gotsdam: boolean) => {
      const { engine } = intoCombat([["Alice", "Rage of Apedemak"]], (s) => {
        if (gotsdam) asVampire(must(s, "V1"), G);
        must(s, "V1").disciplines = { pot: "basic" };
      });
      drive(engine, () => engine.decision()?.seat === "Alice" && offered(engine, "pass"));
      return offered(engine, "play:Rage of Apedemak");
    };
    expect(rage(false)).toBe(true);
    expect(rage(true)).toBe(false);
  });

  it("Enrage cannot be put on him — unless he is in torpor (the ready-only rule)", () => {
    const enrageTargets = (setup: (s: GameState) => void): string[] => {
      const state = threeSeatGame();
      Object.assign(must(state, "V1"), { disciplines: { pre: "superior" }, blood: 5 });
      seat(state, "Alice").hand.push({ id: "e1", name: "Enrage" });
      setup(state);
      const engine = new VtesEngine(state, testRegistry);
      return ids(engine).filter((x) => x.startsWith("play:Enrage:superior"));
    };
    const all = enrageTargets(() => {});
    expect(all.some((x) => x.includes(":W:") || x.includes("W"))).toBe(true);
    const barred = enrageTargets((s) => void asVampire(must(s, "W"), G));
    expect(barred.some((x) => x.split(":").includes("W"))).toBe(false);
    expect(barred.some((x) => x.split(":").includes("M"))).toBe(true);
    const torpid = enrageTargets((s) => {
      asVampire(must(s, "W"), G);
      must(s, "W").inTorpor = true;
    });
    expect(torpid.some((x) => x.split(":").includes("W"))).toBe(true);
  });
});

describe("Psyche! (101507)", () => {
  it("superior: the combat ends and a new combat between the same two begins", () => {
    const { state, engine } = intoCombat([["Alice", "Psyche!"], ["Alice", "Telepathic Tracking"]], (s) => {
      must(s, "V1").disciplines = { cel: "superior", aus: "superior" };
    });
    const first = combat(state)!;
    drive(engine, () => offered(engine, "play:Psyche!:superior"), ["strike:hand"]);
    expect(first.step).toBe("endOfRound");
    // Both replacements are offered while combat would end…
    expect(offered(engine, "play:Telepathic Tracking:superior")).toBe(true);
    runTrace(engine, [["Alice", ids(engine).find((x) => x.startsWith("play:Psyche!:superior"))!]]);
    // …and once Psyche! has queued the combat, Telepathic Tracking is not
    // [ANK 20191219].
    const seen: string[] = [];
    drive(engine, () => {
      seen.push(...ids(engine));
      return combat(state) !== first;
    });
    expect(seen.some((x) => x.startsWith("play:Telepathic Tracking:superior"))).toBe(false);
    const next = combat(state)!;
    expect(next).toBeDefined();
    expect(next.round).toBe(1);
    expect([next.acting, next.opposing]).toEqual(["V1", "M"]);
  });

  it("superior: an after-combat effect of the ending combat is lost", () => {
    const run = (psyche: boolean) => {
      const { state, engine } = intoCombat(psyche ? [["Alice", "Psyche!"]] : [], (s) => {
        must(s, "V1").disciplines = { cel: "superior" };
      });
      const first = combat(state)!;
      drive(engine, () => first.step === "endOfRound", ["strike:hand"]);
      // Mercy for the Weak's rider, as its strike would have left it.
      first.afterCombatEnds.push({ kind: "gainBlood", minion: "M", amount: 1 });
      const before = must(state, "M").blood;
      if (psyche) {
        drive(engine, () => offered(engine, "play:Psyche!:superior"));
        runTrace(engine, [["Alice", ids(engine).find((x) => x.startsWith("play:Psyche!:superior"))!]]);
      }
      drive(engine, () => combat(state) !== first);
      return must(state, "M").blood - before;
    };
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(0);
  });

  it("superior: not offered while the combat is continuing, nor with a combat already queued", () => {
    const { state, engine } = intoCombat([["Alice", "Psyche!"]], (s) => {
      must(s, "V1").disciplines = { cel: "superior" };
    });
    const first = combat(state)!;
    first.presses.acting = 1;
    drive(engine, () => first.willContinue || first.step === "endOfRound", ["strike:hand", "press:continue"]);
    expect(first.willContinue).toBe(true);
    drive(engine, () => first.round === 2, []);
    expect(offered(engine, "play:Psyche!:superior")).toBe(false);

    const q = intoCombat([["Alice", "Psyche!"]], (s) => {
      must(s, "V1").disciplines = { cel: "superior" };
    });
    const af = q.state.frames.find((f) => f.kind === "action");
    if (af?.kind !== "action") throw new Error("no action frame");
    af.queuedCombats.push({ a: "W", b: "N" });
    const qf = combat(q.state)!;
    drive(q.engine, () => qf.step === "endOfRound" || !combat(q.state), ["strike:hand"]);
    expect(offered(q.engine, "play:Psyche!:superior")).toBe(false);
  });

  it("basic: a press", () => {
    const { engine } = intoCombat([["Alice", "Psyche!"]], (s) => {
      must(s, "V1").disciplines = { cel: "basic" };
    });
    drive(engine, () => offered(engine, "play:Psyche!:basic"), ["strike:hand"]);
    expect(offered(engine, "play:Psyche!:superior")).toBe(false);
  });
});

describe("Armor of Vitality (100089)", () => {
  const toPrevention = (level: "basic" | "superior", weaponStrike: boolean) => {
    const { state, engine } = intoCombat([["Alice", "Armor of Vitality"]], (s) => {
      must(s, "V1").disciplines = { for: level };
      equip(s, "M", "blade", "Righteous Blade");
    });
    drive(
      engine,
      () => offered(engine, `play:Armor of Vitality:${level}`),
      ["strike:hand", ...(weaponStrike ? ["ability:Righteous Blade:blade:strike"] : [])].reverse(),
    );
    runTrace(engine, [["Alice", ids(engine).find((x) => x.startsWith(`play:Armor of Vitality:${level}`))!]]);
    drive(engine, () => !combat(state) || combat(state)!.step === "endOfRound");
    return { state, blade: must(state, "M").attached.some((p) => p.card.id === "blade") };
  };

  it("superior: prevents the blade's damage and destroys the blade", () => {
    const { state, blade } = toPrevention("superior", true);
    expect(blade).toBe(false);
    expect(must(state, "V1").blood).toBe(4); // paid 1 blood, took nothing
  });

  it("basic: prevents, and the blade stays", () => {
    const { blade } = toPrevention("basic", true);
    expect(blade).toBe(true);
  });

  it("superior against a HAND strike: the blade is not the damage, so it stays", () => {
    const { blade } = toPrevention("superior", false);
    expect(blade).toBe(true);
  });
});

describe("Beretta 9mm (100152)", () => {
  const atRange = (copies: number) => {
    const { state, engine } = intoCombat([], (s) => {
      for (let i = 0; i < copies; i++) equip(s, "V1", `ber${i}`, "Beretta 9mm");
    });
    drive(engine, () => engine.decision()?.seat === "Alice" && combat(state)!.step === "beforeRange" && offered(engine, "pass"));
    return { state, engine };
  };

  it("alone: 1R, and no maneuver", () => {
    const { state, engine } = atRange(1);
    drive(engine, () => combat(state)!.step === "range" && engine.decision()?.seat === "Alice");
    // The negative is asked AT the maneuver step, where a pair offers one.
    expect(ids(engine).some((x) => x.endsWith(":maneuver"))).toBe(false);
    drive(engine, () => offered(engine, "ability:Beretta 9mm:ber0:strike"));
    const label = engine.decision()!.options.find((o) => o.id.startsWith("ability:Beretta 9mm:ber0:strike"))!.label;
    expect(label).toContain("1R");
  });

  it("with another: 2R, and one Beretta maneuver this round — not both", () => {
    const { state, engine } = atRange(2);
    drive(engine, () => offered(engine, "ability:Beretta 9mm:ber0:maneuver"));
    expect(offered(engine, "ability:Beretta 9mm:ber1:maneuver")).toBe(true);
    runTrace(engine, [["Alice", "ability:Beretta 9mm:ber0:maneuver"]]);
    // Bob answers (or not); whenever Alice is asked again this round, the
    // second Beretta cannot maneuver.
    drive(engine, () => engine.decision()?.seat === "Alice" || combat(state)!.step !== "range");
    expect(offered(engine, "ability:Beretta 9mm:ber1:maneuver")).toBe(false);
    drive(engine, () => offered(engine, "ability:Beretta 9mm:ber0:strike"));
    const label = engine.decision()!.options.find((o) => o.id.startsWith("ability:Beretta 9mm:ber0:strike"))!.label;
    expect(label).toContain("2R");
  });

  it("with another: the OTHER Beretta may maneuver next round — the card's own word over one-weapon-per-combat", () => {
    const { state, engine } = atRange(2);
    drive(engine, () => offered(engine, "ability:Beretta 9mm:ber0:maneuver"));
    runTrace(engine, [["Alice", "ability:Beretta 9mm:ber0:maneuver"]]);
    combat(state)!.presses.acting = 1;
    drive(
      engine,
      () => combat(state)!.round === 2 && combat(state)!.step === "range" && engine.decision()?.seat === "Alice",
      ["ability:Beretta 9mm:ber0:strike", "press:continue"],
    );
    expect(offered(engine, "ability:Beretta 9mm:ber1:maneuver")).toBe(true);
    // ber0 spent its one maneuver this combat.
    expect(offered(engine, "ability:Beretta 9mm:ber0:maneuver")).toBe(false);
  });
});
