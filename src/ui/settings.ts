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
  // Larger than the 11px the panel shipped with — the owner could not read
  // card text at that size, and this is text you read rather than glance at.
  cardTextPx: 15,
  omniscient: false,
  // Empty rather than ["Bot 1", …]: an unset name and a name that happens
  // to read "Bot 1" should behave the same, and `botNameFor` is the one
  // place that knows what unset looks like.
  botNames: [],
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

export function loadSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(KEY);
    // The spread would share DEFAULT_SETTINGS' own objects and arrays with
    // every caller, so each mutable field is replaced with a fresh one.
    if (!raw) return { ...DEFAULT_SETTINGS, autoPass: {}, aiSeats: {}, botNames: [] };
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
      // Clamped for the same reason as the pause: a hand-edited or stale
      // value must not be able to make the panel unreadable.
      cardTextPx:
        typeof parsed.cardTextPx === "number" && Number.isFinite(parsed.cardTextPx)
          ? Math.min(32, Math.max(9, Math.round(parsed.cardTextPx)))
          : DEFAULT_SETTINGS.cardTextPx,
      omniscient: parsed.omniscient === true,
      botNames: cleanBotNames(parsed.botNames),
    };
  } catch {
    return { ...DEFAULT_SETTINGS, autoPass: {}, aiSeats: {}, botNames: [] };
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
