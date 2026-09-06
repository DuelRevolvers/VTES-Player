/**
 * The rendered table, as a string. `render()` touches no DOM API, so the
 * markup can be asserted headlessly — which matters most for the two things
 * a player would notice immediately: hidden cards leaking, and the hand not
 * being clickable.
 */

import { describe, expect, it } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import registry from "../../src/cards/registry.json";
import type { GameState, LegalOption } from "../../src/engine/index.ts";
import type { DeckDef, GameSetup } from "../../src/ui/decks.ts";
import { narrate } from "../../src/ui/narrate.ts";
import { describePlay, orderHand, playsByCard, render } from "../../src/ui/render.ts";
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
    aiDelayMs?: number;
    cardTextPx?: number;
    seatFaces?: Record<string, { avatar: string | null; bot: boolean }>;
    localSeat?: string | null;
    ashOpen?: string | null;
    canLeave?: boolean;
  } = {},
): string {
  const t = new LocalTransport({ setup, ...(opts.omniscient ? { omniscient: true } : {}) });
  if (opts.localSeat !== undefined) t.setLocalSeat(opts.localSeat);
  return render({
    cardTextPx: opts.cardTextPx ?? 15,
    seatFaces: opts.seatFaces ?? {},
    localSeat: opts.localSeat ?? null,
    ashOpen: opts.ashOpen ?? null,
    canLeave: opts.canLeave ?? false,
    state: t.view(),
    dp: t.decision(),
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

  it("offers an AI toggle per seat, checked for the seats an AI plays", () => {
    const seats = config.decks.map((d) => d.seat);
    const html = screen({ settingsOpen: true, aiSeats: { [seats[1]!]: true } });
    // One row per seat…
    for (const id of seats) {
      expect(html).toContain(`class="ai-seat" data-seat="${id}"`);
    }
    // …and only the AI-driven one is checked. Sliced to that row, because
    // the auto-pass rows carry the same seat names.
    const row = (id: string): string => {
      const at = html.indexOf(`class="ai-seat" data-seat="${id}"`);
      return html.slice(at, at + 90);
    };
    expect(row(seats[1]!)).toContain("checked");
    expect(row(seats[0]!)).not.toContain("checked");
  });

  it("the AI toggles are inside the settings dialog, not the top bar", () => {
    expect(screen()).not.toContain("ai-seat");
    expect(screen({ settingsOpen: true })).toContain("ai-seat");
  });

  it("holds the debug reveal, which is no longer a top-bar control", () => {
    expect(screen()).not.toContain('id="omni"');
    expect(screen({ settingsOpen: true })).toContain('id="omni"');
  });

  it("offers an AI pace, with the current one selected", () => {
    const html = screen({ settingsOpen: true, aiDelayMs: 900 });
    expect(html).toContain('id="aispeed"');
    for (const s of AI_SPEEDS) expect(html).toContain(`value="${s.ms}"`);
    // Exactly the one in force, and no other.
    const chosen = (h: string, ms: number): boolean =>
      h.slice(h.indexOf(`value="${ms}"`), h.indexOf(`value="${ms}"`) + 30).includes("selected");
    expect(chosen(html, 900)).toBe(true);
    expect(chosen(html, 0)).toBe(false);
    expect(chosen(html, 1800)).toBe(false);
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
