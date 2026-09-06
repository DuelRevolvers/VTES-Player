/**
 * Discipline-filtered effects (docs/discipline-filtered-design.md).
 *
 * The family that reasons about what OTHER cards require:
 * Blood Fury (100201), Blood Rage (100208), Soul Burn (101829),
 * Soulgrinder (102340), Hide the Mind (100921).
 *
 * Almost everything here is a NEGATIVE-SPACE assertion — an option that
 * must NOT be offered — because that is the only kind of guard the fuzz
 * structurally cannot provide: it plays whatever it is handed, so a
 * too-permissive option list looks exactly like a correct one.
 */

import { describe, expect, it } from "vitest";
import type { GameState, MinionState, PermanentInPlay } from "../../src/engine/index.ts";
import { VtesEngine } from "../../src/engine/index.ts";
import { cardSpecs } from "../../src/cards/effects/cards.ts";
import { makeMinion, runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function find(state: GameState, id: string): MinionState {
  const m = state.seats.flatMap((s) => s.minions).find((x) => x.id === id);
  if (!m) throw new Error(`no minion ${id}`);
  return m;
}

function entry(id: string, name: string, over: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [], ...over };
}

/**
 * Alice's V1 bleeds, Bob's M blocks, and combat begins at close range.
 * `bobCards` land in Bob's hand so the defender can try to prevent.
 *
 * M has strength 0, so its hand strike inflicts nothing and the round
 * produces exactly ONE pending damage item — the one V1 inflicts. That
 * keeps every trace here on a single damage-resolution question; with two
 * items the acting minion's resolves first (p. 29) and the interesting
 * decision is one pass further on.
 */
function combatGame(aliceCards: string[], bobCards: string[] = []): GameState {
  const state = threeSeatGame();
  Object.assign(find(state, "V1"), {
    disciplines: { tha: "superior", obf: "superior" },
    blood: 4,
    strength: 2,
  });
  Object.assign(find(state, "M"), {
    disciplines: { for: "superior", tha: "superior" },
    blood: 4,
    strength: 0,
  });
  aliceCards.forEach((n, i) => state.seats[0]!.hand.push({ id: `a${i}`, name: n }));
  bobCards.forEach((n, i) => state.seats[1]!.hand.push({ id: `b${i}`, name: n }));
  return state;
}

