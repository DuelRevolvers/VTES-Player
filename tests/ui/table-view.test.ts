/**
 * The table changes from the 2026-09-05 playtest (docs/debug-ui-design.md
 * §11): the seat grid, the thumbnails, the action strip, the ash heap, and
 * a card picker that shows cards.
 */

import { describe, expect, it } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import type { DeckDef, GameSetup } from "../../src/ui/decks.ts";
import type { RenderInput } from "../../src/ui/render.ts";
import { render, seatColumns } from "../../src/ui/render.ts";
import { LocalTransport } from "../../src/ui/transport.ts";

const config = playtestDecks as unknown as {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
};
const setup: GameSetup = { decks: config.decks, seed: config.seed, maxTurns: 60 };
const seats = config.decks.map((d) => d.seat);

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
    aiDelayMs: 0,
    cardTextPx: 15,
    seatFaces: {},
    localSeat: null,
    ashOpen: null,
    canLeave: false,
    ...over,
  });
}

describe("the seat grid", () => {
  it("wraps into two rows — 3 on top and 3 on the bottom at six seats", () => {
    // "It should imitate sitting around a table": half the seats each row,
    // capped at three across so a mat never gets too narrow to read.
    expect(seatColumns(6)).toBe(3);
    expect(seatColumns(5)).toBe(3);
    expect(seatColumns(4)).toBe(2);
    expect(seatColumns(3)).toBe(2);
    expect(seatColumns(2)).toBe(1);
    // ...and never zero columns, whatever it is handed.
    expect(seatColumns(1)).toBe(1);
    expect(seatColumns(0)).toBe(1);
  });

  it("tells the stylesheet how many across", () => {
    const t = new LocalTransport({ setup });
    expect(screen(t)).toContain(`--seat-cols:${seatColumns(seats.length)}`);
  });
});

describe("who is in each seat", () => {
  it("shows a player's own picture and a glyph for a bot", () => {
    const t = new LocalTransport({ setup });
    const html = screen(t, {
      seatFaces: {
        [seats[0]!]: { avatar: "data:image/webp;base64,AAAA", bot: false },
        [seats[1]!]: { avatar: null, bot: true },
      },
    });
    expect(html).toContain('src="data:image/webp;base64,AAAA"');
    expect(html).toContain("seatface bot");
  });

  it("falls back to an initial for a player with no picture", () => {
    const t = new LocalTransport({ setup });
    const html = screen(t, {
      seatFaces: { [seats[0]!]: { avatar: null, bot: false } },
    });
    expect(html).toContain(`>${seats[0]![0]!.toUpperCase()}</span>`);
  });
});

describe("the ash heap", () => {
  /** A whole game, played by agents — a card only reaches an ash heap if
   *  somebody actually plays one, which a walker taking options by index
   *  never gets round to doing. */
  function playedOut(): LocalTransport {
    const t = new LocalTransport({ setup, omniscient: true });
    for (const s of seats) t.setAgent(s, new HeuristicAgent({ seed: 7 }));
    return t;
  }

  it("counts the real zone — CardBurned never fires at all", () => {
    // The count used to be `CardBurned` events divided by the number of
    // seats, and read 0 all game. This is why: burning is one of FOUR ways
    // into the heap and, across an entire game, the one that never
    // happens. `seat.ashHeap` is the zone itself.
    const t = playedOut();
    const state = t.view();
    expect(state.eventLog.filter((e) => e.type === "CardBurned")).toHaveLength(0);

    const total = state.seats.reduce((n, s) => n + (s.ashHeap ?? []).length, 0);
    expect(total, "no card reached an ash heap — the fixture is wrong").toBeGreaterThan(0);

    const html = screen(t);
    for (const s of state.seats) {
      expect(html).toContain(`ASH ${(s.ashHeap ?? []).length}`);
    }
  });

  it("opens for ANY seat — it is a public zone (p. 16)", () => {
    const t = new LocalTransport({ setup });
    const html = screen(t);
    for (const s of seats) expect(html).toContain(`data-ash="${s}"`);
  });

  it("shows the cards, not a list of names", () => {
    const t = playedOut();
    const owner = t.view().seats.find((s) => (s.ashHeap ?? []).length > 0)!;
    const html = screen(t, { ashOpen: owner.id });
    expect(html).toContain('id="ashheap"');
    expect(html).toContain("cardgrid");
    // Every card in the heap is on screen as a card.
    for (const c of owner.ashHeap ?? []) expect(html).toContain(c.name);
  });
});

describe("leaving", () => {
  it("offers Leave only when there is somewhere to go back to", () => {
    const t = new LocalTransport({ setup });
    expect(screen(t, { canLeave: false })).not.toContain('id="leave-btn"');
    expect(screen(t, { canLeave: true })).toContain('id="leave-btn"');
  });
});

describe("the hand", () => {
  it("stays YOUR hand while another seat is deciding", () => {
    const t = new LocalTransport({ setup });
    t.setLocalSeat(seats[1]!);
    // Walk until somebody else is being asked.
    for (let i = 0; i < 200 && t.decision()?.seat === seats[1]; i++) {
      void t.choose(t.decision()!.options[0]!.id);
    }
    const dp = t.decision();
    expect(dp).not.toBeNull();
    expect(dp!.seat).not.toBe(seats[1]);
    const html = screen(t, { localSeat: seats[1]! });
    expect(html).toContain(`${seats[1]}'s hand`);
    // ...and it is marked as not yours to play right now.
    expect(html).toContain("hand watching");
  });
});

describe("the strip across the top of the table", () => {
  /** Alice bleeds Bob, with a modifier on the stack. */
  function midAction(): LocalTransport {
    const t = new LocalTransport({ setup });
    for (let i = 0; i < 200; i++) {
      const dp = t.decision();
      if (!dp) break;
      const bleed = dp.options.find((o) => o.id.startsWith("bleed:"));
      if (bleed) {
        void t.choose(bleed.id);
        break;
      }
      void t.choose((dp.options.find((o) => o.kind === "pass") ?? dp.options[0]!).id);
    }
    return t;
  }

  it("appears while an action is in progress, and not before one", () => {
    const fresh = new LocalTransport({ setup });
    expect(screen(fresh)).not.toContain("playstrip");
    expect(screen(midAction())).toContain("playstrip");
  });

  it("shows the acting minion's stealth and every possible blocker's intercept", () => {
    const t = midAction();
    const html = screen(t);
    // Both numbers, by name — the two that decide whether a block lands.
    expect(html).toContain("stealth ");
    expect(html).toContain("int ");
    // Every ready minion of every OTHER seat is listed: those are the ones
    // that could still be blocking.
    const state = t.view();
    const af = state.frames.find((f) => f.kind === "action");
    expect(af).toBeDefined();
    const others = state.seats
      .filter((s) => s.id !== (af!.kind === "action" ? af!.actingSeat : ""))
      .flatMap((s) => s.minions)
      .filter((m) => !m.inTorpor);
    expect(others.length).toBeGreaterThan(0);
    for (const m of others) expect(html).toContain(m.name);
  });
});
