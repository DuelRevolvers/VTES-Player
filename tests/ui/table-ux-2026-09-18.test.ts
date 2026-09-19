/**
 * The table's 2026-09-18 pass (docs/table-ux-2026-09-18.md).
 *
 * The five of that pass that live at the TABLE, rather than in the
 * lobby: a stage band that never changes size, the running vote tally in
 * it, the allocation dialog that replaces a column of enumerated splits,
 * the Download button's label, and turn 1 being announced in the log like
 * every other turn. (§§1–2, the deck picker's folds and the bot's die,
 * are markup inside `Shell` and are covered by the build.)
 *
 * `render()` is a pure function of (state, decision), so all of it is
 * asserted on the markup without a DOM.
 */

import { describe, expect, it } from "vitest";
import registry from "../../src/cards/registry.json";
import type { CardRegistry } from "../../src/cards/types.ts";
import type { DecisionPoint, LegalOption } from "../../src/engine/index.ts";
import type { DeckList } from "../../src/ui/decks.ts";
import { buildGame, MIN_CRYPT, MIN_LIBRARY } from "../../src/ui/decks.ts";
import type { RenderInput } from "../../src/ui/render.ts";
import { allocationChoices, allocKey, render } from "../../src/ui/render.ts";
import { narrate } from "../../src/ui/narrate.ts";
import { threeSeatGame } from "../engine/fixtures.ts";