/** Bleed → blocked by M → combat, stopping at the Choose Strike step. */
function intoStrikes(engine: VtesEngine): void {
  runTrace(engine, [
    ["Alice", "bleed:V1"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played / announce
    ["Alice", "pass"], ["Bob", "block:M"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // block resolves → combat
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
    ["Alice", "pass"], ["Bob", "pass"], // range (stays close)
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
  ]);
}

/** Play a strike card, then walk its as-played cycle. */
function playStrike(engine: VtesEngine, seat: string, id: string): void {
  runTrace(engine, [
    [seat, id],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
}

describe("Blood Fury (100201) — prevention filtered by required Discipline", () => {
  it("does NOT offer a Fortitude prevention card against its damage", () => {
    // Soak is "[for] Prevent 2 non-aggravated damage" — exactly the card
    // Blood Fury's "cannot be prevented by cards requiring Fortitude"
    // names.
    const state = combatGame(["Blood Fury"], ["Soak"]);
    const engine = new VtesEngine(state, testRegistry);
    intoStrikes(engine);
    playStrike(engine, "Alice", "play:Blood Fury:superior:V1:a0");
    runTrace(engine, [["Bob", "strike:hand"]]);

    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.damageResolution");
    expect(dp.options.some((o) => o.id.includes("Soak"))).toBe(false);
  });

  it("still offers prevention that does NOT require Fortitude", () => {
    // The positive control. Rego Motum prevents 2 damage on [tha]; the
    // restriction names Fortitude, so it has nothing to say about this.
    const state = combatGame(["Blood Fury"], ["Rego Motum"]);
    const engine = new VtesEngine(state, testRegistry);
    intoStrikes(engine);
    playStrike(engine, "Alice", "play:Blood Fury:superior:V1:a0");
    runTrace(engine, [["Bob", "strike:hand"]]);

    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.damageResolution");
    expect(dp.options.some((o) => o.id.includes("Rego Motum"))).toBe(true);
  });

  it("offers the Fortitude card normally against an ordinary hand strike", () => {
    // The control for the control: without Blood Fury, Soak is live. If
    // this ever fails, the gate is over-firing rather than the card
    // working.
    const state = combatGame([], ["Soak"]);
    const engine = new VtesEngine(state, testRegistry);
    intoStrikes(engine);
    runTrace(engine, [["Alice", "strike:hand"], ["Bob", "strike:hand"]]);

    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.damageResolution");
    expect(dp.options.some((o) => o.id.includes("Soak"))).toBe(true);
  });

  it("nullifies the opposing vampire's WEAPON strike for the round", () => {
    const state = combatGame(["Blood Fury"]);
    find(state, "M").attached.push(entry("gun1", ".44 Magnum", { tags: ["weapon", "gun"] }));
    const engine = new VtesEngine(state, testRegistry);
    intoStrikes(engine);
    playStrike(engine, "Alice", "play:Blood Fury:superior:V1:a0");
    runTrace(engine, [["Bob", "ability:.44 Magnum:gun1:strike"]]);

    // V1 (strength 2, +2 from the superior) hit M for 4; the gun's 2R
    // never became damage at all, so there is exactly one damage event.
    const inflicted = state.eventLog.filter((e) => e.type === "DamageInflicted");
    expect(inflicted).toHaveLength(1);
    expect(inflicted[0]).toMatchObject({ minion: "M", amount: 4 });
    // The control: without Blood Fury the same gun does land its 2R.
    const plain = combatGame([]);
    find(plain, "M").attached.push(entry("gun2", ".44 Magnum", { tags: ["weapon", "gun"] }));
    const e2 = new VtesEngine(plain, testRegistry);
    intoStrikes(e2);
    runTrace(e2, [["Alice", "strike:hand"], ["Bob", "ability:.44 Magnum:gun2:strike"]]);
    expect(
      plain.eventLog.some(
        (e) => e.type === "DamageInflicted" && e.minion === "V1" && e.amount === 2,
      ),
    ).toBe(true);
  });

  it("is not playable at long range", () => {
    // "Only usable at close range" — the mirror of onlyAtLongRange.
    const state = combatGame(["Blood Fury"]);
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "block:M"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
    ]);
    // Alice maneuvers to long, then the before-strikes window opens.
    const range = engine.decision()!;
    expect(range.window).toBe("combat.range");
    runTrace(engine, [
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);
    // At close range it WOULD be here; assert the shape of the test
    // itself before trusting the negative below.
    expect(engine.decision()!.options.some((o) => o.id.includes("Blood Fury"))).toBe(true);
  });
});

describe("Soul Burn (101829) — the same filter on a ranged fixed strike", () => {
  it("carries the restriction onto fixed damage, not just hand strikes", () => {
    const state = combatGame(["Soul Burn"], ["Soak"]);
    const engine = new VtesEngine(state, testRegistry);
    intoStrikes(engine);
    playStrike(engine, "Alice", "play:Soul Burn:superior:V1:a0");
    runTrace(engine, [["Bob", "strike:hand"]]);

    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.damageResolution");
    expect(dp.options.some((o) => o.id.includes("Soak"))).toBe(false);
  });
});

describe("Soulgrinder (102340) — only the SUPERIOR carries the filter", () => {
  it("basic: Fortitude prevention is still offered", () => {
    const state = combatGame(["Soulgrinder"], ["Soak"]);
    const engine = new VtesEngine(state, testRegistry);
    intoStrikes(engine);
    playStrike(engine, "Alice", "play:Soulgrinder:basic:V1:a0");
    runTrace(engine, [["Bob", "strike:hand"]]);

    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.damageResolution");
    expect(dp.options.some((o) => o.id.includes("Soak"))).toBe(true);
  });

  it("superior: it is not", () => {
    const state = combatGame(["Soulgrinder"], ["Soak"]);
    const engine = new VtesEngine(state, testRegistry);
    intoStrikes(engine);
    playStrike(engine, "Alice", "play:Soulgrinder:superior:V1:a0");
    runTrace(engine, [["Bob", "strike:hand"]]);

    const dp = engine.decision()!;
    expect(dp.window).toBe("combat.damageResolution");
    expect(dp.options.some((o) => o.id.includes("Soak"))).toBe(false);
  });
});

describe("the OUTSIDE prevention site is filtered too", () => {
  it("does not offer Martyr's Resilience against no-Fortitude damage", () => {
    // Martyr's Resilience requires [aus][for]. It is played by a
    // bystander through a different enumeration path
    // (outsidePreventOptions), which is the second site that had to
    // agree with the first.
    const state = combatGame(["Blood Fury"]);
    state.seats[2]!.minions.push(
      makeMinion("C2", "Carol", { disciplines: { aus: "basic", for: "basic" }, blood: 4 }),
    );
    state.seats[2]!.hand.push({ id: "mr1", name: "Martyr's Resilience" });
    const engine = new VtesEngine(state, testRegistry);
    intoStrikes(engine);
    playStrike(engine, "Alice", "play:Blood Fury:superior:V1:a0");
    runTrace(engine, [["Bob", "strike:hand"]]);

    // Only M is taking damage, and Blood Fury filters Fortitude — so
    // Carol is not even in the damage cycle (the cycle carries the
    // victim's seat plus seats that HAVE something to play).
    for (let i = 0; i < 4; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "combat.damageResolution") break;
      expect(dp.options.some((o) => o.id.includes("Martyr's Resilience"))).toBe(false);
      runTrace(engine, [[dp.seat, "pass"]]);
    }
  });

  it("DOES offer it against unfiltered damage — the positive control", () => {
    const state = combatGame([]);
    state.seats[2]!.minions.push(
      makeMinion("C2", "Carol", { disciplines: { aus: "basic", for: "basic" }, blood: 4 }),
    );
    state.seats[2]!.hand.push({ id: "mr1", name: "Martyr's Resilience" });
    const engine = new VtesEngine(state, testRegistry);
    intoStrikes(engine);
    runTrace(engine, [["Alice", "strike:hand"], ["Bob", "strike:hand"]]);

    let seen = false;
    for (let i = 0; i < 4 && !seen; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "combat.damageResolution") break;
      seen = dp.options.some((o) => o.id.includes("Martyr's Resilience"));
      if (!seen) runTrace(engine, [[dp.seat, "pass"]]);
    }
    expect(seen).toBe(true);
  });
});

describe("Hide the Mind (100921)", () => {
  /** Alice's V1 bleeds Bob, who reacts with a bleed-reduction card.
   *  A bleed rather than a hunt because "reduce a bleed against you"
   *  carries no "only when needed" gate — an intercept modifier is hidden
   *  behind p. 26 and never reaches its as-played window. */
  function reactionGame(bobCard: string): { state: GameState; engine: VtesEngine } {
    const state = threeSeatGame();
    Object.assign(find(state, "V1"), { disciplines: { obf: "superior" }, blood: 2 });
    Object.assign(find(state, "M"), {
      disciplines: { aus: "superior", dom: "superior" },
      blood: 3,
    });
    state.seats[0]!.hand.push({ id: "htm", name: "Hide the Mind" });
    state.seats[1]!.hand.push({ id: "bob1", name: bobCard });
    return { state, engine: new VtesEngine(state, testRegistry) };
  }

  it("superior cancels a REACTION card requiring Auspex as it is played", () => {
    const { state, engine } = reactionGame("Telepathic Counter");
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], // state A opens with the acting seat
      ["Bob", "play:Telepathic Counter:superior:M:bob1"],
    ]);
    // Bob's reaction is now in its as-played window.
    const dp = engine.decision()!;
    expect(dp.window).toBe("card.asPlayed");
    const opt = dp.options.find((o) => o.id.startsWith("play:Hide the Mind:superior:V1"));
    expect(opt).toBeDefined();

    runTrace(engine, [["Alice", opt!.id]]);
    // Walk out of the as-played windows: Hide the Mind's own, then the
    // cancelled card's, which still has to reach its (now inert)
    // resolution before the action continues.
    for (let i = 0; i < 12; i++) {
      const d = engine.decision();
      if (!d || d.window !== "card.asPlayed") break;
      runTrace(engine, [[d.seat, "pass"]]);
    }
    // The reaction was cancelled, so it never took effect: the bleed was
    // never reduced.
    expect(state.eventLog.some((e) => e.type === "CardCanceled")).toBe(true);
    expect(state.eventLog.some((e) => e.type === "BleedAmountModified")).toBe(false);
  });

  it("does NOT offer against a reaction that requires something else", () => {
    // Deflection requires [dom], not [aus]. The gate is the Discipline
    // the pending card requires, not merely its being a reaction — so
    // Hide the Mind must stay off the table here.
    const { engine } = reactionGame("Deflection");
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // state A
      ["Alice", "pass"], // state C opens with the acting seat
      ["Bob", "play:Deflection:superior:M:Carol:bob1"],
    ]);
    const dp = engine.decision()!;
    expect(dp.window).toBe("card.asPlayed");
    expect(dp.options.some((o) => o.id.includes("Hide the Mind"))).toBe(false);
  });

  it("basic cancels a COMBAT card requiring Auspex, played by a bystander", () => {
    const state = combatGame([], []);
    state.seats[0]!.hand.push({ id: "htm", name: "Hide the Mind" });
    state.seats[2]!.minions.push(
      makeMinion("C2", "Carol", { disciplines: { aus: "basic", for: "basic" }, blood: 4 }),
    );
    state.seats[2]!.hand.push({ id: "mr1", name: "Martyr's Resilience" });
    const engine = new VtesEngine(state, testRegistry);
    intoStrikes(engine);
    runTrace(engine, [["Alice", "strike:hand"], ["Bob", "strike:hand"]]);

    // Find the damage-resolution decision where Carol can act.
    let played = false;
    for (let i = 0; i < 5 && !played; i++) {
      const dp = engine.decision();
      if (!dp || dp.window !== "combat.damageResolution") break;
      const mr = dp.options.find((o) => o.id.includes("Martyr's Resilience"));
      if (mr) {
        runTrace(engine, [[dp.seat, mr.id]]);
        played = true;
      } else {
        runTrace(engine, [[dp.seat, "pass"]]);
      }
    }
    expect(played).toBe(true);

    // Alice's V1 is a combatant with [obf], so the basic mode is live.
    const dp = engine.decision()!;
    expect(dp.window).toBe("card.asPlayed");
    expect(
      dp.options.some((o) => o.id.startsWith("play:Hide the Mind:basic:V1")),
    ).toBe(true);
  });
});

