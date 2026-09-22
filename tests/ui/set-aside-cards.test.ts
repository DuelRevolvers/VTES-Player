/**
 * LOOKING AT THE CARDS SET ASIDE ON A CARD IN PLAY (owner request,
 * 2026-09-20).
 *
 * Shilmulo Tarot holds two cards out of play and prints "you can look at
 * the cards at any time". There was no at-any-time to do it in: the table
 * drew the equipment with nothing on it, and the names only ever appeared
 * at the instant the engine offered to draw one of them.
 *
 * The permission is NOT re-decided here. `maskStore` in the redaction has
 * already answered it — a store this viewer may read arrives with names
 * on, one they may not arrives face down — so the test that matters is
 * the negative one: the same board, rendered for somebody else, offers no
 * way in and still shows the count.
 */

import { describe, expect, it } from "vitest";
import type { GameState, PermanentInPlay } from "../../src/engine/index.ts";
import { redactFor, VtesEngine } from "../../src/engine/index.ts";
import type { RenderInput } from "../../src/ui/render.ts";
import { readableStores, render, stillOffered } from "../../src/ui/render.ts";
import { testRegistry, threeSeatGame } from "../engine/fixtures.ts";

function screen(state: GameState, over: Partial<RenderInput> = {}): string {
  return render({
    state,
    dp: null,
    eventFilter: "",
    canUndo: false,
    canRewind: false,
    omniscient: false,
    selectedCard: null,
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
    localSeat: null,
    ashOpen: null,
    canLeave: false,
    canChat: false,
    canModerate: false,
    moderation: null,
    chatColor: "#c9a227",
    chatSettingsOpen: false,
    emojiOpen: false,
    emojiCategory: "vtes",
    ...over,
  });
}

function entry(id: string, name: string, extra: Partial<PermanentInPlay> = {}): PermanentInPlay {
  return { card: { id, name }, locked: false, usedThisPhase: false, statics: {}, tags: [name], ...extra };
}

/** Alice's V1 wears a Shilmulo Tarot with two cards face down on it. */
function tarotGame(): GameState {
  const state = threeSeatGame();
  state.seats[0]!.minions[0]!.attached.push(
    entry("tarot", "Shilmulo Tarot", {
      stored: [
        { id: "s1", name: ".44 Magnum" },
        { id: "s2", name: "Conditioning" },
      ],
      storedFaceUp: false,
    }),
  );
  return state;
}

