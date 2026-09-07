/**
 * The rendered table, as a string. `render()` touches no DOM API, so the
 * markup can be asserted headlessly — which matters most for the two things
 * a player would notice immediately: hidden cards leaking, and the hand not
 * being clickable.
 */

import { describe, expect, it } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import registry from "../../src/cards/registry.json";
import type { DecisionPoint, GameState, LegalOption } from "../../src/engine/index.ts";
import type { DeckDef, GameSetup } from "../../src/ui/decks.ts";
import { addChat, clearChat } from "../../src/ui/chat.ts";
import { narrate } from "../../src/ui/narrate.ts";
import {
  CHAT_EMOJI,
  describePlay,
  EMOJI_CATEGORIES,
  orderHand,
  playsByCard,
  render,
} from "../../src/ui/render.ts";
import { RULE_SECTIONS, ruleText, searchRules } from "../../src/ui/rules.ts";
import { AI_SPEEDS } from "../../src/ui/settings.ts";
import { LocalTransport } from "../../src/ui/transport.ts";

const config = playtestDecks as unknown as {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
};
const setup: GameSetup = { decks: config.decks, seed: config.seed, maxTurns: 40 };

function screen(
  opts: {
    omniscient?: boolean;
    selectedCard?: string | null;
    handOrder?: string[];
    settingsOpen?: boolean;
    autoPass?: Record<string, boolean>;
    aiSeats?: Record<string, boolean>;
    helpQuery?: string;
    helpOpen?: boolean;
    helpOpenSections?: string[];
    thinking?: boolean;
    waitingFor?: string | null;
    /** Force the decision the bar is drawn against. `null` is the case a
     *  peer is in on somebody else's turn, and the case a finished game
     *  is in — which is the pair this exists to tell apart. */
    dpOverride?: DecisionPoint | null;
    notices?: import("../../src/ui/transport.ts").LogNotice[];
    finished?: import("../../src/ui/render.ts").FinishedView | null;
    aiDelayMs?: number;
    cardTextPx?: number;
    seatFaces?: Record<string, { avatar: string | null; bot: boolean; label?: string }>;
    localSeat?: string | null;
    ashOpen?: string | null;
    canLeave?: boolean;
    canChat?: boolean;
    /** This client runs the engine — a private table, or an online host.
     *  A guest gets a shorter Settings menu and no Moderation at all. */
    canModerate?: boolean;
    moderation?: { people: Array<{ seat: string; name: string; remote: boolean; banned: boolean }> } | null;
    chatColor?: string;
    chatSettingsOpen?: boolean;
    emojiOpen?: boolean;
    emojiCategory?: string;
    /** Play this many decisions before rendering, so the log has events in
 *  it. A freshly dealt table has none at all. */
    advance?: number;
  } = {},
): string {
  const t = new LocalTransport({ setup, ...(opts.omniscient ? { omniscient: true } : {}) });
  for (let i = 0; i < (opts.advance ?? 0); i++) {
    const dp = t.decision();
    if (!dp) break;
    void t.choose((dp.options.find((o) => o.kind === "pass") ?? dp.options[0]!).id);
  }
  if (opts.localSeat !== undefined) t.setLocalSeat(opts.localSeat);
  return render({
    cardTextPx: opts.cardTextPx ?? 15,
    seatFaces: opts.seatFaces ?? {},
    localSeat: opts.localSeat ?? null,
    ashOpen: opts.ashOpen ?? null,
    canLeave: opts.canLeave ?? false,
    canChat: opts.canChat ?? false,
    // The default is the ordinary case: one person playing bots on their
    // own machine, who IS the authority.
    canModerate: opts.canModerate ?? true,
    moderation: opts.moderation ?? null,
    chatColor: opts.chatColor ?? "#c9a227",
    chatSettingsOpen: opts.chatSettingsOpen ?? false,
    emojiOpen: opts.emojiOpen ?? false,
    emojiCategory: opts.emojiCategory ?? "vtes",
    state: t.view(),
    dp: opts.dpOverride === undefined ? t.decision() : opts.dpOverride,
    eventFilter: "",
    canUndo: false,
    canRewind: true,
    omniscient: opts.omniscient ?? false,
    selectedCard: opts.selectedCard ?? null,
    handOrder: opts.handOrder ?? [],
    settingsOpen: opts.settingsOpen ?? false,
    autoPass: opts.autoPass ?? {},
    aiSeats: opts.aiSeats ?? {},
    thinking: opts.thinking ?? false,
    waitingFor: opts.waitingFor ?? null,
    notices: opts.notices ?? [],
    finished: opts.finished ?? null,
    aiDelayMs: opts.aiDelayMs ?? 0,
    helpQuery: opts.helpQuery ?? "",
    helpOpen: opts.helpOpen ?? false,
    helpOpenSections: opts.helpOpenSections ?? [],
  });
}