function screen(state: unknown, over: Partial<RenderInput> = {}): string {
  return render({
    state: state as RenderInput["state"],
    dp: null as DecisionPoint | null,
    eventFilter: "",
    canUndo: false,
    canRewind: true,
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

/** A decision whose options are the enumerated splits of `points` among
 *  `seats`, spelled exactly as `compileReferendum` spells them. */
function allocDecision(
  seats: string[],
  splits: Array<Record<string, number>>,
  extra: Record<string, string> = {},
): DecisionPoint {
  const options: LegalOption[] = splits.map((alloc) => {
    const spelled = Object.entries(alloc)
      .map(([s, n]) => `${s}=${n}`)
      .join(",");
    const rest = Object.entries(extra)
      .map(([, v]) => v)
      .join(",");
    return {
      id: rest ? `terms:${rest}:${spelled}` : `terms:${spelled}`,
      kind: "chooseTerms",
      label: rest ? `${rest} gains; allocate ${spelled}` : `Allocate: ${spelled}`,
      params: { ...extra, alloc: spelled },
    };
  });
  return {
    seat: seats[0]!,
    window: "referendum.terms",
    seq: 7,
    options: [...options, { id: "pass", kind: "pass", label: "Pass" } as LegalOption],
  } as DecisionPoint;
}

describe("the stage: a band that never resizes", () => {
  it("is drawn with nothing on the stack at all", () => {
    // THE POINT OF THE WHOLE CHANGE. The strips used to be absent when
    // there was nothing to say, so the table jumped a hundred pixels
    // every time a card was played and back when it resolved.
    const state = threeSeatGame();
    state.frames = state.frames.filter((f) => f.kind === "turn");
    const html = screen(state);
    expect(html).toContain(`class="stage"`);
    expect(html).toContain("stageidle");
    // …and nothing pretending to be a card or a combat inside it.
    expect(html).not.toContain(`class="playstrip"`);
    expect(html).not.toContain(`class="combat"`);
  });

  it("puts the card being played inside the same band, not above it", () => {
    const state = threeSeatGame();
    state.frames.push({
      kind: "cardPlay",
      seat: "Alice",
      minion: null,
      card: { id: "c1", name: "Govern the Unaligned" },
      mode: null,
    } as never);
    const html = screen(state);
    const stageAt = html.indexOf(`class="stage"`);
    const playAt = html.indexOf(`class="playstrip"`);
    expect(stageAt).toBeGreaterThanOrEqual(0);
    expect(playAt).toBeGreaterThan(stageAt);
    // The idle filler is gone the moment there is something to show.
    expect(html).not.toContain("stageidle");
  });
});

describe("the running vote tally", () => {
  const withReferendum = (
    votes: Array<{ seat: string; source: string; count: number; inFavor: boolean }>,
  ): ReturnType<typeof threeSeatGame> => {
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
      votes,
      usedSources: [],
      cycle: { seats: [], index: 0, passes: 0 } as never,
    } as never);
    return state;
  };

  it("shows both totals and which way the referendum is going", () => {
    const html = screen(
      withReferendum([
        { seat: "Alice", source: "m1", count: 3, inFavor: true },
        { seat: "Bob", source: "m2", count: 1, inFavor: false },
      ]),
    );
    expect(html).toContain(`class="clabel">VOTE`);
    expect(html).toContain("Kine Resources Contested");
    expect(html).toContain(`<b class="vfor">3</b>`);
    expect(html).toContain(`<b class="vagainst">1</b>`);
    // "More for than against passes; ties fail" (p. 28) — the same test
    // the engine's tally makes.
    expect(html).toContain("would pass");
    expect(html).toContain("votetot passing");
  });

  it("calls a TIE a failure, which is the rule and not a rounding", () => {
    const html = screen(
      withReferendum([
        { seat: "Alice", source: "m1", count: 2, inFavor: true },
        { seat: "Bob", source: "m2", count: 2, inFavor: false },
      ]),
    );
    expect(html).toContain("would fail");
    expect(html).toContain("votetot failing");
  });

  it("marks the seats that have cast, and lists the ones that have not", () => {
    const html = screen(
      withReferendum([{ seat: "Bob", source: "m2", count: 2, inFavor: false }]),
    );
    // Every standing seat has a pill — a seat with nothing cast is a fact
    // about the vote, not an omission.
    expect(html).toContain(`title="Alice: 0 for, 0 against"`);
    expect(html).toContain(`title="Bob: 0 for, 2 against"`);
    // …but only the one that has voted is lit.
    expect(html).toContain(`class="vseat voted"`);
  });

  it("is absent when no referendum is on the stack", () => {
    // The negative space: a bar that drew itself out of an empty tally
    // would read as "0 for, 0 against" through every turn of the game.
    const state = threeSeatGame();
    state.frames = state.frames.filter((f) => f.kind === "turn");
    expect(screen(state)).not.toContain("votestrip");
  });
});

describe("the allocation dialog", () => {
  const splits = [
    { Bob: 4, Carol: 1 },
    { Bob: 3, Carol: 2 },
    { Bob: 1, Carol: 4 },
  ];

  it("gathers the enumerated splits into one question", () => {
    const [choice, ...rest] = allocationChoices(allocDecision(["Alice"], splits));
    expect(rest).toEqual([]);
    expect(choice!.points).toBe(5);
    expect(choice!.recipients).toEqual(["Bob", "Carol"]);
    // Nothing here BUILDS an option id — a split maps back to the id the
    // engine offered, which is what makes an illegal split unsendable.
    expect(choice!.byAlloc.get(allocKey({ Bob: 3, Carol: 2 }))).toBe("terms:Bob=3,Carol=2");
    expect(choice!.byAlloc.get(allocKey({ Bob: 2, Carol: 3 }))).toBeUndefined();
  });

  it("keeps the OTHER half of the choice separate from the split", () => {
    // "Choose a Methuselah AND allocate N among two or more OTHER
    // Methuselahs" (Reckless Agitation): the beneficiary is a different
    // question and gets its own control, never a spinner.
    const choices = allocationChoices(
      allocDecision(["Alice"], [{ Bob: 3, Carol: 2 }], { chosen: "Alice" }),
    );
    expect(choices).toHaveLength(1);
    expect(choices[0]!.label).toBe("Alice gains");
    expect(choices[0]!.recipients).toEqual(["Bob", "Carol"]);
  });

  it("replaces the column of splits in the bar with one button", () => {
    const dp = allocDecision(["Alice"], splits);
    const html = screen(threeSeatGame(), { dp });
    expect(html).toContain(`id="alloc-open"`);
    expect(html).toContain("Allocate 5 points…");
    // The splits themselves are GONE from the bar — that is the whole
    // request. Anything else is still offered.
    expect(html).not.toContain(`data-opt="terms:Bob=3,Carol=2"`);
    expect(html).toContain(`data-opt="pass"`);
  });

  it("draws a box per recipient, and refuses a split that is not offered", () => {
    const dp = allocDecision(["Alice"], splits);
    const open = (draft: Record<string, number>): string =>
      screen(threeSeatGame(), { dp, allocOpen: true, allocDraft: draft });

    const short = open({ Bob: 1, Carol: 1 });
    expect(short).toContain("Allocate 5 points");
    expect(short).toContain(`data-who="Bob"`);
    expect(short).toContain(`data-who="Carol"`);
    expect(short).toContain("2 of 5 allocated");
    expect(short).toContain(`id="alloc-ok" class="primary" disabled`);

    // The exact number of points, but a split the card does not allow —
    // still refused, and said so, because the ONLY thing that can be
    // confirmed is an option the engine enumerated.
    const wrong = open({ Bob: 5 });
    expect(wrong).toContain("not a legal split");
    expect(wrong).toContain(`id="alloc-ok" class="primary" disabled`);

    const right = open({ Bob: 3, Carol: 2 });
    expect(right).toContain("5 of 5 allocated");
    expect(right).toContain(`id="alloc-ok" class="primary" >`);
  });

  it("offers nothing when the decision has no allocation in it", () => {
    const dp = {
      seat: "Alice",
      window: "turn.master",
      seq: 3,
      options: [{ id: "pass", kind: "pass", label: "Pass" }],
    } as DecisionPoint;
    const html = screen(threeSeatGame(), { dp, allocOpen: true });
    expect(html).not.toContain("alloc-open");
    expect(html).not.toContain("allocmodal");
  });
});

describe("the history controls", () => {
  it("says Download Log, because the file is the whole command log", () => {
    const html = screen(threeSeatGame());
    expect(html).toContain("Download Log");
  });
});

describe("turn 1 in the game log", () => {
  const reg = registry as unknown as CardRegistry;
  const cryptIds = Object.values(reg.entries)
    .filter((e) => e.card.kind === "crypt" && e.supported)
    .map((e) => e.card.id)
    .sort((a, b) => a - b);
  const libraryNames = Object.values(reg.entries)
    .filter((e) => e.card.kind === "library" && e.supported)
    .map((e) => e.card.name)
    .sort();
  const deckFor = (seat: string, offset: number): DeckList => ({
    kind: "deck",
    seat,
    crypt: Array.from({ length: MIN_CRYPT }, (_, i) => ({
      id: cryptIds[(offset * 13 + i) % cryptIds.length]!,
    })),
    library: Array.from(
      { length: MIN_LIBRARY },
      (_, i) => libraryNames[(offset * 71 + i) % libraryNames.length]!,
    ),
  });

  it("is in the log of a freshly dealt game, before anything has happened", () => {
    // The first turn frame is BUILT by `initialState` rather than rotated
    // into, so nothing ever emitted its TurnBegan and the log opened
    // mid-turn without saying whose.
    const state = buildGame({
      decks: ["Alice", "Bob", "Carol"].map((s, i) => deckFor(s, i)),
      seed: 12345,
      maxTurns: 60,
    });
    const first = state.eventLog[0];
    expect(first?.type).toBe("TurnBegan");
    // …and it names the seat that actually has the turn, which after
    // `randomSeating` and the first-Methuselah roll is not seat 0 of the
    // deck list.
    const tf = state.frames.find((f) => f.kind === "turn");
    expect(first).toEqual({
      type: "TurnBegan",
      seat: tf && tf.kind === "turn" ? tf.seat : "",
      turnNumber: 1,
    });
  });

  it("is narrated the way every other turn is", () => {
    const line = narrate(
      { type: "TurnBegan", seat: "Alice", turnNumber: 1 },
      threeSeatGame(),
    );
    expect(line?.text).toBe("— Alice's turn 1 —");
    expect(line?.weight).toBe("major");
  });
});
