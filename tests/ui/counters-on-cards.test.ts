/**
 * Counters on a card in play (owner report, 2026-09-17).
 *
 * A card that is counting something — The Gate of Acheron's clock, a
 * blood-bank location's store — showed it as a number in a corner badge
 * the size of the card's border, which is not readable at table scale. It
 * now gets the blood overlay's treatment: the same pips, in teal, in the
 * place a player already looks for a card's state.
 *
 * `render()` is a pure function of the state, so this is asserted on the
 * markup without a DOM. The teal is a CSS class, not an inline colour, so
 * the assertion is about the class the pips carry.
 */

import { describe, expect, it } from "vitest";
import type { DecisionPoint, PermanentInPlay } from "../../src/engine/index.ts";
import type { RenderInput } from "../../src/ui/render.ts";
import { render } from "../../src/ui/render.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

function permanent(id: string, name: string, counters?: number): PermanentInPlay {
  return {
    card: { id, name },
    controller: "Alice",
    owner: "Alice",
    locked: false,
    usedThisPhase: false,
    statics: {},
    tags: [],
    ...(counters === undefined ? {} : { counters }),
  };
}

function screen(state: unknown, over: Partial<RenderInput> = {}): string {
  return render({
    state: state as RenderInput["state"],
    dp: null as DecisionPoint | null,
    eventFilter: "",
    canUndo: false,
    canRewind: false,
    omniscient: true,
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
    localSeat: "Alice",
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

describe("counters on a card in play", () => {
  it("draws them as pips over the card, the way blood sits on a vampire", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(permanent("gate1", "The Gate of Acheron", 3));
    const html = screen(state);
    expect(html).toContain("counter-overlay");
    // Pips, in the counter colour — not the blood one, and not a number
    // tucked into the border.
    expect(html).toContain(`<span class="pips counters">●●●</span>`);
    expect(html).not.toContain("counter-badge");
  });

  it("draws nothing at all for a card with no counters", () => {
    // The negative case, and the reason it matters: an overlay drawn for
    // every permanent would sit an empty box on every location on the
    // table. `0` and `undefined` are both "not counting anything".
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(permanent("haven1", "Haven Uncovered"));
    state.seats[0]!.permanents.push(permanent("gate2", "The Gate of Acheron", 0));
    const html = screen(state);
    expect(html).toContain(`data-tcard="haven1"`);
    expect(html).toContain(`data-tcard="gate2"`);
    expect(html).not.toContain("counter-overlay");
  });

  it("reaches an ATTACHED card too, not only a permanent on the mat", () => {
    // The lesson this project keeps relearning: a treatment written for
    // `seat.permanents` does not exist for attached cards, and equipment
    // that counts (ammunition, a location's store) is attached.
    const state = threeSeatGame();
    state.seats[0]!.minions[0]!.attached.push(permanent("ammo1", ".44 Magnum", 2));
    const html = screen(state);
    expect(html).toContain("counter-overlay");
    expect(html).toContain(`<span class="pips counters">●●</span>`);
  });

  it("gives up on pips past a handful, the way blood does", () => {
    const state = threeSeatGame();
    state.seats[0]!.permanents.push(permanent("gate3", "The Gate of Acheron", 9));
    expect(screen(state)).toContain(`<span class="pips counters">●×9</span>`);
  });
});