describe("the rendered table", () => {
  it("shows other seats' uncontrolled vampires as card backs, not names", () => {
    const t = new LocalTransport({ setup });
    const seat = t.decision()!.seat;
    const html = screen();

    // Every other seat's uncontrolled vampire is a back.
    expect(html).toContain("cardback");
    for (const deck of config.decks) {
      if (deck.seat === seat) continue;
      // Their uncontrolled vampire's name must not be anywhere on screen.
      const hidden = t.view().seats.find((s) => s.id === deck.seat)!;
      expect(hidden.uncontrolled.every((u) => u.card.name === "")).toBe(true);
    }
  });

  it("reveals them again with the debug toggle on", () => {
    expect(screen({ omniscient: true })).not.toContain("cardback");
  });

  it("makes playable hand cards clickable and draggable", () => {
    const t = new LocalTransport({ setup });
    const plays = playsByCard(t.decision());
    const html = screen();

    expect(html).toContain("handslot");
    if (plays.size > 0) {
      // A card with a legal play is lit, draggable, and carries its id.
      expect(html).toContain("handslot playable");
      expect(html).toContain('draggable="true"');
      for (const cardId of plays.keys()) expect(html).toContain(`data-card="${cardId}"`);
    }
  });

  it("keeps card plays off the top bar — they belong on the cards", () => {
    const t = new LocalTransport({ setup });
    const dp = t.decision()!;
    const cardPlays = dp.options.filter((o) => o.kind === "playCard");
    const html = screen();
    for (const o of cardPlays) {
      // The option id appears in the hand menu, never as a top-bar button.
      expect(html).not.toContain(`<button class="opt playCard" data-opt="${o.id}"`);
    }
  });

  it("gives minions and mats drop-target handles", () => {
    const html = screen();
    expect(html).toMatch(/data-minion="/);
    expect(html).toMatch(/data-seat="/);
  });

  it("puts the action bar BELOW the hand, not at the top of the screen", () => {
    const html = screen();
    const hand = html.indexOf('class="hand"');
    const actions = html.indexOf('class="decision"');
    const table = html.indexOf('class="table"');
    expect(hand).toBeGreaterThan(-1);
    expect(actions).toBeGreaterThan(-1);
    // Table, then hand, then the buttons that act on it.
    expect(hand).toBeGreaterThan(table);
    expect(actions).toBeGreaterThan(hand);
  });

  it("keeps the header to the turn readout and the controls", () => {
    const html = screen();
    const top = html.slice(html.indexOf('class="top"'), html.indexOf('class="main"'));
    expect(top).toContain("turnstatus");
    expect(top).toContain('id="settings-btn"');
    // The option buttons are not up here any more.
    expect(top).not.toContain("button class=\"opt");
  });

  it("makes every hand card draggable, not just the playable ones", () => {
    const t = new LocalTransport({ setup });
    const seat = t.view().seats.find((s) => s.id === t.decision()!.seat)!;
    const html = screen();
    // Sorting your hand must work on cards you cannot play right now.
    const slots = html.match(/class="handslot[^"]*"[^>]*/g) ?? [];
    expect(slots.length).toBe(seat.hand.length);
    for (const slot of slots) expect(slot).toContain('draggable="true"');
  });
});

describe("hand order", () => {
  it("is applied to the rendered hand", () => {
    const t = new LocalTransport({ setup });
    const seat = t.view().seats.find((s) => s.id === t.decision()!.seat)!;
    const ids = seat.hand.map((c) => c.id);
    // Reverse the hand and check the markup follows.
    const reversed = [...ids].reverse();
    const html = screen({ handOrder: reversed });
    const rendered = (html.match(/data-card="([^"]+)"/g) ?? []).map((m) =>
      m.slice('data-card="'.length, -1),
    );
    expect(rendered).toEqual(reversed);
  });

  it("reconciles in both directions: drawn cards go last, gone cards drop out", () => {
    const hand = [{ id: "c" }, { id: "a" }, { id: "d" }];
    // Order remembers b (played since) and knows nothing of d (just drawn).
    expect(orderHand(hand, ["a", "b", "c"]).map((c) => c.id)).toEqual(["a", "c", "d"]);
  });

  it("leaves the hand alone when no order has been expressed", () => {
    const hand = [{ id: "x" }, { id: "y" }];
    expect(orderHand(hand, [])).toBe(hand);
  });
});

describe("the settings menu", () => {
  it("is closed until asked for", () => {
    expect(screen()).not.toContain('id="settings"');
    expect(screen({ settingsOpen: true })).toContain('id="settings"');
  });

  it("offers auto-pass per seat, unchecked by default", () => {
    const html = screen({ settingsOpen: true });
    for (const deck of config.decks) {
      expect(html).toContain(`class="autopass-seat" data-seat="${deck.seat}"`);
    }
    // Default off: nobody is skipped unless a seat opts in.
    expect(html).not.toContain("checked");
  });

  it("checks 'all seats' only when every seat is on", () => {
    const seats = config.decks.map((d) => d.seat);
    const some = { [seats[0]!]: true };
    const all = Object.fromEntries(seats.map((s) => [s, true]));
    const allBox = (html: string): string =>
      html.slice(html.indexOf('id="autopass-all"'), html.indexOf('id="autopass-all"') + 60);
    expect(allBox(screen({ settingsOpen: true, autoPass: some }))).not.toContain("checked");
    expect(allBox(screen({ settingsOpen: true, autoPass: all }))).toContain("checked");
  });

  it("holds the debug reveal, which is no longer a top-bar control", () => {
    expect(screen()).not.toContain('id="omni"');
    expect(screen({ settingsOpen: true })).toContain('id="omni"');
  });

  /**
   * A GUEST at somebody else's table gets a shorter menu, and each cut is
   * something they have no business with rather than something merely
   * unhelpful: auto-pass for another seat answers for a person who is
   * sitting right there, and the debug reveal would show them every hand
   * at the table.
   */
  it("shows a guest only their own auto-pass row, and no debug reveal", () => {
    const seats = config.decks.map((d) => d.seat);
    const html = screen({ settingsOpen: true, canModerate: false, localSeat: seats[0]! });
    expect(html).toContain(`class="autopass-seat" data-seat="${seats[0]}"`);
    for (const id of seats.slice(1)) {
      expect(html).not.toContain(`class="autopass-seat" data-seat="${id}"`);
    }
    // No "all seats", nothing to apply it to.
    expect(html).not.toContain('id="autopass-all"');
    expect(html).not.toContain('id="omni"');
    // The AI controls are the host's, and they are not merely disabled.
    expect(html).not.toContain("ai-seat");
    expect(html).not.toContain('id="aispeed"');
  });

  it("keeps the whole menu for the authority", () => {
    const html = screen({ settingsOpen: true, canModerate: true });
    for (const deck of config.decks) {
      expect(html).toContain(`class="autopass-seat" data-seat="${deck.seat}"`);
    }
    expect(html).toContain('id="autopass-all"');
    expect(html).toContain('id="omni"');
  });
});

/**
 * THE AI CONTROLS LIVE IN MODERATION, not in Settings (owner request).
 * Handing a seat to the computer is the same kind of act as kicking
 * somebody to a bot — it changes who answers for that seat — where
 * everything left in Settings is about this screen and this player.
 */
describe("moderation", () => {
  const mod = { people: [] };

  it("is closed until asked for", () => {
    expect(screen()).not.toContain('id="mod-panel"');
    expect(screen({ moderation: mod })).toContain('id="mod-panel"');
  });

  it("offers an AI toggle per seat, checked for the seats an AI plays", () => {
    const seats = config.decks.map((d) => d.seat);
    const html = screen({ moderation: mod, aiSeats: { [seats[1]!]: true } });
    for (const id of seats) {
      expect(html).toContain(`class="ai-seat" data-seat="${id}"`);
    }
    // Only the AI-driven one is checked. Sliced to that row, because the
    // auto-pass rows carry the same seat names.
    const row = (id: string): string => {
      const at = html.indexOf(`class="ai-seat" data-seat="${id}"`);
      return html.slice(at, at + 90);
    };
    expect(row(seats[1]!)).toContain("checked");
    expect(row(seats[0]!)).not.toContain("checked");
  });

  it("offers an AI pace, with the current one selected", () => {
    const html = screen({ moderation: mod, aiDelayMs: 900 });
    expect(html).toContain('id="aispeed"');
    for (const s of AI_SPEEDS) expect(html).toContain(`value="${s.ms}"`);
    const chosen = (h: string, ms: number): boolean =>
      h.slice(h.indexOf(`value="${ms}"`), h.indexOf(`value="${ms}"`) + 30).includes("selected");
    expect(chosen(html, 900)).toBe(true);
    expect(chosen(html, 0)).toBe(false);
    expect(chosen(html, 1800)).toBe(false);
  });

  it("is not in the settings menu any more", () => {
    const settings = screen({ settingsOpen: true });
    expect(settings).not.toContain("ai-seat");
    expect(settings).not.toContain('id="aispeed"');
  });

  it("is reached from the top bar, beside How to Play and Settings", () => {
    const html = screen();
    const top = html.slice(html.indexOf('class="top"'), html.indexOf('class="main"'));
    expect(top).toContain('id="mod-btn"');
    expect(top).toContain("Moderation");
    // A guest has nothing to moderate WITH, so the button is absent
    // rather than present and refusing.
    const guest = screen({ canModerate: false });
    expect(guest.slice(guest.indexOf('class="top"'), guest.indexOf('class="main"'))).not.toContain(
      'id="mod-btn"',
    );
  });

  /**
   * ONE ROW PER SEAT, not one per connection: the panel's subject is who
   * answers for each seat, and listing connections left the host and every
   * bot off it entirely.
   */
  it("lists every seat at the table, bot or person", () => {
    const seats = config.decks.map((d) => d.seat);
    const html = screen({ moderation: mod });
    const rows = html.match(/class="modrow"/g) ?? [];
    expect(rows.length).toBe(seats.length);
  });

  it("greys out the AI box for the host's own seat and for an online player", () => {
    const seats = config.decks.map((d) => d.seat);
    const html = screen({
      localSeat: seats[0]!,
      moderation: {
        people: [{ seat: seats[1]!, name: "Bea", remote: true, banned: false }],
      },
    });
    const box = (id: string): string => {
      const at = html.indexOf(`class="ai-seat" data-seat="${id}"`);
      return html.slice(at, at + 120);
    };
    // Your own seat: you are sitting in it.
    expect(box(seats[0]!)).toContain("disabled");
    // A seat somebody is playing: kick them first, which hands it over.
    expect(box(seats[1]!)).toContain("disabled");
    // A bot seat is the case the box exists for — the control, without
    // which the two above would pass on a panel that disabled everything.
    expect(box(seats[2]!)).not.toContain("disabled");
  });

  it("offers kick and ban for an online player, and neither for a bot", () => {
    const seats = config.decks.map((d) => d.seat);
    const html = screen({
      moderation: { people: [{ seat: seats[1]!, name: "Bea", remote: true, banned: false }] },
    });
    expect(html).toContain(`class="mod-kick danger" data-seat="${seats[1]}"`);
    expect(html).toContain(`class="mod-ban" data-seat="${seats[1]}"`);
    // Nothing to kick on a bot's row.
    expect(html).not.toContain(`data-seat="${seats[2]}">Kick`);
    expect(html).not.toContain(`class="mod-kick danger" data-seat="${seats[2]}"`);
  });

  it("says Unban for somebody already banned", () => {
    const seats = config.decks.map((d) => d.seat);
    const html = screen({
      moderation: { people: [{ seat: seats[1]!, name: "Bea", remote: true, banned: true }] },
    });
    const at = html.indexOf(`class="mod-ban" data-seat="${seats[1]}"`);
    expect(html.slice(at, at + 80)).toContain("Unban");
  });
});

/**
 * While an AI's move is held back so it can be watched, the decision on the
 * table is the AI's. Nothing on screen may offer to answer it: a human at
 * the same screen would be playing the computer's seat for it.
 */
describe("an AI's turn to think", () => {
  it("says who is deciding instead of offering their options", () => {
    const playing = screen();
    expect(playing).toContain('class="opt ');
    expect(playing).not.toContain("is deciding");

    const paused = screen({ thinking: true });
    expect(paused).toContain("is deciding");
    // No option buttons anywhere — not in the bar, not on a hand card.
    expect(paused).not.toContain('class="opt ');
  });

  it("lights no card in the hand it is showing", () => {
    // The hand on screen during a pause belongs to the seat being asked,
    // drawn face down. Its plays are not the watcher's to make.
    expect(screen()).toContain("playable");
    expect(screen({ thinking: true })).not.toContain('class="handslot playable');
  });

  it("still names the seat, so the pause is legible rather than a freeze", () => {
    const t = new LocalTransport({ setup });
    const seat = t.decision()!.seat;
    expect(screen({ thinking: true })).toContain(seat);
  });
});

/**
 * SOMEBODY ELSE'S DECISION (owner reports 2026-09-07, two of them, and
 * one statement).
 *
 *  - "The Host player still has action buttons during other player's
 *    turns … It's allowing the host to progress other player's turn
 *    phases." The host RUNS the engine, so it holds a live option list
 *    for every seat at the table, its guests' included.
 *  - "During the off-turns of non-host online players, the action bar
 *    says Game over — no decision pending." A peer is sent no
 *    DecisionPoint unless the decision is theirs, so `dp` is null through
 *    everybody else's turn — indistinguishable, to the bar, from a game
 *    that has actually ended.
 */
describe("a decision this client may not answer", () => {
  it("names who is deciding and offers nothing, exactly as an AI pause does", () => {
    const waiting = screen({ waitingFor: "Bob" });
    expect(waiting).toContain("Bob");
    expect(waiting).toContain("is deciding");
    // The whole of the host's half of the bug: no buttons, in the bar or
    // on the table.
    expect(waiting).not.toContain('class="opt ');
    expect(waiting).not.toContain('class="handslot playable');
  });

  it("does NOT say the game is over — the peer's half of the bug", () => {
    // With no decision at all, which is exactly the peer's case.
    const off = screen({ dpOverride: null, waitingFor: "Bob" });
    expect(off).not.toContain("Game over");
    expect(off).toContain("is deciding");
  });

  it("still says Game over when the game really is over", () => {
    // The control. Without this the fix could be "never say game over",
    // which reads identically on every screenshot of a live game.
    const over = screen({ dpOverride: null });
    expect(over).toContain("Game over");
    expect(over).not.toContain("is deciding");
  });
});

/**
 * The hand's label: the seat's name, and the sorting hint UNDER it rather
 * than beside it, with no em dash (owner request 2026-09-07).
 */
describe("the hand label", () => {
  it("puts the hint in its own element and drops the dash", () => {
    const html = screen();
    expect(html).toContain('class="hname"');
    expect(html).toContain('class="dim hhint"');
    // The dash is what was actually asked about, so pin its absence
    // rather than the presence of the words around it.
    expect(html).not.toContain("hand\n        <span class=\"dim\">—");
    expect(/hhint">\s*—/.test(html)).toBe(false);
  });
});

/**
 * A line in the log that is not an engine event — a seat changing hands.
 * In the GAME LOG, not the table chat (owner request 2026-09-07).
 */
describe("log notices", () => {
  it("draws them in the log, marked as not being game events", () => {
    const html = screen({ notices: [{ text: "Bea was removed by the host", afterEvent: 0 }] });
    expect(html).toContain('class="ev notice"');
    expect(html).toContain("Bea was removed by the host");
  });

  it("draws nothing when there are none", () => {
    // A filter that matches nothing and a filter that is broken look
    // identical; this is the negative space for the one above.
    expect(screen()).not.toContain('class="ev notice"');
  });
});

/**
 * The end-of-game prompt (owner request 2026-09-07): every player is asked
 * whether the game goes on their leaderboard, and either answer takes them
 * back to the main menu.
 */
describe("the end-of-game prompt", () => {
  const finished = {
    winner: "Alice",
    standings: [
      { seat: "Alice", victoryPoints: 2, ousted: false },
      { seat: "Bob", victoryPoints: 0, ousted: true },
    ],
  };

  it("offers both answers and names the winner", () => {
    const html = screen({ finished });
    expect(html).toContain('id="over-save"');
    expect(html).toContain('id="over-discard"');
    expect(html).toContain("Alice wins");
  });

  it("says A DRAW rather than naming nobody as the winner", () => {
    // The turn cap is an engine safeguard, not a rule, and it produces a
    // real draw — which must not render as "  wins".
    expect(screen({ finished: { ...finished, winner: null } })).toContain("A draw");
  });

  it("is absent while the game is running", () => {
    expect(screen()).not.toContain('id="over-save"');
  });
});

/**
 * The chooser that opens on a clicked hand card. The engine's own label is
 * built for a log and an option id — jargon and raw ids — and a player has
 * to read this one at speed.
 */
describe("the play chooser", () => {
  /** Play on until some seat has a card offering more than one play. */
  function findChoice(): { state: GameState; plays: LegalOption[] } | null {
    const t = new LocalTransport({ setup });
    for (let i = 0; i < 3000; i++) {
      const dp = t.decision();
      if (!dp) break;
      for (const [, plays] of playsByCard(dp)) {
        if (plays.length > 0) return { state: t.view(), plays };
      }
      void t.choose(dp.options[(i * 7 + 3) % dp.options.length]!.id);
    }
    return null;
  }

  it("says Basic and Superior, never the option id's jargon", () => {
    const found = findChoice();
    expect(found).not.toBeNull();
    for (const o of found!.plays) {
      const d = describePlay(o, found!.state);
      expect(d.main).not.toContain("(");
      if (o.kind === "playCard" && o.mode) {
        expect(["Basic", "Superior"].some((w) => d.main.startsWith(w))).toBe(true);
      }
    }
  });

  it("names minions and Methuselahs instead of printing their ids", () => {
    const t = new LocalTransport({ setup, omniscient: true });
    const state = t.view();
    const minion = state.seats.flatMap((s) => s.minions)[0]!;
    const play: LegalOption = {
      id: "play:X:basic:V1:t:c1",
      kind: "playCard",
      label: "X (basic) — someone",
      card: "c1",
      name: "X",
      minion: minion.id,
      mode: "basic",
      params: { target: minion.id },
    };
    const d = describePlay(play, state);
    expect(d.detail).toContain(minion.name);
    // The id itself must not survive into the line a player reads.
    expect(d.detail).not.toContain(minion.id);
    // ...and it says whose minion it is, which is the whole question when
    // two seats have a vampire of the same name.
    const owner = state.seats.find((s) => s.minions.some((m) => m.id === minion.id))!;
    expect(d.detail).toContain(owner.id);
  });

  it("keeps a hand-written label, minus the card name you just clicked", () => {
    const t = new LocalTransport({ setup, omniscient: true });
    const play: LegalOption = {
      id: "play:Giant's Blood:-:V1:c1",
      kind: "playCard",
      label: "Giant's Blood — fill Muhsin Samir to capacity",
      card: "c1",
      name: "Giant's Blood",
      minion: null,
      mode: null,
      params: {},
    };
    // Prose the structured fields cannot express is not thrown away...
    expect(describePlay(play, t.view()).main).toBe("fill Muhsin Samir to capacity");
  });
});

describe("the game log", () => {
  it("reads as sentences, not field dumps", () => {
    const t = new LocalTransport({ setup });
    // Play a while so the log has something in it.
    const dp = () => t.decision();
    for (let i = 0; i < 40 && dp(); i++) void t.choose(dp()!.options[0]!.id);

    const state = t.view();
    expect(state.eventLog.length).toBeGreaterThan(0);
    for (const ev of state.eventLog) {
      const line = narrate(ev, state);
      if (!line) continue;
      // A sentence: real words, and no raw camelCase event name left in it.
      expect(line.text.length).toBeGreaterThan(3);
      expect(line.text).not.toMatch(/[a-z][A-Z]/);
      expect(line.text).toMatch(/[.!—]$/);
    }
  });

  it("names minions rather than printing their ids", () => {
    const t = new LocalTransport({ setup });
    for (let i = 0; i < 30 && t.decision(); i++) {
      void t.choose(t.decision()!.options[0]!.id);
    }
    const state = t.view();
    const lines = state.eventLog.map((ev) => narrate(ev, state)?.text ?? "");
    const joined = lines.join("\n");
    // Fixture ids look like "Alice-v0"; a real name must appear instead.
    expect(joined).not.toMatch(/Alice-v\d/);
    expect(joined).toMatch(/Andi Liu|Gelasia|Alexa Draper/);
  });

  it("never names a card the viewer may not see", () => {
    const t = new LocalTransport({ setup });
    for (let i = 0; i < 60 && t.decision(); i++) {
      void t.choose(t.decision()!.options[0]!.id);
    }
    const seat = t.decision()?.seat;
    const state = t.view();
    const joined = state.eventLog.map((ev) => narrate(ev, state)?.text ?? "").join("\n");
    // Another seat's library cards must not surface through the log.
    for (const deck of config.decks) {
      if (deck.seat === seat) continue;
      for (const name of new Set(deck.library)) {
        // A card that has been PLAYED is public, so only assert on cards
        // still hidden in that seat's hand or library.
        const played = state.eventLog.some(
          (ev) => ev.type === "CardPlayed" && ev.name === name,
        );
        const inPlay = state.seats.some((s) =>
          s.permanents.some((p) => p.card.name === name),
        );
        if (!played && !inPlay) expect(joined).not.toContain(name);
      }
    }
  });
});

/** Markup with its whitespace collapsed, the way a browser reads it — so a
 *  sentence can be asserted without depending on where the source wraps. */
const flat = (html: string): string => html.replace(/\s+/g, " ");

describe("the How to Play panel", () => {
  it("is closed until asked for, and opens from the header button", () => {
    expect(screen()).toContain(`id="help-btn"`);
    // Closed: no dialog, and none of the rules text on screen.
    expect(screen()).not.toContain(`id="help"`);
    expect(screen()).not.toContain("Object of the game");

    const open = screen({ helpOpen: true });
    expect(open).toContain(`id="help"`);
    expect(open).toContain(`id="help-close"`);
    expect(open).toContain(`id="help-scrim"`);
  });

  it("renders every rule section, each with its rulebook citation", () => {
    const html = screen({ helpOpen: true });
    for (const s of RULE_SECTIONS) {
      expect(html).toContain(`data-rule="${s.id}"`);
      expect(html).toContain(s.title);
      if (s.pages) expect(html).toContain(s.pages);
    }
    // The rules a player is most likely to mistake for a client bug.
    // Prose is asserted against `flat`, since the source wraps its lines
    // and the browser collapses that whitespace back out.
    expect(flat(html)).toContain("Only when needed");
    expect(flat(html)).toContain("the card takes precedence");
  });

  it("carries the Dark Pack and KRCG attribution", () => {
    const html = flat(screen({ helpOpen: true }));
    expect(html).toContain("Dark Pack");
    expect(html).toContain("Paradox Interactive");
    expect(html).toContain("KRCG");
  });

  it("expands only the sections the player opened", () => {
    const html = screen({ helpOpen: true, helpOpenSections: ["combat"] });
    expect(html).toMatch(/data-rule="combat"\s+open/);
    expect(html).not.toMatch(/data-rule="turn"\s+open/);
  });
});

describe("searching the rules", () => {
  it("offers a search box, empty by default and showing everything", () => {
    const html = screen({ helpOpen: true });
    expect(html).toContain('id="help-search"');
    for (const s of RULE_SECTIONS) expect(html).toContain(`data-rule="${s.id}"`);
  });

  it("narrows to the sections that match, and says how many", () => {
    const html = screen({ helpOpen: true, helpQuery: "torpor" });
    const shown = RULE_SECTIONS.filter((s) => html.includes(`data-rule="${s.id}"`));
    // Something matches, and NOT everything — a filter that keeps every
    // section is a filter that is not running.
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(RULE_SECTIONS.length);
    expect(flat(html)).toContain(`of ${RULE_SECTIONS.length} sections match`);
  });

  it("requires EVERY term, so two words narrow further than one", () => {
    const one = searchRules("block");
    const two = searchRules("block stealth");
    expect(one.length).toBeGreaterThan(0);
    expect(two.length).toBeLessThanOrEqual(one.length);
    for (const s of two) expect(one).toContain(s);
  });

  it("is case-insensitive", () => {
    expect(searchRules("TORPOR").map((s) => s.id)).toEqual(
      searchRules("torpor").map((s) => s.id),
    );
  });

  it("searches the TEXT, not the markup", () => {
    // Searching the raw body would make "b" match every bold run and "li"
    // every list item, which is worse than useless.
    expect(searchRules("li").length).toBeLessThan(RULE_SECTIONS.length);
    expect(ruleText(RULE_SECTIONS[0]!)).not.toContain("<");
  });

  it("highlights the hits, and opens the matching sections", () => {
    const html = screen({ helpOpen: true, helpQuery: "torpor" });
    expect(html).toContain("<mark>");
    // Every shown section is open: the player is looking for a phrase,
    // not a heading.
    for (const s of searchRules("torpor")) {
      expect(html).toMatch(new RegExp(`data-rule="${s.id}"[^>]*open`));
    }
  });

  it("does not corrupt the markup it highlights", () => {
    // The body is authored HTML; highlighting must skip tags. A naive
    // replace on "p" would rewrite every <p> into <<mark>p</mark>>.
    const html = screen({ helpOpen: true, helpQuery: "p" });
    expect(html).not.toContain("<<mark>");
    expect(html).not.toContain("<mark>p</mark>>");
  });

  it("says so plainly when nothing matches", () => {
    const html = screen({ helpOpen: true, helpQuery: "zzzznotarule" });
    expect(flat(html)).toContain("Nothing matches");
    for (const s of RULE_SECTIONS) expect(html).not.toContain(`data-rule="${s.id}"`);
  });

  it("keeps what the player typed in the box", () => {
    expect(screen({ helpOpen: true, helpQuery: "bleed" })).toContain('value="bleed"');
  });
});

describe("the rules cover the vocabulary the CARDS use", () => {
  /**
   * A player searching How to Play is usually searching a word they just
   * read on a card. This walks the printed sub-type and keyword lines in
   * the real pool — the short "Unique location." / "Grapple." / "Melee
   * weapon." lines VTES prints above the card text — and requires each
   * one to be findable.
   *
   * It is a STANDING guard rather than a fixed list: widening the pool
   * (phase 8) will add sub-types, and this fails until they are written
   * up rather than letting the panel quietly fall behind the cards.
   */
  function printedTypeWords(): string[] {
    const words = new Set<string>();
    const entries = registry.entries as Record<string, { card: { cardText?: string } }>;
    for (const key of Object.keys(entries)) {
      const card = entries[key]!.card;
      for (const line of (card.cardText ?? "").split("\n")) {
        const t = line.trim();
        // A sub-type/keyword line: short, capitalised, ends in a period.
        if (!/^[A-Z][A-Za-z' -]{2,28}\.$/.test(t)) continue;
        if (t.split(" ").length > 3) continue;
        for (const w of t.replace(/\.$/, "").split(/\s+/)) {
          // Skip the connective words and the ones that are titles or
          // sects, covered by their own sections.
          if (w.length > 2) words.add(w.toLowerCase());
        }
      }
    }
    return [...words].sort();
  }

  it("names every printed sub-type and keyword in the pool", () => {
    const hay = RULE_SECTIONS.map(ruleText).join(" ").toLowerCase();
    const missing = printedTypeWords().filter((w) => !hay.includes(w));
    expect(missing).toEqual([]);
  });

  it("…and that list is not empty, or the check proves nothing", () => {
    // The negative-space half: a regex that matched no lines would make
    // the assertion above pass vacuously. Note this detector finds only
    // WHOLE-LINE sub-types ("Unique location."); a keyword like
    // "Grapple." leads a longer sentence and is asserted below instead.
    const words = printedTypeWords();
    expect(words.length).toBeGreaterThan(10);
    expect(words).toContain("location");
    expect(words).toContain("weapon");
  });

  it("covers the words this client rules on that the RULEBOOK does not", () => {
    // Stun, frenzy, wraith, zombie and Path appear nowhere in the V5
    // rulebook — they are card vocabulary, and a player will still search
    // for them. They live in their own clearly-labelled section so a
    // future editor can tell a summary from an invention.
    const hay = RULE_SECTIONS.map(ruleText).join(" ").toLowerCase();
    for (const w of ["stun", "frenzy", "wraith", "zombie", "path", "corruption"]) {
      expect(hay).toContain(w);
    }
    // The printed KEYWORDS, which lead a longer line and so are not
    // caught by the whole-line detector above.
    for (const w of ["grapple", "aim", "boon"]) expect(hay).toContain(w);
    const cardWords = RULE_SECTIONS.find((s) => s.id === "cardwords");
    expect(cardWords).toBeDefined();
    expect(ruleText(cardWords!)).toContain("do not appear in it at all");
  });
});

/**
 * PREY AND PREDATOR ON THE MAT (owner request, twice).
 *
 * p. 15: your prey is on your left, your predator on your right — and it
 * MOVES: "when your prey is ousted, the next Methuselah to your left
 * becomes your new prey". So it is read through `preyOf`/`predatorOf`
 * rather than off the seat array, and the oust case is what proves it.
 */
describe("who is whose prey", () => {
  it("names each seat's prey and predator beside their name", () => {
    const html = screen();
    const seats = config.decks.map((d) => d.seat);
    // Three seats in a cycle: the first bleeds the second, the third
    // bleeds the first.
    const mat = (id: string): string => {
      const at = html.indexOf(`data-seat="${id}"`);
      return html.slice(at, at + 600);
    };
    expect(mat(seats[0]!)).toContain(`prey ${seats[1]}`);
    expect(mat(seats[0]!)).toContain(`predator ${seats[seats.length - 1]}`);
  });

  it("follows an oust rather than reading the seating order", () => {
    const t = new LocalTransport({ setup });
    const state = t.view();
    const seats = state.seats.map((s) => s.id);
    // Oust the middle seat: the first Methuselah's prey becomes the third.
    const victim = state.seats.find((s) => s.id === seats[1]!)!;
    victim.ousted = true;
    const html = render({
      cardTextPx: 15, seatFaces: {}, localSeat: null, ashOpen: null,
      canLeave: false, canChat: false, canModerate: true, moderation: null,
      chatColor: "#c9a227", chatSettingsOpen: false, emojiOpen: false, emojiCategory: "vtes",
      state, dp: t.decision(), eventFilter: "", canUndo: false, canRewind: true,
      omniscient: false, selectedCard: null, handOrder: [], settingsOpen: false,
      helpOpen: false, helpOpenSections: [], helpQuery: "", autoPass: {},
      aiSeats: {}, thinking: false, waitingFor: null, notices: [], finished: null, aiDelayMs: 0,
    });
    const at = html.indexOf(`data-seat="${seats[0]}"`);
    expect(html.slice(at, at + 600)).toContain(`prey ${seats[2]}`);
    // …and the ousted seat is named as nobody's neighbour on its own mat.
    const out = html.indexOf(`data-seat="${seats[1]}"`);
    expect(html.slice(out, out + 600)).not.toContain("predator");
  });
});

/**
 * Sorting your hand off-turn WORKS and always did; what was missing was
 * any sign of it. Reported twice as a missing feature, which is the
 * auto-pass shape: a feature that cannot be discovered is indistinguishable
 * from one that is absent.
 */
describe("the hand while you are not being asked", () => {
  it("says it can still be sorted", () => {
    const seats = config.decks.map((d) => d.seat);
    const other = seats.find((s) => s !== new LocalTransport({ setup }).decision()?.seat)!;
    const html = screen({ localSeat: other });
    const hand = html.slice(html.indexOf('class="hand watching"'));
    expect(hand).toContain("drag to sort");
    // …and the cards really are draggable, or the label would be a lie.
    expect(hand).toContain('draggable="true"');
    // The control: nothing in it is lit as playable.
    const strip = hand.slice(0, hand.indexOf('id="ashheap"') + 1 || undefined);
    expect(strip).not.toContain('handslot playable');
  });
});

/**
 * The chat's own settings (owner request 2026-09-06): a colour for your
 * name, reachable from a gear beside the title AND from the profile page,
 * because it is ONE value on the profile with two ways in.
 */
describe("chat settings and emoji", () => {
  const withChat = { canChat: true } as const;

  it("puts a gear beside the Table chat title", () => {
    const html = screen(withChat);
    expect(html).toContain('id="chat-gear"');
    // Closed until asked for.
    expect(html).not.toContain('id="chatcolor"');
    expect(screen({ ...withChat, chatSettingsOpen: true })).toContain('id="chatcolor"');
  });

  it("shows the colour wheel with the player's current colour", () => {
    const html = screen({ ...withChat, chatSettingsOpen: true, chatColor: "#3366ff" });
    const at = html.indexOf('id="chatcolor"');
    const box = html.slice(at - 60, at + 60);
    expect(box).toContain('type="color"');
    expect(box).toContain("#3366ff");
  });

  it("hides the emoji pad until the button is pressed", () => {
    expect(screen(withChat)).toContain('id="chatemoji"');
    expect(screen(withChat)).not.toContain('id="emojipad"');
    expect(screen({ ...withChat, emojiOpen: true })).toContain('id="emojipad"');
  });

  /**
   * The categorised picker (owner request 2026-09-07: "the full range of
   * emojis separated by categories … tabs at the bottom of the emoji
   * picker for the separate categories").
   */
  describe("the emoji picker", () => {
    it("draws one category's emoji, with a tab for every category", () => {
      const open = screen({ ...withChat, emojiOpen: true, emojiCategory: "vtes" });
      const vtes = EMOJI_CATEGORIES.find((c) => c.id === "vtes")!;
      for (const e of vtes.emoji) expect(open).toContain(`data-emoji="${e}"`);
      for (const c of EMOJI_CATEGORIES) expect(open).toContain(`data-emojicat="${c.id}"`);
    });

    it("shows the OTHER categories' emoji only when their tab is picked", () => {
      // The negative space, and the whole point of tabs: a pad that drew
      // every category at once would pass the test above and would not be
      // a picker with categories at all.
      const flags = EMOJI_CATEGORIES.find((c) => c.id === "flags")!;
      const onVtes = screen({ ...withChat, emojiOpen: true, emojiCategory: "vtes" });
      expect(onVtes).not.toContain(`data-emoji="${flags.emoji[0]!}"`);
      const onFlags = screen({ ...withChat, emojiOpen: true, emojiCategory: "flags" });
      expect(onFlags).toContain(`data-emoji="${flags.emoji[0]!}"`);
    });

    it("marks the open tab, and only that one", () => {
      const open = screen({ ...withChat, emojiOpen: true, emojiCategory: "food" });
      expect((open.match(/class="emojitab on"/g) ?? []).length).toBe(1);
      expect(open).toMatch(/class="emojitab on"[^>]*data-emojicat="food"/);
    });

    it("puts the tabs BELOW the grid", () => {
      const open = screen({ ...withChat, emojiOpen: true });
      expect(open.indexOf("emojitabs")).toBeGreaterThan(open.indexOf("emojigrid"));
    });

    it("offers every emoji across the categories, with no duplicates", () => {
      // CHAT_EMOJI is "what may be inserted", so it is the union of the
      // tabs with the overlap removed — the Vampire tab is deliberately a
      // shortcut to emoji that also live in Objects and Symbols, which is
      // right for the tabs and meaningless in a set.
      expect(CHAT_EMOJI.length).toBe(new Set(CHAT_EMOJI).size);
      expect(CHAT_EMOJI.length).toBeGreaterThan(300);
      for (const c of EMOJI_CATEGORIES) {
        for (const e of c.emoji) expect(CHAT_EMOJI).toContain(e);
      }
    });

    it("has no duplicate WITHIN a tab — two identical buttons side by side", () => {
      // Across tabs the overlap is deliberate; inside one it is a typo,
      // and it would draw two buttons that look and behave identically.
      for (const c of EMOJI_CATEGORIES) {
        expect(c.emoji.length, `${c.id} has a repeat`).toBe(new Set(c.emoji).size);
      }
    });
  });

  it("writes a name in its own colour, and leaves an uncoloured one alone", () => {
    clearChat();
    addChat({ from: "Bea", text: "hello", at: 1, color: "#3366ff" });
    addChat({ from: "Cal", text: "hi", at: 2 });
    const html = screen(withChat);
    expect(html).toContain('<b style="color:#3366ff">Bea</b>');
    // The control: no style at all rather than an empty one.
    expect(html).toContain("<b>Cal</b>");
    clearChat();
  });

  it("drops a colour that is not #rrggbb before it reaches the markup", () => {
    // It goes into a style attribute, so the gate is on the way INTO the
    // store — one place, rather than at each site that draws a line.
    clearChat();
    addChat({ from: "Bea", text: "x", at: 1, color: 'red" onload="alert(1)' });
    expect(screen(withChat)).toContain("<b>Bea</b>");
    clearChat();
  });
});

/**
 * A seat a bot took over is RELABELLED, never renamed: the seat name is
 * the engine's identifier, and every option id, the command log and every
 * saved game are written in terms of it.
 */
describe("a seat a bot took over", () => {
  it("shows the label on the mat while the seat id is untouched", () => {
    const seats = config.decks.map((d) => d.seat);
    const html = screen({
      seatFaces: { [seats[1]!]: { avatar: null, bot: true, label: `${seats[1]} Bot` } },
    });
    const at = html.indexOf(`data-seat="${seats[1]}"`);
    expect(html.slice(at, at + 400)).toContain(`${seats[1]} Bot`);
    // The control: a seat with no label still shows its plain name.
    const other = html.indexOf(`data-seat="${seats[0]}"`);
    expect(html.slice(other, other + 400)).not.toContain("Bot");
  });
});

/**
 * The game log is EVENTS AND NOTICES, in order (owner report 2026-09-07:
 * "the notification of a player getting kicked in the Game Log seems to be
 * stuck at the bottom … it needs to be integrated into the game log as an
 * entry").
 *
 * A notice is not an engine event — a seat changing hands changes nothing
 * in the game — but it happened at a point in the game, and appending them
 * after everything left them piled under newer events for ever.
 */
describe("notices in the game log", () => {
  /** A table that has actually played, so the log has events to sit
   *  among. A freshly dealt one has NONE, and a test written against it
   *  would prove nothing about interleaving at all. */
  const MOVES = 12;
  const eventCount = (): number => {
    const t = new LocalTransport({ setup });
    for (let i = 0; i < MOVES; i++) {
      const dp = t.decision();
      if (!dp) break;
      void t.choose((dp.options.find((o) => o.kind === "pass") ?? dp.options[0]!).id);
    }
    return t.view().eventLog.length;
  };

  it("puts a notice where it happened, not at the end", () => {
    const events = eventCount();
    expect(events, "the fixture has no events to interleave with").toBeGreaterThan(1);
    const html = screen({ advance: MOVES, notices: [{ text: "MIDPOINT", afterEvent: 1 }] });
    const at = html.indexOf("MIDPOINT");
    expect(at).toBeGreaterThan(-1);
    // THERE IS LOG AFTER IT. That is the whole claim: appended after
    // everything, as it used to be, there would be none — which is
    // exactly what "stuck at the bottom" described.
    expect(html.lastIndexOf('class="ev ')).toBeGreaterThan(at);
  });

  it("still draws one written after the last event, at the end", () => {
    // The control: "put it in the middle" must not become "never put it
    // last", or a notice from the current moment would vanish upward.
    const html = screen({ advance: MOVES, notices: [{ text: "LATEST", afterEvent: eventCount() }] });
    expect(html).toContain("LATEST");
  });

  it("draws one written before anything happened, at the top", () => {
    const html = screen({ advance: MOVES, notices: [{ text: "EARLIEST", afterEvent: 0 }] });
    const at = html.indexOf("EARLIEST");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(html.lastIndexOf('class="ev '));
  });

  it("marks it as a notice, so it does not read as something that happened", () => {
    expect(screen({ advance: MOVES, notices: [{ text: "X", afterEvent: 0 }] })).toContain('class="ev notice"');
    expect(screen()).not.toContain('class="ev notice"');
  });
});