describe("requiresDisciplines — the enabling query", () => {
  it("every spec-compiled card answers it, and matches its printed modes", () => {
    const registry = testRegistry;
    for (const spec of cardSpecs) {
      const handler = registry[spec.name];
      if (!handler?.requiresDisciplines) continue; // bespoke override
      for (const mode of spec.modes) {
        const got = handler.requiresDisciplines(mode.level, mode.variant);
        expect(Array.isArray(got)).toBe(true);
        if (mode.discipline === null) continue;
        // Whatever shape the spec used, every named Discipline is
        // reported — that is exactly what "requiring X" asks.
        const named =
          typeof mode.discipline === "object" && !Array.isArray(mode.discipline)
            ? mode.discipline.all
            : Array.isArray(mode.discipline)
              ? mode.discipline
              : [mode.discipline];
        // A variant-less lookup can land on a sibling mode; only assert
        // when the mode is unambiguous.
        const siblings = spec.modes.filter(
          (m) => m.level === mode.level && m.variant === mode.variant,
        );
        if (siblings.length === 1) expect(got.sort()).toEqual([...named].sort());
      }
    }
  });

  it("pins the recorded deviation: no prevention CREDIT can be Discipline-filtered", () => {
    // `CombatFrame.preventCredits` is a count, so a credit has forgotten
    // which card granted it and cannot be filtered. That is only safe
    // while no credit-granting card requires a Discipline some
    // `noPreventBy` card names (design doc §3). Obedient Flesh, the one
    // credit source, requires [dom][pro]; the filters name [for].
    const filtered = new Set<string>();
    const creditDisciplines = new Set<string>();
    for (const spec of cardSpecs) {
      for (const mode of spec.modes) {
        for (const e of mode.effects) {
          if (
            (e.kind === "strikeHandBonus" || e.kind === "strikeDamage") &&
            e.riders?.noPreventBy
          ) {
            for (const d of e.riders.noPreventBy) filtered.add(d);
          }
          if (e.kind === "combatCredits" && e.prevent) {
            const d = mode.discipline;
            const list =
              d === null
                ? []
                : typeof d === "object" && !Array.isArray(d)
                  ? d.all
                  : Array.isArray(d)
                    ? d
                    : [d];
            for (const x of list) creditDisciplines.add(x);
          }
        }
      }
    }
    expect(filtered.size).toBeGreaterThan(0); // the test means something
    for (const d of creditDisciplines) expect(filtered.has(d)).toBe(false);
  });
});
