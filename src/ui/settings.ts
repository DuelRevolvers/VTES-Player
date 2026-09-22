/**
 * Client-side preferences (docs/debug-ui-design.md §7).
 *
 * These are NOT game state. Nothing here goes in the command log, nothing
 * here changes what is legal, and a save file carries none of it: two
 * players with different settings play the identical game. That separation
 * is what lets auto-pass live outside the engine entirely.
 *
 * Persisted in localStorage so a preference survives a reload — every read
 * and write is guarded, because a private window or blocked site data
 * throws on access and a missing preference is never an error.
 */

import { isPlaystyle, type Playstyle } from "../ai/playstyles.ts";
import { nameProblem } from "./profile.ts";

const KEY = "vtes-ui-settings";

export interface UiSettings {
  /** Seat id → answer automatically when Pass is that seat's only option. */
  autoPass: Record<string, boolean>;
  /** Seat id → an AI plays this seat (phase 5). A preference like the
   *  others: it never reaches the command log, so a save replays the same
   *  game whether or not the loading client hands the seat back to an AI. */
  aiSeats: Record<string, boolean>;
  /**
   * How long the table holds after each visible AI move, in milliseconds.
   *
   * An AI answers in well under a millisecond, so without this a whole
   * turn's worth of play lands between two repaints and a human at the
   * table sees only the aftermath. The pause is a preference like the rest
   * — it never reaches the command log, and the same game replays
   * identically at any speed.
   */
  aiDelayMs: number;
  /**
   * How long a PERSON may sit on an off-turn decision before the table
   * passes for them, in milliseconds. 0 is off, and off is the default.
   *
   * The owner's standing rule is that a player is never auto-skipped, and
   * this does not break it: it is a table setting the host turns on, it
   * only ever answers a decision where PASSING IS ALREADY LEGAL, and it
   * never touches a seat on its own turn (docs/pass-timeout-design.md).
   *
   * A CLIENT preference in the same sense as `autoPass` — it never reaches
   * the command log, so the same game replays identically with it on or
   * off — but unlike the rest of this file it is the HOST's copy that
   * decides, because the host is the authority that runs the engine.
   */
  passTimeoutMs: number;
  /**
   * Point size for the rules text under a magnified card.
   *
   * A card scan is read at a glance; its TEXT is read word by word, and at
   * the size the panel was first written the owner could not comfortably
   * do that. A preference rather than a fixed bump, because how large is
   * comfortable depends on the screen it is being read on.
   */
  cardTextPx: number;
  /** Debug: reveal every seat's hidden cards. */
  omniscient: boolean;
  /**
   * What a new table calls its bot seats, in order.
   *
   * A PREFERENCE, not a profile field: it is about the tables made on this
   * machine, not about the person, and it does not travel to somebody
   * else's room the way a name and a chat colour do.
   *
   * A blank entry — or a list shorter than the table — falls back to
   * "Bot 1", "Bot 2" and so on, so this can be partly filled in and the
   * rest still works. Positional on purpose (owner decision): bot seat 1
   * always gets the first name, which is what makes a leaderboard row
   * accumulate against one bot instead of scattering across a pool.
   *
   * These are DEFAULTS. Every bot seat is still renameable in the lobby,
   * per game — this is only what it starts as.
   */
  botNames: string[];
  /**
   * How each bot seat PLAYS, positionally — box 1 is bot seat 1, exactly
   * like `botNames` beside it.
   *
   * `"default"` (and an absent entry) means **whatever that seat's DECK
   * is set to**, which is the owner's requested behaviour: the styles are
   * attached to the precons and the dropdown is an override, not the
   * primary mechanism. Stored as the style's own value otherwise —
   * "balanced", "bruiser", "turtle", "politician".
   *
   * A LOCAL setting like `autoPass` and `aiSeats`: bots run on the host,
   * so the host's settings decide, and nothing here crosses the wire.
   */
  botPlaystyles: string[];
}

/**
 * The most bot seats a table can have: every seat but the host's.
 *
 * Derived from `MAX_SEATS` would be the obvious thing, and it is
 * deliberately not — `newgame.ts` imports this module's `seatSeed`, and
 * importing back the other way would be a cycle. The two are pinned to
 * each other by a test instead.
 */
