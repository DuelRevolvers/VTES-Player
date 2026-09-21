/**
 * THE TERMS ON THE VOTE BAR (owner request, 2026-09-20).
 *
 * "If someone plays Kine Resources Contested, then it should show how the
 * player allocated the points." The bar named the card and the running
 * tally and nothing about what was being voted ON, so a player deciding
 * how to vote had to scroll the log back to the announcement.
 *
 * Two readings, and the split between them is the point: a card whose
 * terms name Methuselahs is summarised as SIGNED POOL by seat, through
 * `resolvePerSeat` — the engine's own answer, because the same terms key
 * names the seats that LOSE on Kine Resources Contested and the ones that
 * GAIN on Parity Shift, and a parse written here would get one of them
 * backwards (docs/ai-referendum-view-design.md §5.1). Everything else
 * falls back to the caller's own chosen sentence.
 */

import { describe, expect, it } from "vitest";
import type { GameState, ReferendumFrame } from "../../src/engine/index.ts";
import { VtesEngine, newCycle } from "../../src/engine/index.ts";
import type { RenderInput } from "../../src/ui/render.ts";
import { render } from "../../src/ui/render.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

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

/** A referendum already at the polling step, terms answered. */
function polling(over: Partial<ReferendumFrame>): GameState {
  const state = threeSeatGame();
  state.frames.push({
    kind: "referendum",
    actionId: "a1",
    caller: "Alice",
    cardName: "Kine Resources Contested",
    variant: "political",
    bloodHuntTarget: null,
    callingMinion: null,
    voteGrants: {},
    step: "polling",
    terms: {},
    votes: [],
    usedSources: [],
    cycle: newCycle(["Alice", "Bob", "Carol"]),
    ...over,
  } as ReferendumFrame);
  return state;
}

describe("the vote bar says what is being voted on", () => {
  it("shows an allocation as signed pool, by seat", () => {
    const html = screen(
      polling({
        terms: { alloc: "Bob=3,Carol=1" },
        termsLabel: "Allocate: Bob=3,Carol=1",
        seatMap: { losers: { key: "alloc" } },
        effectKind: "burn",
      }),
    );
    expect(html).toContain("Kine Resources Contested");
    expect(html).toContain("voteterms");
    // Burning pool off a seat reads as a MINUS, whatever the raw key says.
    expect(html).toContain(`<span class="vterm loses">Bob −3</span>`);
    expect(html).toContain(`<span class="vterm loses">Carol −1</span>`);
    // Alice was allocated nothing, so she is not listed at all — a zero
    // beside two real numbers reads as a third term.
    expect(html).not.toContain(">Alice ");
  });

  it("signs a GAIN the other way, on the same terms key", () => {
    // Camarilla's Iron Fist: the chosen seat gains 1 while the allocated
    // seats burn. One frame, both directions — which is exactly the case
    // a home-grown parse of `terms` gets wrong.
    const html = screen(
      polling({
        cardName: "Camarilla's Iron Fist",
        terms: { chosen: "Carol", alloc: "Alice=2,Bob=3" },
        termsLabel: "Carol gains; allocate Alice=2,Bob=3",
        seatMap: { losers: { key: "alloc" }, gainers: { key: "chosen", each: 1 } },
        effectKind: "burn",
      }),
    );
    expect(html).toContain(`<span class="vterm loses">Alice −2</span>`);
    expect(html).toContain(`<span class="vterm loses">Bob −3</span>`);
    expect(html).toContain(`<span class="vterm gains">Carol +1</span>`);
  });

  it("falls back to the caller's own sentence when the terms name no seat", () => {
    const html = screen(
      polling({
        cardName: "Anarchist Uprising",
        terms: { clan: "Brujah" },
        termsLabel: "Choose Brujah",
        // No seatMap: a clan is not a Methuselah.
      }),
    );
    expect(html).toContain("Choose Brujah");
  });

  it("says nothing at all before the terms are chosen, or for a blood hunt", () => {
    // THE NEGATIVE. Both of these have an empty `terms`, and an empty
    // summary must read as "nothing to say" rather than as an empty box.
    const beforeTerms = screen(polling({ step: "terms", seatMap: { losers: { key: "alloc" } } }));
    expect(beforeTerms).toContain("votestrip"); // the bar itself is there
    expect(beforeTerms).not.toContain("voteterms");

    const hunt = screen(
      polling({ variant: "bloodHunt", cardName: "", bloodHuntTarget: "V1", terms: {} }),
    );
    expect(hunt).toContain("blood hunt");
    expect(hunt).not.toContain("voteterms");
  });
});

describe("the engine records the terms it offered", () => {
  it("keeps the chosen option's own sentence on the frame", () => {
    const state = threeSeatGame();
    Object.assign(state.seats[0]!.minions[0]!, { title: "innerCircle", sect: "camarilla" });
    state.seats[0]!.hand.push({ id: "pa", name: "Kine Resources Contested" });
    const engine = new VtesEngine(state, testRegistry);
    runTrace(engine, [
      ["Alice", "play:Kine Resources Contested"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
      ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ]);

    // The label comes from the option the engine itself built — asserted
    // against the option list rather than against a string written here,
    // so a reworded label does not become a test failure.
    const offered = engine.decision()!.options.find((o) => o.id === "terms:Bob=3,Carol=1");
    expect(offered).toBeDefined();
    runTrace(engine, [["Alice", "terms:Bob=3,Carol=1"]]);

    const rf = state.frames.find((f) => f.kind === "referendum");
    expect(rf?.kind === "referendum" && rf.termsLabel).toBe(offered!.label);
    expect(screen(state)).toContain(`<span class="vterm loses">Bob −3</span>`);
  });
});
