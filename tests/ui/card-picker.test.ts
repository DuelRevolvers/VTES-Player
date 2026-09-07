/**
 * Looking through a pile of cards — the search and ash-heap pickers.
 *
 * A search's candidates are card IDS in a zone the viewer cannot read:
 * `redactFor` masks every library, including its owner's, because you may
 * not read your own deck (p. 14). So the only place the card's name
 * existed was inside the option's label, as prose — and a client that
 * wants to show the card instead of the name had nothing to look up.
 *
 * The engine is the only thing that knows which card an option is about
 * (docs/richer-options-design.md §1), so it now says: `answerChoice.card`.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../src/engine/index.ts";
import { redactFor, VtesEngine } from "../../src/engine/index.ts";
import type { RenderInput } from "../../src/ui/render.ts";
import { render } from "../../src/ui/render.ts";
import { runTrace, testRegistry, threeSeatGame } from "../engine/fixtures.ts";

/** Alice plays Magic of the Smith with three cards in her library. */
function searching(): { state: GameState; engine: VtesEngine } {
  const state = threeSeatGame();
  const v1 = state.seats[0]!.minions[0]!;
  Object.assign(v1, { disciplines: { tha: "basic" }, blood: 3 });
  state.seats[0]!.hand.push({ id: "ms", name: "Magic of the Smith" });
  state.seats[0]!.library.push(
    { id: "filler", name: "Conditioning" }, // drawn as the replacement (p. 7)
    { id: "l1", name: "Conditioning" },
    { id: "l2", name: ".44 Magnum" },
    { id: "l3", name: "Assault Rifle" },
  );
  const engine = new VtesEngine(state, testRegistry);
  runTrace(engine, [
    ["Alice", "play:Magic of the Smith:basic:V1:ms"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
    ["Alice", "pass"], ["Bob", "pass"], ["Carol", "pass"],
  ]);
  return { state, engine };
}

function screen(state: GameState, engine: VtesEngine, over: Partial<RenderInput> = {}): string {
  return render({
    state,
    dp: engine.decision(),
    eventFilter: "",
    canUndo: false,
    canRewind: true,
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
    ...over,
  });
}

describe("a choice that picks a card", () => {
  it("names the card, so a client need not read it out of the label", () => {
    const { engine } = searching();
    const dp = engine.decision()!;
    const magnum = dp.options.find((o) => o.id.endsWith(":l2"))!;
    expect(magnum.kind).toBe("answerChoice");
    expect(magnum.kind === "answerChoice" && magnum.card).toBe(".44 Magnum");

    const rifle = dp.options.find((o) => o.id.endsWith(":l3"))!;
    expect(rifle.kind === "answerChoice" && rifle.card).toBe("Assault Rifle");
  });

  it("says nothing for an answer that picks no card", () => {
    // "Find nothing" is an ordinary answer, not a decline (p. 48) — and it
    // is about no card at all, so it carries no name and renders as a
    // plain button rather than an empty card frame.
    const { engine } = searching();
    const none = engine.decision()!.options.find((o) => o.id.endsWith(":none"))!;
    expect(none.kind === "answerChoice" && none.card).toBeUndefined();
  });

  it("still leaks nothing: the library stays face down in the masked view", () => {
    // The option list IS the search, and it is addressed to the seat doing
    // the searching. The ZONE is unchanged — nobody, including its owner,
    // can read the library off the table.
    const { state } = searching();
    const masked = redactFor(state, "Alice");
    const lib = masked.seats[0]!.library;
    expect(lib.length).toBeGreaterThan(0);
    expect(lib.every((c) => c.name === "")).toBe(true);
  });

  it("renders as cards, not a column of names", () => {
    const { state, engine } = searching();
    const html = screen(state, engine);
    expect(html).toContain("cardgrid picker");
    expect(html).toContain(".44 Magnum");
    expect(html).toContain("Assault Rifle");
    // The non-card answers are still ordinary buttons underneath.
    expect(html).toContain("Find nothing");
  });
});

describe("an ordinary decision", () => {
  it("is unaffected — no picker unless an option is about a card", () => {
    const state = threeSeatGame();
    const engine = new VtesEngine(state, testRegistry);
    expect(screen(state, engine)).not.toContain("cardgrid picker");
  });
});
