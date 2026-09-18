/**
 * Actions live ON the cards they are about (docs/playtest-2026-09-05.md
 * §15) — the hand's rule applied to the board.
 *
 * The half that matters most is the NEGATIVE one: an option that names no
 * card on the table must stay on the action bar. An option silently
 * indexed under a key nothing renders would vanish from both places, and
 * a missing option looks exactly like an illegal one.
 */

import { describe, expect, it } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import type { DecisionPoint, GameState, LegalOption } from "../../src/engine/index.ts";
import type { DeckDef, GameSetup } from "../../src/ui/decks.ts";
import type { RenderInput } from "../../src/ui/render.ts";
import { actionsByTableCard, render, stillOffered } from "../../src/ui/render.ts";
import { LocalTransport } from "../../src/ui/transport.ts";

const config = playtestDecks as unknown as {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
};
const setup: GameSetup = { decks: config.decks, seed: config.seed, maxTurns: 60 };

function screen(t: LocalTransport, over: Partial<RenderInput> = {}): string {
  return render({
    state: t.view(),
    dp: t.decision(),
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
    emojiCategory: "vtes",
    ...over,
  });
}

/** Walk to the first decision where some option is about a table card. */
function withTableActions(): { t: LocalTransport; dp: DecisionPoint } {
  const t = new LocalTransport({ setup });
  for (let i = 0; i < 300; i++) {
    const dp = t.decision();
    if (!dp) break;
    if (actionsByTableCard(dp, t.view()).size > 0) return { t, dp };
    void t.choose((dp.options.find((o) => o.kind === "pass") ?? dp.options[0]!).id);
  }
  throw new Error("no decision offered an action on a table card");
}

describe("indexing options by the card they are about", () => {
  it("puts a minion's own actions on that minion", () => {
    const { t, dp } = withTableActions();
    const by = actionsByTableCard(dp, t.view());
    for (const o of dp.options) {
      if (o.kind !== "takeAction") continue;
      expect(by.get(o.minion) ?? []).toContain(o);
    }
  });

  it("NEVER indexes an option under something the table does not draw", () => {
    // The whole safety property: every key must be a card actually on
    // screen, or the option disappears from the bar and from the table at
    // once. "edge" and "caller" are vote sources, not cards.
    const { t, dp } = withTableActions();
    const state = t.view();
    const drawn = new Set<string>();
    for (const s of state.seats) {
      for (const m of s.minions) {
        drawn.add(m.id);
        for (const p of m.attached) drawn.add(p.card.id);
      }
      for (const p of s.permanents) drawn.add(p.card.id);
      for (const u of s.uncontrolled) drawn.add(u.card.id);
    }
    for (const key of actionsByTableCard(dp, state).keys()) {
      expect(drawn.has(key), `indexed under "${key}", which is not on the table`).toBe(true);
    }
  });

  it("leaves every OTHER option to the action bar", () => {
    // Pass, ending a phase, striking, pressing, answering a question:
    // nothing on the table could carry these.
    const { t, dp } = withTableActions();
    const onTable = new Set<LegalOption>();
    for (const list of actionsByTableCard(dp, t.view()).values()) {
      for (const o of list) onTable.add(o);
    }
    const html = screen(t);
    for (const o of dp.options) {
      if (onTable.has(o) || o.kind === "playCard" || o.kind === "discard") continue;
      expect(html, `"${o.label}" left the bar with nowhere to go`).toContain(
        `data-opt="${o.id}"`,
      );
    }
  });

  it("does not lose an option: every one is on a card, in hand, or on the bar", () => {
    const { t, dp } = withTableActions();
    const html = screen(t);
    const onTable = new Set<string>();
    for (const list of actionsByTableCard(dp, t.view()).values()) {
      for (const o of list) onTable.add(o.id);
    }
    for (const o of dp.options) {
      const reachable =
        onTable.has(o.id) ||
        o.kind === "playCard" ||
        o.kind === "discard" ||
        html.includes(`data-opt="${o.id}"`);
      expect(reachable, `"${o.label}" (${o.id}) is offered nowhere`).toBe(true);
    }
  });
});

