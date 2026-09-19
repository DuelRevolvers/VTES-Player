/**
 * `view.referendum` — the frame the projection used to drop
 * (docs/ai-referendum-view-design.md).
 *
 * Two things are under test and they are separate on purpose:
 *
 *  1. the PROJECTION — a referendum on the stack reaches `PlayerView`,
 *     identically for every seat, because all of it is face up;
 *  2. the POLARITY DECLARATION — a card's referendum primitive says
 *     whether it burns or gains (owner ruling, 2026-09-18), which is what
 *     lets a voter tell a burn from a gift.
 *
 * The negative space matters as much as the positive here: `referendum`
 * must be ABSENT when there is no referendum, and `effectKind` must be absent
 * — not "other" — when nothing declared one. An unknown polarity read as
 * "no pool moves" would be a silent wrong answer.
 */

import { describe, expect, it } from "vitest";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import { viewFor } from "../../src/engine/agent.ts";
import { newCycle } from "../../src/engine/state.ts";
import type { GameState, ReferendumFrame } from "../../src/engine/state.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

/** A political referendum mid-polling, with terms already declared.
 *  `omitEffectKind` builds one that DECLARED NOTHING — a blood hunt, or a
 *  handler with no declaration — which must project as absent. */
function withReferendum(
  extra: Partial<ReferendumFrame> = {},
  opts: { omitEffectKind?: boolean } = {},
): GameState {
  const state = threeSeatGame();
  const frame: ReferendumFrame = {
    kind: "referendum",
    actionId: "a1",
    caller: "Alice",
    cardName: "Kine Resources Contested",
    variant: "political",
    bloodHuntTarget: null,
    callingMinion: "V1",
    voteGrants: {},
    ...(opts.omitEffectKind ? {} : { effectKind: "burn" as const }),
    step: "polling",
    terms: { alloc: "Bob=2,Carol=1" },
    votes: [
      { seat: "Alice", source: "V1", count: 3, inFavor: true },
      { seat: "Bob", source: "V2", count: 1, inFavor: false },
    ],
    usedSources: ["V1", "V2"],
    cycle: newCycle(["Alice", "Bob", "Carol"]),
    ...extra,
  };
  state.frames.push(frame);
  return state;
}

describe("view.referendum", () => {
  it("is absent when no referendum is on the stack", () => {
    const view = viewFor(threeSeatGame(), "Alice");
    expect(view.referendum).toBeUndefined();
  });

  it("projects the frame, and identically for every seat", () => {
    const state = withReferendum();
    const views = ["Alice", "Bob", "Carol"].map((s) => viewFor(state, s));

    for (const view of views) {
      expect(view.referendum?.caller).toBe("Alice");
      expect(view.referendum?.cardName).toBe("Kine Resources Contested");
      expect(view.referendum?.variant).toBe("political");
      expect(view.referendum?.callingMinion).toBe("V1");
      expect(view.referendum?.step).toBe("polling");
      expect(view.referendum?.terms).toEqual({ alloc: "Bob=2,Carol=1" });
      expect(view.referendum?.usedSources).toEqual(["V1", "V2"]);
    }
    // A public zone looks the same from every chair. If the caller ever
    // sees more than a voter here, something is leaking.
    expect(views[1]!.referendum).toEqual(views[0]!.referendum);
    expect(views[2]!.referendum).toEqual(views[0]!.referendum);
  });

  it("counts the running tally from the votes CAST, not from the frame's total", () => {
    // `votesFor`/`votesAgainst` on the frame are written at the TALLY, so
    // a seat deciding mid-polling would be told 0–0 while votes were
    // plainly on the table.
    const view = viewFor(withReferendum(), "Carol");
    expect(view.referendum?.votesFor).toBe(3);
    expect(view.referendum?.votesAgainst).toBe(1);
  });

  it("says which way the pool moves", () => {
    const view = viewFor(withReferendum(), "Carol");
    expect(view.referendum?.effectKind).toBe("burn");
  });

  it("carries the raw terms, and does NOT try to sign them", () => {
    // A first cut folded these keys into a signed per-seat pool delta,
    // assuming `alloc` names the losers. Parity Shift is the other way
    // round — "allocate 3 of THEIR pool among 1 or more other
    // Methuselahs" — so the same key means opposite things on different
    // cards and a generic parse cannot sign it. The terms are passed
    // through as declared; signing belongs with the card that knows.
    const view = viewFor(
      withReferendum({ terms: { chosen: "Alice", alloc: "Bob=2,Carol=1" } }),
      "Bob",
    );
    expect(view.referendum?.terms).toEqual({ chosen: "Alice", alloc: "Bob=2,Carol=1" });
  });

  it("knows the polarity during the TERMS step, before any terms exist", () => {
    // Terms are chosen on success only (p. 25's exception, p. 27), so
    // there is nothing to aim at yet — but which way the card moves pool
    // is a property of the card and is known from the moment it is
    // announced.
    const view = viewFor(withReferendum({ step: "terms", terms: {} }), "Alice");
    expect(view.referendum?.effectKind).toBe("burn");
    expect(view.referendum?.terms).toEqual({});
  });

  it("projects a BLOOD HUNT, which has no card and no calling minion", () => {
    // p. 35: not a card at all. A derived read must be TOTAL — this is a
    // rule, not an edge case, and it must not throw or invent a card.
    const view = viewFor(
      withReferendum({
        variant: "bloodHunt",
        cardName: "",
        callingMinion: null,
        bloodHuntTarget: "V3",
        terms: {},
      },
      { omitEffectKind: true }),
      "Alice",
    );
    expect(view.referendum?.variant).toBe("bloodHunt");
    expect(view.referendum?.cardName).toBe("");
    expect(view.referendum?.callingMinion).toBeNull();
    expect(view.referendum?.bloodHuntTarget).toBe("V3");
    // ABSENT, not "other": nothing declared a polarity, and "unknown"
    // must never read as "no pool moves".
    expect(view.referendum?.effectKind).toBeUndefined();
  });

  it("does not disturb the action projection", () => {
    const state = withReferendum();
    const view = viewFor(state, "Alice");
    expect(view.referendum).toBeDefined();
    // The fixture has no action frame; a referendum on the stack must not
    // conjure one.
    expect(view.action).toBeUndefined();
  });
});

describe("referendum polarity is declared by the primitive", () => {
  const registry = buildHandlerRegistry();

  it("tells a burn from a gift", () => {
    expect(registry["Kine Resources Contested"]?.referendumEffect).toBe("burn");
    expect(registry["Parity Shift"]?.referendumEffect).toBe("burn");
    expect(registry["Consanguineous Boon"]?.referendumEffect).toBe("gain");
  });

  it("says 'other' for a referendum that moves no pool", () => {
    // Most referendums move minions, titles, locations or cards. Saying
    // so is what stops a scorer inventing a pool swing.
    expect(registry["Praxis Seizure: Chicago"]?.referendumEffect).toBe("other");
  });

  it("EVERY spec-compiled political action declares one", () => {
    // The enforcement the design doc asked for. A primitive that forgets
    // is a silent wrong sign, which is worse than no sign at all — and
    // this is the test that makes forgetting visible, in the shape
    // `no-partial-cards.test.ts` uses over the registry.
    const political = Object.values(registry).filter((h) => h.isPoliticalAction);
    expect(political.length).toBeGreaterThan(20);

    const undeclared = political.filter((h) => !h.referendumEffect).map((h) => h.name);
    // Bespoke handlers with no referendum primitive are the only ones
    // allowed to be silent, and they are listed rather than counted so a
    // new one has to be looked at.
    expect(undeclared).toEqual([]);
  });
});
