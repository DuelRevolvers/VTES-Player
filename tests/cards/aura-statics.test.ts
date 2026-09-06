/**
 * Cards in play that radiate statics onto OTHER minions (the `aura`
 * mechanism), plus the first master that attaches to another Methuselah's
 * minion. Gangrel Revel (100807) — "Gangrel you control get +1 strength";
 * The Khabar: Community (101042) — "Assamites get +1 stealth when
 * bleeding" (unqualified: every Methuselah's); Pentex™ Subversion (101384)
 * — "put this card on a ready minion. This minion cannot block."
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentAura, PermanentInPlay } from "../../src/engine/index.ts";
import { currentStealth, VtesEngine } from "../../src/engine/index.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function entry(id: string, name: string, extra: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return {
    card: { id, name },
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [],
    ...extra,
  };
}

const gangrelAura: PermanentAura = { scope: "controller", clan: "Gangrel", strength: 1 };
const khabarAura: PermanentAura = { scope: "global", clan: "Banu Haqim", bleedStealth: 1 };

describe("Gangrel Revel (100807)", () => {
  it("gives the controller's Gangrel +1 strength in combat", () => {
    const state = threeSeatGame();
    const v1 = state.seats[0]!.minions[0]!;
    v1.clan = "Gangrel";
    v1.strength = 1;
    state.seats[0]!.permanents.push(entry("gr1", "Gangrel Revel", { aura: gangrelAura }));
    const bobW = state.seats[1]!.minions[0]!;
    bobW.blood = 5;
    const engine = new VtesEngine(state, testRegistry);

    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
      ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // attempt → combat
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before range
      ["Alice", "pass"], ["Bob", "pass"], // range
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // before strikes
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"], // damage
    ]);

    // Base strength 1 + 1 from the Revel = 2 damage on Bob's blocker.
    const dealt = state.eventLog.filter((e) => e.type === "DamageInflicted");
    expect(dealt.some((e) => e.type === "DamageInflicted" && e.minion === "W" && e.amount === 2)).toBe(
      true,
    );
  });

  it("does not reach another Methuselah's Gangrel, nor your other clans", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(entry("gr1", "Gangrel Revel", { aura: gangrelAura }));
    const alice = state.seats[0]!;
    alice.minions[0]!.clan = "Ventrue"; // yours, wrong clan
    const bob = state.seats[1]!;
    bob.minions[0]!.clan = "Gangrel"; // right clan, wrong Methuselah
    const engine = new VtesEngine(state, testRegistry);

    // Bob's Gangrel blocks; if the aura leaked it would strike for 2.
    runTrace(engine, [
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"],
      ["Bob", "block:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "strike:hand"], ["Bob", "strike:hand"],
      ["Alice", "pass"], ["Bob", "pass"],
    ]);

    const dealt = state.eventLog.filter((e) => e.type === "DamageInflicted");
    expect(dealt.every((e) => e.type === "DamageInflicted" && e.amount === 1)).toBe(true);
  });

  it("can be burned by a non-Ravnos minion, but not by a Ravnos one", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push(entry("gr1", "Gangrel Revel", { aura: gangrelAura }));
    state.seats[1]!.minions[0]!.clan = "Ravnos"; // W may not
    state.seats[1]!.minions[1]!.clan = "Toreador"; // M may
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "act:Gangrel Revel:gr1:burn:M")).toBe(true);
    expect(dp.options.some((o) => o.id === "act:Gangrel Revel:gr1:burn:W")).toBe(false);
  });
});

describe("The Khabar: Community (101042)", () => {
  function bleedingBanuHaqim(withKhabar: boolean): GameState {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.clan = "Banu Haqim";
    if (withKhabar) {
      // Controlled by CAROL — the aura is unqualified, so it still applies.
      state.seats[2]!.permanents.push(entry("kh1", "The Khabar: Community", { aura: khabarAura }));
    }
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("bleed:V1");
    return state;
  }

  it("gives any Assamite +1 stealth while bleeding", () => {
    const withOut = bleedingBanuHaqim(false);
    const withIt = bleedingBanuHaqim(true);
    const idOf = (s: GameState): string => {
      const ev = s.eventLog.find((e) => e.type === "ActionAnnounced")!;
      return ev.type === "ActionAnnounced" ? ev.actionId : "";
    };
    expect(currentStealth(withOut, idOf(withOut))).toBe(0);
    expect(currentStealth(withIt, idOf(withIt))).toBe(1);
  });

  it("does not apply to a non-bleed action", () => {
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.clan = "Banu Haqim";
    state.seats[2]!.permanents.push(entry("kh1", "The Khabar: Community", { aura: khabarAura }));
    const engine = new VtesEngine(state, testRegistry);
    engine.choose("hunt:V1");
    const ev = state.eventLog.find((e) => e.type === "ActionAnnounced")!;
    const id = ev.type === "ActionAnnounced" ? ev.actionId : "";
    expect(currentStealth(state, id)).toBe(1); // hunt's own +1 only (p. 21)
  });

  it("gives a Tremere +1 stealth on the action that burns it", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[0]!.permanents.push(entry("kh1", "The Khabar: Community", { aura: khabarAura }));
    state.seats[1]!.minions[0]!.clan = "Tremere";
    const engine = new VtesEngine(state, testRegistry);

    engine.choose("act:The Khabar: Community:kh1:burn:W");
    const ev = state.eventLog.find((e) => e.type === "ActionAnnounced")!;
    const id = ev.type === "ActionAnnounced" ? ev.actionId : "";
    expect(currentStealth(state, id)).toBe(1);
  });
});

describe("Pentex™ Subversion (101384)", () => {
  it("goes on any Methuselah's ready minion and stops it blocking", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") {
      tf.phase = "master";
      tf.masterActionsLeft = 1;
    }
    state.seats[0]!.hand.push({ id: "px", name: "Pentex™ Subversion" });
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id.includes("Pentex") && o.id.includes("W"))).toBe(true);

    runTrace(engine, [
      ["Alice", "play:Pentex™ Subversion:-:W"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // as played
      ["Alice", "pass"], // end master phase
      ["Alice", "bleed:V1"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"], // announce
      ["Alice", "pass"],
    ]);

    // The card is controlled by Alice though it sits on Bob's minion (p. 16).
    const px = state.seats[1]!.minions[0]!.attached.find((p) => p.card.id === "px")!;
    expect(px.controller).toBe("Alice");
    // Bob may block with M, but never with the subverted W.
    const bob = engine.decision()!;
    expect(bob.seat).toBe("Bob");
    expect(bob.options.some((o) => o.id === "block:M")).toBe(true);
    expect(bob.options.some((o) => o.id === "block:W")).toBe(false);
  });

  it("can be burned by other minions but not by the subverted one", () => {
    const state = threeSeatGame();
    const tf = state.frames[0]!;
    if (tf.kind === "turn") tf.seat = "Bob";
    state.seats[1]!.minions[0]!.attached.push(
      entry("px", "Pentex™ Subversion", {
        controller: "Alice",
        statics: { cannotBlock: true },
        tags: ["Pentex™ Subversion"],
      }),
    );
    const engine = new VtesEngine(state, testRegistry);

    const dp = engine.decision()!;
    expect(dp.options.some((o) => o.id === "act:Pentex™ Subversion:px:burn:M")).toBe(true);
    expect(dp.options.some((o) => o.id === "act:Pentex™ Subversion:px:burn:W")).toBe(false);

    runTrace(engine, [
      ["Bob", "act:Pentex™ Subversion:px:burn:M"],
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // announce
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // A
      ["Bob", "pass"], ["Alice", "pass"], ["Carol", "pass"], // C → resolves
    ]);

    // Directed at Alice, who controls the card — not at Bob, who holds the
    // minion it sits on (p. 16).
    expect(state.eventLog.find((e) => e.type === "ActionAnnounced")).toMatchObject({
      target: "Alice",
      directed: true,
    });
    expect(state.seats[1]!.minions[0]!.attached).toHaveLength(0);
  });
});
