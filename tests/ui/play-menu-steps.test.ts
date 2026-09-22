/**
 * SEQUENTIAL PICKERS FOR A CARD WITH TOO MANY PLAYS
 * (owner request 2026-09-21, docs/play-menu-steps-design.md).
 *
 * Vessel enumerates every minion at the table × (nothing, or each Blood
 * Doll in play), so a busy table offers it forty-odd ways in one menu.
 * The menu now asks one question at a time: 12 + 4 buttons instead of 48.
 *
 * The property that makes this safe is that NOTHING HERE REACHES THE
 * ENGINE. Narrowing is view state; the final click submits an option id
 * that was in the decision all along. So the two things most worth
 * pinning are that no legal play can be narrowed out of reach, and that
 * the ids on the final buttons are untouched.
 */

import { describe, expect, it } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import type { DecisionPoint, LegalOption } from "../../src/engine/index.ts";
import type { DeckDef, GameSetup } from "../../src/ui/decks.ts";
import { narrowPlays, playAxes, render } from "../../src/ui/render.ts";
import { LocalTransport } from "../../src/ui/transport.ts";

const config = playtestDecks as unknown as {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
};
const setup: GameSetup = { decks: config.decks, seed: config.seed, maxTurns: 40 };

/** One Vessel-shaped play: a target, and which Blood Doll to burn. */
function play(card: string, target: string, bd: string): LegalOption {
  return {
    id: `play:Vessel:-:${target}:${bd}:${card}`,
    kind: "playCard",
    label: `Vessel on ${target}${bd === "none" ? "" : " (burn Blood Doll)"}`,
    card,
    name: "Vessel",
    minion: null,
    mode: null,
    params: { target, bd },
  };
}

const TARGETS = ["v1", "v2", "v3", "v4", "v5", "v6"];
const DOLLS = ["none", "bd1", "bd2"];

/** THE CROSS PRODUCT, exactly as Vessel's enumerator builds it: 18 plays
 *  off two axes, which is what a flat menu cannot show. */
function vesselPlays(card: string): LegalOption[] {
  const out: LegalOption[] = [];
  for (const t of TARGETS) for (const bd of DOLLS) out.push(play(card, t, bd));
  return out;
}

/**
 * The table, with a decision forced onto one hand card.
 *
 * `dpOverride` is how the existing render tests drive the bar; here it
 * also stands in for a board with six minions and two Blood Dolls on it,
 * which is a fixture about the MENU rather than about the card.
 */
function screen(opts: {
  plays: LegalOption[];
  card: string;
  seat: string;
  narrow?: Record<string, string>;
}): string {
  const t = new LocalTransport({ setup });
  const dp: DecisionPoint = {
    seq: 0,
    seat: opts.seat,
    window: "turn.master",
    options: [...opts.plays, { id: "pass", kind: "pass", label: "Pass" }],
  };
  return render({
    state: t.view(),
    dp,
    eventFilter: "",
    canUndo: false,
    canRewind: true,
    omniscient: false,
    selectedCard: opts.card,
    playNarrow: opts.narrow ?? {},
    handOrder: [],
    settingsOpen: false,
    helpOpen: false,
    helpOpenSections: [],
    helpQuery: "",
    autoPass: {},
    aiSeats: {},
    thinking: false,
    waitingFor: null,
    notices: [],
    finished: null,
    aiDelayMs: 0,
    cardTextPx: 15,
    seatFaces: {},
    localSeat: opts.seat,
    ashOpen: null,
    canLeave: false,
    canChat: false,
    canModerate: true,
    chatColor: "#c9a227",
    chatSettingsOpen: false,
    emojiOpen: false,
    emojiCategory: "vtes",
    moderation: null,
  });
}

/** A real card in a real hand, so the strip actually draws a menu on it. */
function handCard(): { card: string; seat: string } {
  const t = new LocalTransport({ setup });
  const seat = t.decision()!.seat;
  const hand = t.view().seats.find((s) => s.id === seat)!.hand;
  return { card: hand[0]!.id, seat };
}