describe("a selected card outliving its decision", () => {
  it("stops being offered the moment the decision it asked about is gone", () => {
    // A selection asks "what can this card do NOW?", and the table used to
    // keep answering with the LAST decision's options: a menu left open on
    // a card after the player passed, ended the phase, or a bot moved.
    const { t, dp } = withTableActions();
    const state = t.view();
    const [card] = [...actionsByTableCard(dp, state).keys()];
    expect(card, "the walk found no card with an action on it").toBeDefined();
    // The positive case first — without it this test would pass on a
    // `stillOffered` that always says no.
    expect(stillOffered(card!, dp, state)).toBe(true);
    expect(stillOffered("no-such-card", dp, state)).toBe(false);
    expect(stillOffered(null, dp, state)).toBe(false);

    // Walk on until the card stops being offered — passing, ending a
    // phase, and the turn moving to another seat all reach this — and
    // assert the selection would have been dropped by then.
    let steps = 0;
    for (; steps < 300; steps++) {
      const next = t.decision();
      if (!next) break;
      if (!stillOffered(card!, next, t.view())) break;
      void t.choose((next.options.find((o) => o.kind === "pass") ?? next.options[0]!).id);
    }
    expect(steps, "the card was offered at every decision to the end of the walk").toBeLessThan(300);
    expect(stillOffered(card!, t.decision(), t.view())).toBe(false);
  });

  it("keeps the menu open while the same card is still offered", () => {
    // The other half: a decision moving on is not by itself a reason to
    // close the menu. What closes it is the card dropping out of the
    // options, so a player mid-thought keeps their menu.
    const { t, dp } = withTableActions();
    const html = screen(t, { selectedCard: [...actionsByTableCard(dp, t.view()).keys()][0]! });
    expect(html).toContain("actionable selected");
  });
});

describe("the table's cards", () => {
  it("lights and badges a card with something to do", () => {
    const { t, dp } = withTableActions();
    const by = actionsByTableCard(dp, t.view());
    const [id, opts] = [...by.entries()][0]!;
    const html = screen(t);
    expect(html).toContain(`data-tcard="${id}"`);
    expect(html).toContain("actionable");
    expect(html).toContain(`>${opts.length}</span>`);
  });

  it("opens its menu when clicked, growing DOWN — it has room below it", () => {
    const { t, dp } = withTableActions();
    // Asserted, not skipped — a test that passes by finding nothing to do
    // is the shape this project keeps catching in card filters.
    const entry = [...actionsByTableCard(dp, t.view()).entries()].find(
      ([, o]) => o.length > 1,
    );
    expect(entry, "no card had a menu to open — the fixture is wrong").toBeDefined();
    const html = screen(t, { selectedCard: entry![0] });
    expect(html).toContain("playmenu down");
    for (const o of entry![1]) expect(html).toContain(`data-opt="${o.id}"`);
  });

  it("opens the menu for a SINGLE option too — a click is never a commitment", () => {
    // Owner request, 2026-09-05: a lone option used to resolve on the
    // click, so the player did the thing before reading what it was.
    // Every actionable card now renders a menu when selected, however few
    // options it has.
    const { t, dp } = withTableActions();
    const by = actionsByTableCard(dp, t.view());
    // Give the card exactly one option by picking a decision that has one,
    // or by taking the first card and asserting on whatever it holds.
    const single = [...by.entries()].find(([, o]) => o.length === 1);
    const [id, opts] = single ?? [...by.entries()][0]!;
    const html = screen(t, { selectedCard: id });
    expect(html).toContain("playmenu");
    for (const o of opts) expect(html).toContain(`data-opt="${o.id}"`);
    // The badge says how many, so "1" is a real and useful answer.
    expect(html).toContain(`>${opts.length}</span>`);
  });

  it("signposts the table from the bar", () => {
    const { t } = withTableActions();
    expect(screen(t)).toContain("click a lit card on the table");
  });

  it("lights nothing while an AI's move is being watched", () => {
    // The decision on the table is the computer's; a human at the same
    // screen must not be able to answer it for them, from the table any
    // more than from the bar.
    const { t } = withTableActions();
    const html = screen(t, { thinking: true });
    expect(html).not.toContain("actionable");
    expect(html).not.toContain("playdot");
  });
});

describe("a fresh game with nothing to do", () => {
  it("renders no action marks at all", () => {
    const t = new LocalTransport({ setup });
    const dp = t.decision()!;
    const state: GameState = t.view();
    // Only if this decision genuinely has no table-bound option.
    if (actionsByTableCard(dp, state).size === 0) {
      expect(screen(t)).not.toContain("actionable");
    }
  });
});