describe("cards set aside on a card in play", () => {
  it("counts them on the card, in teal, whoever is looking", () => {
    // The COUNT is public even when the names are not: two cards sit on
    // that equipment and everybody at the table can see that they do.
    for (const seat of ["Alice", "Bob"]) {
      const html = screen(redactFor(tarotGame(), seat));
      expect(html, seat).toContain(`title="2 card(s) set aside"`);
      expect(html, seat).toContain("pips counters");
    }
  });

  it("offers a look to the Methuselah whose card it is", () => {
    const state = redactFor(tarotGame(), "Alice");
    expect([...readableStores(state).keys()]).toEqual(["tarot"]);

    // Lit and clickable, with the look counted as one of the things the
    // card can do — there is no engine option on it at all here.
    const html = screen(state, { selectedCard: "tarot" });
    expect(html).toContain("actionable selected");
    expect(html).toContain(`data-peek="tarot"`);
    expect(html).toContain("Look at the 2 cards set aside on this");
    // It is not a move: the one handler that submits reads `data-opt`.
    expect(html).not.toContain(`data-opt="tarot"`);
  });

  it("names them in a panel when that look is taken", () => {
    const html = screen(redactFor(tarotGame(), "Alice"), { storeOpen: "tarot" });
    expect(html).toContain("Shilmulo Tarot — 2 cards set aside");
    expect(html).toContain(".44 Magnum");
    expect(html).toContain("Conditioning");
    expect(html).toContain("store-scrim");
  });

  it("offers NOTHING to anybody else, and the panel refuses if asked", () => {
    // The negative half. Same board, Bob's copy of it.
    const theirs = redactFor(tarotGame(), "Bob");
    expect(readableStores(theirs).size).toBe(0);
    const html = screen(theirs, { selectedCard: "tarot", storeOpen: "tarot" });
    expect(html).not.toContain(`data-peek=`);
    expect(html).not.toContain("set aside on this");
    // Asked directly — a hand-set view state, or a stale click — the panel
    // re-checks rather than trusting it, and draws nothing.
    expect(html).not.toContain("storeview");
    expect(html).not.toContain(".44 Magnum");
  });

  it("opens a FACE-UP store to everybody — it is public", () => {
    // Black Market Cache holds its cards face up, so there is nobody at
    // the table who may not look. Without this the previous test would
    // pass on a rule that simply said "only your own cards".
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(
      entry("bmc", "Black Market Cache", {
        stored: [{ id: "e1", name: ".44 Magnum" }],
        storedFaceUp: true,
      }),
    );
    for (const seat of ["Alice", "Carol"]) {
      const html = screen(redactFor(state, seat), { selectedCard: "bmc" });
      expect(html, seat).toContain(`data-peek="bmc"`);
      expect(html, seat).toContain("Look at the 1 card set aside on this");
    }
  });

  it("lets the owner look AT ANY TIME — while a bot moves, or another seat decides", () => {
    // THE OWNER-REPORTED BUG (2026-09-22), and a reversal. This test used
    // to assert the opposite — "the table is dead while somebody else is
    // deciding, and this is part of the table" — which made the card's
    // own "you can look at the cards at any time" mean "only on your own
    // decisions", a fraction of any game with bots. Looking changes
    // nothing and asks the engine nothing, so it has no turn to wait for.
    const state = redactFor(tarotGame(), "Alice");
    for (const over of [{ thinking: true }, { waitingFor: "Bob" }]) {
      const html = screen(state, { selectedCard: "tarot", ...over });
      expect(html).toContain(`data-peek="tarot"`);
      expect(html).toContain("actionable selected");
      expect(html).toContain(`title="2 card(s) set aside"`);
      // …and the panel opens and names them, not only the menu entry.
      const panel = screen(state, { storeOpen: "tarot", ...over });
      expect(panel).toContain("Shilmulo Tarot — 2 cards set aside");
      expect(panel).toContain(".44 Magnum");
    }
  });

  it("still draws NO MOVES on the table while somebody else is deciding", () => {
    // What the old rule was actually protecting, kept. A real decision
    // with moves on table cards: they are drawn on the owner's own
    // decision (the positive control) and not while a bot moves — so the
    // only tile left lit is the one holding cards she may look at.
    const real = tarotGame();
    const dp = new VtesEngine(real, testRegistry).decision();
    const view = redactFor(real, "Alice");
    const count = (html: string): number => (html.match(/actionable/g) ?? []).length;

    const deciding = screen(view, { dp });
    expect(count(deciding)).toBeGreaterThan(1);

    for (const over of [{ thinking: true }, { waitingFor: "Bob" }]) {
      const html = screen(view, { dp, ...over });
      expect(count(html)).toBe(1);
      expect(html).toContain(`data-tcard="tarot"`);
    }
  });

  it("keeps the menu open across decisions while the only thing on it is the look", () => {
    // The second half of the same bug. The loop prunes a selection that
    // `stillOffered` says has nothing on it, and `stillOffered` used to
    // ask about MOVES only — so the Tarot's menu, whose one entry is the
    // look, was snapped shut on every bot decision.
    expect(stillOffered("tarot", null, redactFor(tarotGame(), "Alice"))).toBe(true);
    // Bob may not look, so for him there is nothing to keep open.
    expect(stillOffered("tarot", null, redactFor(tarotGame(), "Bob"))).toBe(false);
  });
});