export const MAX_BOT_NAMES = 5;

/**
 * What bot seat `index` (1-based) is called by default.
 *
 * THE ONE PLACE THAT ANSWERS IT. A table is built in two places — a fresh
 * default table, and the button that adds a seat to an existing one — and
 * those two drifting apart is how a table ends up with "Bea, Cato, Bot 3"
 * where the third name was configured all along.
 */
export function botNameFor(settings: UiSettings, index: number): string {
  const configured = settings.botNames[index - 1]?.trim();
  return configured ? configured : `Bot ${index}`;
}

/** The stored value meaning "use whatever this seat's deck is set to". */
export const PLAYSTYLE_DEFAULT = "default";

/**
 * The OVERRIDE for bot seat `index` (1-based), or null when that seat
 * should use its deck's style.
 *
 * THE ONE PLACE THAT ANSWERS IT, for the same reason `botNameFor` is:
 * the rule is read wherever a bot is built, and five copies of a
 * two-branch rule is five chances to drift.
 */
export function botPlaystyleFor(settings: UiSettings, index: number): Playstyle | null {
  const configured = settings.botPlaystyles[index - 1];
  return isPlaystyle(configured) ? configured : null;
}

/** The card-text sizes offered in Settings. */
export const CARD_TEXT_SIZES: { px: number; label: string }[] = [
  { px: 12, label: "Small" },
  { px: 15, label: "Normal" },
  { px: 18, label: "Large" },
  { px: 21, label: "Very large" },
];

/** The pacing choices offered in Settings, slowest last. */
export const AI_SPEEDS: { ms: number; label: string }[] = [
  { ms: 0, label: "Instant" },
  { ms: 400, label: "Fast" },
  { ms: 900, label: "Normal" },
  { ms: 1800, label: "Slow" },
  { ms: 3000, label: "Very slow" },
];

/**
 * The pass-clock choices offered in Moderation: off, then every five
 * seconds up to a minute (owner request 2026-09-21).
 *
 * GENERATED rather than written out, so the increments cannot drift from
 * the sentence that describes them, and so the twelve labels are spelled
 * one way. `0` first, because off is the default and the list is read top
 * to bottom.
 */
export const PASS_TIMEOUTS: { ms: number; label: string }[] = [
  { ms: 0, label: "Off" },
  ...Array.from({ length: 12 }, (_, i) => {
    const seconds = (i + 1) * 5;
    return { ms: seconds * 1000, label: seconds === 60 ? "1 minute" : `${seconds} seconds` };
  }),
];

/** The longest pass clock the panel offers, and the cap a stored setting
 *  is clamped to — see `loadSettings`. */
export const MAX_PASS_TIMEOUT_MS = PASS_TIMEOUTS[PASS_TIMEOUTS.length - 1]!.ms;

/**
 * The beat between the deal and the first bot move (owner request
 * 2026-09-07: "give it a few seconds before the bots start their first
 * plays … it appears as though the game starts with the first bots
 * already having done their turns").
 *
 * NOT a setting — it happens once, at the start of a game, and a control
 * for it would be a control almost nobody would ever find a reason to
 * touch. The per-move rhythm IS a setting, and it is a separate one:
 * `aiDelayMs`, above.
 */
export const OPENING_DELAY_MS = 2500;

export const DEFAULT_SETTINGS: UiSettings = {
  autoPass: {},
  aiSeats: {},
  aiDelayMs: 900,
  // OFF. A clock that answered for a player by default would be exactly
  // the auto-skip the owner ruled out; the host turns it on when a table
  // needs it.
  passTimeoutMs: 0,
  // Larger than the 11px the panel shipped with — the owner could not read
  // card text at that size, and this is text you read rather than glance at.
  cardTextPx: 15,
  omniscient: false,
  // Empty rather than ["Bot 1", …]: an unset name and a name that happens
  // to read "Bot 1" should behave the same, and `botNameFor` is the one
  // place that knows what unset looks like.
  botNames: [],
  // Empty rather than five "default" strings, for the reason above it: an
  // unset entry and a chosen "Default" must behave identically.
  botPlaystyles: [],
};

/** A stable per-seat seed, so two AI seats do not make identical choices
 *  in identical spots and a reload keeps a seat playing the same way. */