describe("which axes a long menu can be split on", () => {
  it("takes them in the enumerator's order, not by how many values each has", () => {
    // `bd` has 3 values and `target` has 6, so a most-distinct-first or
    // fewest-first rule would put them the other way round. The order a
    // player would say it out loud is the order the card wrote it.
    expect(playAxes(vesselPlays("c1"))).toEqual(["target", "bd"]);
  });

  it("ignores an axis that does not vary", () => {
    // One target, three dolls: there is nothing to ask about the target.
    const plays = DOLLS.map((bd) => play("c1", "v1", bd));
    expect(playAxes(plays)).toEqual(["bd"]);
  });

  it("refuses an axis some plays do not have", () => {
    // THE RULE THAT KEEPS NARROWING TOTAL. An option with no `bd` could
    // not be reached by any of that axis's buttons, so splitting on it
    // would make a legal play unclickable — the failure mode that is
    // invisible, because the menu still looks fine.
    const plays = [...vesselPlays("c1"), play("c1", "v7", "none")];
    plays[plays.length - 1] = {
      ...plays[plays.length - 1]!,
      params: { target: "v7" },
    } as LegalOption;
    expect(playAxes(plays)).toEqual(["target"]);
  });
});

describe("narrowing a menu", () => {
  it("keeps only the plays that match every answer so far", () => {
    const plays = vesselPlays("c1");
    expect(narrowPlays(plays, { target: "v2" })).toHaveLength(DOLLS.length);
    expect(narrowPlays(plays, { target: "v2", bd: "bd1" })).toHaveLength(1);
  });

  it("falls back to the whole list rather than showing an empty menu", () => {
    // A stale answer — from a card that is no longer the one open — must
    // never present nothing at all. The UI prunes these too, so this is
    // the second of the two guards.
    expect(narrowPlays(vesselPlays("c1"), { target: "not-a-minion" })).toHaveLength(18);
  });

  it("changes nothing when no answer has been given", () => {
    const plays = vesselPlays("c1");
    expect(narrowPlays(plays, {})).toBe(plays);
  });
});

describe("the menu on screen", () => {
  it("asks the first question instead of listing the cross product", () => {
    const { card, seat } = handCard();
    const html = screen({ plays: vesselPlays(card), card, seat });
    expect(html).toContain("On whom?");
    expect(html).toContain('data-narrow="target=v1"');
    // THE NEGATIVE SPACE, and the whole point: the 18 real plays are NOT
    // all drawn. A stepped menu that also listed them would be longer
    // than the one it replaced.
    expect(html).not.toContain(`data-opt="play:Vessel:-:v1:none:${card}"`);
    // One button per target, not per pairing.
    expect(html.match(/data-narrow="target=/g) ?? []).toHaveLength(TARGETS.length);
  });

  it("asks the next question once the first is answered", () => {
    const { card, seat } = handCard();
    const html = screen({ plays: vesselPlays(card), card, seat, narrow: { target: "v2" } });
    // Three plays are left, which is under the flat limit — so the second
    // axis is not asked as a step, the real options are.
    expect(html).toContain(`data-opt="play:Vessel:-:v2:none:${card}"`);
    expect(html).toContain(`data-opt="play:Vessel:-:v2:bd1:${card}"`);
    // …and only that target's.
    expect(html).not.toContain(`data-opt="play:Vessel:-:v3:none:${card}"`);
  });

  it("shows what has been answered, and a way back", () => {
    const { card, seat } = handCard();
    const html = screen({ plays: vesselPlays(card), card, seat, narrow: { target: "v2" } });
    // A player who has picked a target must be able to change their mind
    // without closing the card and opening it again.
    expect(html).toContain("data-narrow-reset");
    expect(html).toContain("Start over");
    expect(html).toContain("pcrumb");
  });

  it("leaves a SHORT menu flat, which is the control", () => {
    // Without this, every assertion above would pass on a menu that
    // stepped unconditionally — and a card with three plays would have
    // gained a click for nothing.
    const { card, seat } = handCard();
    const plays = DOLLS.map((bd) => play(card, "v1", bd));
    const html = screen({ plays, card, seat });
    expect(html).not.toContain("data-narrow=");
    for (const o of plays) expect(html).toContain(`data-opt="${o.id}"`);
  });

  it("submits the engine's own option id, untouched", () => {
    // The safety property of the whole feature: narrowing is view state,
    // and the id on the final button is the one the engine enumerated. If
    // this ever fails, the menu has started building ids of its own.
    const { card, seat } = handCard();
    const plays = vesselPlays(card);
    const html = screen({ plays, card, seat, narrow: { target: "v5" } });
    for (const o of plays.filter((p) => p.id.includes(":v5:"))) {
      expect(html).toContain(`data-opt="${o.id}"`);
    }
  });
});