export function seatSeed(seat: string): number {
  let h = 2166136261;
  for (let i = 0; i < seat.length; i++) {
    h ^= seat.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1000000 || 1;
}

/**
 * A stored bot-name list, made safe to use.
 *
 * A name that would be REFUSED if it were typed in must not survive being
 * stored either — a hand edit or an older version could have put a control
 * character or a 200-character string in here, and this list becomes seat
 * ids. Anything `nameProblem` objects to becomes blank, which is the same
 * as never having been set: `botNameFor` falls back to "Bot N".
 *
 * Note the empty string is kept as a POSITION rather than dropped. The
 * list is positional, so removing a blank third entry would silently
 * promote the fourth name to the third bot.
 */
function cleanBotNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_BOT_NAMES)
    .map((n) => (typeof n === "string" && !nameProblem(n) ? n.trim() : ""));
}

/**
 * A stored playstyle list, made safe to use — the sibling of
 * `cleanBotNames`, and for the same reason.
 *
 * **A stored settings blob is untrusted input.** A hand edit, or a
 * version of this build that knew a style this one does not, can put
 * anything in here, and these values select a weight table. Anything
 * that is not one of the four becomes `PLAYSTYLE_DEFAULT`, which is
 * identical to never having chosen — `botPlaystyleFor` returns null and
 * the seat falls back to its deck.
 */
function cleanBotPlaystyles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_BOT_NAMES)
    .map((s) => (isPlaystyle(s) ? s : PLAYSTYLE_DEFAULT));
}

export function loadSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    // The spread would share DEFAULT_SETTINGS' own objects and arrays with
    // every caller, so each mutable field is replaced with a fresh one.
    if (!raw) return { ...DEFAULT_SETTINGS, autoPass: {}, aiSeats: {}, botNames: [], botPlaystyles: [] };
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      autoPass:
        parsed.autoPass && typeof parsed.autoPass === "object" ? { ...parsed.autoPass } : {},
      aiSeats:
        parsed.aiSeats && typeof parsed.aiSeats === "object" ? { ...parsed.aiSeats } : {},
      // A stored preference from before this setting existed, or a hand-
      // edited one, must not be able to hang the table on a huge pause.
      aiDelayMs:
        typeof parsed.aiDelayMs === "number" && Number.isFinite(parsed.aiDelayMs)
          ? Math.min(10000, Math.max(0, parsed.aiDelayMs))
          : DEFAULT_SETTINGS.aiDelayMs,
      // Clamped to the longest clock the panel offers, for the reason
      // above AND a sharper one: this value decides when a decision is
      // answered for somebody, so a stored blob must not be able to name
      // an interval nobody could have chosen.
      passTimeoutMs:
        typeof parsed.passTimeoutMs === "number" && Number.isFinite(parsed.passTimeoutMs)
          ? Math.min(MAX_PASS_TIMEOUT_MS, Math.max(0, Math.round(parsed.passTimeoutMs)))
          : DEFAULT_SETTINGS.passTimeoutMs,
      // Clamped for the same reason as the pause: a hand-edited or stale
      // value must not be able to make the panel unreadable.
      cardTextPx:
        typeof parsed.cardTextPx === "number" && Number.isFinite(parsed.cardTextPx)
          ? Math.min(32, Math.max(9, Math.round(parsed.cardTextPx)))
          : DEFAULT_SETTINGS.cardTextPx,
      omniscient: parsed.omniscient === true,
      botNames: cleanBotNames(parsed.botNames),
      botPlaystyles: cleanBotPlaystyles(parsed.botPlaystyles),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, autoPass: {}, aiSeats: {}, botNames: [], botPlaystyles: [] };
  }
}

/**
 * Why this bot name cannot be used, or null.
 *
 * BLANK IS ALLOWED here and nowhere else: an empty box means "no name of
 * my own, call it Bot N", which is the only way to unset one. Everything
 * else is the seat-name rule, asked of `profile.ts` so a bot and a person
 * are held to one standard.
 */
export function botNameProblem(name: string): string | null {
  return name.trim() === "" ? null : nameProblem(name);
}

export function saveSettings(settings: UiSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Preferences are a convenience; failing to store one is not an error.
  }
}
