/**
 * Saved games (docs/saved-games-design.md) — the games this browser is
 * holding for you, by name, plus the one it keeps by itself.
 *
 * Same rules as `decklibrary.ts`, `profile.ts` and `settings.ts`, and for
 * the same reasons: LOCAL ONLY (there is no backend), every read and write
 * guarded (a private window throws on access), and an empty store is never
 * an error — it is somebody who has not saved a game yet.
 *
 * There are two kinds of slot and the difference is who writes them:
 *
 * - **The auto slot.** The table rewrites it at the top of every turn, so
 *   *Continue* works whether or not anyone remembered to press Save. There
 *   is exactly one, it is always `AUTO_ID`, and it is always the thing the
 *   next autosave overwrites — which is precisely why *Keep* exists.
 * - **Named slots.** Written only when a player asks, and never touched
 *   again. These are positions somebody wants to come back to.
 *
 * ONE STORE, NOT TWO. The table used to write a single unnamed slot under
 * its own key and nothing but the table could read it; that key is now
 * read once, on the first load, and adopted as the auto slot (see
 * `adoptLegacy`). Two stores answering "what games are saved?" is the
 * drift this project keeps paying for.
 */

import type { SavedGame } from "./history.ts";
import { isSavedGame } from "./history.ts";

const KEY = "vtes-saves";

/**
 * The single slot the table wrote before this store existed.
 *
 * Read once and then removed. A game saved yesterday should still be
 * there today, and dropping it silently on an upgrade is the kind of
 * small betrayal nobody reports as a bug — they just stop trusting Save.
 */
const LEGACY_KEY = "vtes-debug-game";

/**
 * How many NAMED games one browser will hold, on top of the auto slot.
 *
 * Not a rule — a guard. A save carries its table's whole deck lists plus
 * every decision made in it, and the origin's few megabytes of
 * localStorage are shared with the profile avatar, the deck library and
 * the leaderboard. Five is enough to keep the positions worth keeping and
 * small enough that a save can never evict a profile.
 */
export const MAX_SAVES = 5;

export const MAX_SAVE_NAME = 40;

/** The auto slot's id and the name shown against it. */
export const AUTO_ID = "auto";
export const AUTO_NAME = "Last game";

export interface SaveSlot {
  /** `AUTO_ID` for the auto slot, otherwise a generated id. Named slots
   *  are keyed by id rather than by name so renaming one is a rename and
   *  not a delete-and-add that loses its place in the list. */
  id: string;
  name: string;
  /** The slot the table keeps current by itself. Exactly one has this. */
  auto: boolean;
  /** ISO date, so the list can be ordered and dated. */
  savedAt: string;
  /**
   * What the row SAYS — the turn number and who was at the table.
   *
   * A LABEL, not a fact about the game. The payload is authoritative and
   * loading replays it from the top, so a label that has drifted is
   * cosmetic. It is stored rather than derived because deriving it means
   * building an engine and replaying a whole command log, and the Profile
   * screen repaints on every keystroke — five replays per character is
   * not a price a label is worth.
   */
  turn: number;
  seats: string[];
  game: SavedGame;
}

/** What a slot's row should say about the game inside it. */
export interface SaveLabel {
  turn: number;
  seats: string[];
}

/**
 * Why this save cannot be called that, or null.
 *
 * Permissive about content and strict only about what breaks something —
 * the same posture, and very nearly the same code, as `deckNameProblem`.
 * `AUTO_NAME` is refused because a row called "Last game" that is not the
 * auto slot would be a lie about which one the next autosave eats.
 */
export function saveNameProblem(name: string, existing: SaveSlot[] = []): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "a name is needed";
  if (trimmed.length > MAX_SAVE_NAME) {
    return `save names are at most ${MAX_SAVE_NAME} characters`;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return "a name cannot contain control characters";
  if (trimmed.toLowerCase() === AUTO_NAME.toLowerCase()) {
    return `"${AUTO_NAME}" is the automatic one — choose another name`;
  }
  if (existing.some((s) => !s.auto && s.name.toLowerCase() === trimmed.toLowerCase())) {
    return `you already have a save called "${trimmed}"`;
  }
  return null;
}

function isSlot(value: unknown): value is SaveSlot {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<SaveSlot>;
  if (typeof s.id !== "string" || s.id === "") return false;
  if (typeof s.name !== "string" || s.name.trim() === "") return false;
  if (typeof s.savedAt !== "string") return false;
  // A bad LABEL must not lose a good save: turn and seats are cosmetic, so
  // they are repaired on the way out rather than used to reject the row.
  return isSavedGame(s.game);
}

function repair(s: SaveSlot): SaveSlot {
  return {
    ...s,
    auto: s.id === AUTO_ID,
    turn: typeof s.turn === "number" && Number.isFinite(s.turn) ? s.turn : 0,
    seats: Array.isArray(s.seats) ? s.seats.filter((n) => typeof n === "string") : [],
  };
}

/**
 * The auto slot first, then the named ones newest first.
 *
 * The auto slot leads because it is the one somebody coming back to a
 * half-played game is looking for, and it is the only row whose contents
 * they did not choose.
 */
function order(slots: SaveSlot[]): SaveSlot[] {
  const auto = slots.filter((s) => s.auto);
  const named = slots
    .filter((s) => !s.auto)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return [...auto, ...named];
}

/** Every saved game. Never throws. */
export function loadSaves(): SaveSlot[] {
  let slots: SaveSlot[] = [];
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      // Validated on the way out, not trusted: an older version of this
      // app — or a hand edit — may have shaped a row differently, and one
      // bad row must not lose the rest of the store.
      if (Array.isArray(parsed)) slots = parsed.filter(isSlot).map(repair);
    } else {
      slots = adoptLegacy();
    }
  } catch {
    return [];
  }
  return order(slots);
}

/**
 * Take over the single slot the table used to write, once.
 *
 * Called only when this store has never been written, so it cannot
 * resurrect a save somebody has since deleted. The old key is removed on
 * the way through — leaving it would mean the same game sat in two places
 * with nothing keeping them in step.
 */
function adoptLegacy(): SaveSlot[] {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    localStorage.removeItem(LEGACY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isSavedGame(parsed)) return [];
    // No label was ever recorded for it, and the seat names are the one
    // part that can be recovered without replaying: they are the deck
    // owners. Turn 0 reads as "unknown", which is honest.
    const seats = parsed.setup.decks.map((d) => d.seat).filter((s) => typeof s === "string");
    const slot: SaveSlot = {
      id: AUTO_ID,
      name: AUTO_NAME,
      auto: true,
      savedAt: new Date().toISOString(),
      turn: 0,
      seats,
      game: parsed,
    };
    write([slot]);
    return [slot];
  } catch {
    return [];
  }
}

function write(slots: SaveSlot[]): string | null {
  try {
    localStorage.setItem(KEY, JSON.stringify(slots));
    return null;
  } catch {
    // Quota, or site data blocked. Say so rather than pretending it saved
    // and losing it on the next reload.
    return "this browser would not store the game — delete a save to make room";
  }
}

/** A slot id that is not the auto one and not already taken. */
function newId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Replace the auto slot. Called by the table, not by a person.
 *
 * Silently does nothing when storage refuses. An autosave is a courtesy
 * happening in the background at the top of a turn, and interrupting a
 * game to say a courtesy failed would be worse than the courtesy failing
 * — the named slots and the file download are both still there, and both
 * DO report their problems, because those are things somebody asked for.
 */
export function autoSave(game: SavedGame, label: SaveLabel): void {
  const rest = loadSaves().filter((s) => !s.auto);
  write([
    {
      id: AUTO_ID,
      name: AUTO_NAME,
      auto: true,
      savedAt: new Date().toISOString(),
      turn: label.turn,
      seats: label.seats,
      game,
    },
    ...rest,
  ]);
}

/** Keep a game under a name of its own. Returns the problem, or null. */
export function saveAs(name: string, game: SavedGame, label: SaveLabel): string | null {
  const slots = loadSaves();
  const problem = saveNameProblem(name, slots);
  if (problem) return problem;
  if (slots.filter((s) => !s.auto).length >= MAX_SAVES) {
    return `that is ${MAX_SAVES} saved games — delete one first`;
  }
  return write([
    ...slots,
    {
      id: newId(),
      name: name.trim(),
      auto: false,
      savedAt: new Date().toISOString(),
      turn: label.turn,
      seats: label.seats,
      game,
    },
  ]);
}

/**
 * Promote the auto slot to a named one — the *Keep* button.
 *
 * A COPY, and the auto slot stays where it is. The next autosave will
 * overwrite the auto slot, which is the whole reason somebody pressed
 * this; taking it away as well would mean *Keep* removed the row it was
 * pressed on.
 */
export function keepAuto(name: string): string | null {
  const auto = loadSaves().find((s) => s.auto);
  if (!auto) return "there is no automatic save to keep";
  return saveAs(name, auto.game, { turn: auto.turn, seats: auto.seats });
}

/** Rename a named slot. Returns the problem, or null. */
export function renameSave(id: string, name: string): string | null {
  const slots = loadSaves();
  const slot = slots.find((s) => s.id === id);
  if (!slot) return "that save is no longer there";
  if (slot.auto) return `"${AUTO_NAME}" is renamed by keeping it, not in place`;
  const problem = saveNameProblem(name, slots.filter((s) => s.id !== id));
  if (problem) return problem;
  return write(slots.map((s) => (s.id === id ? { ...s, name: name.trim() } : s)));
}

/** Remove a save. Silently does nothing if it is not there. */
export function deleteSave(id: string): void {
  write(loadSaves().filter((s) => s.id !== id));
}

export function findSave(id: string): SaveSlot | null {
  return loadSaves().find((s) => s.id === id) ?? null;
}

export function clearSaves(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * Which seats an AI should play when this save is loaded.
 *
 * `botSeats` is recorded from this version on, and when it is there it is
 * the answer. When it is NOT — a file from an older build, or the slot
 * adopted from the old single-slot key — every seat but the player's own
 * is assumed to be a bot, because a private table is one human and some
 * bots and that is what these saves are.
 *
 * It is a GUESS and the caller says so on screen rather than quietly
 * acting on it: `assumed` is what makes the difference visible. The
 * alternative — no bots at all — is not neutral, it is a four-handed game
 * one person has to play alone, and "empty for the wrong reason" is
 * exactly the failure that looks identical to working.
 */
export function botSeatsFor(
  game: SavedGame,
  yourName: string | null,
): { seats: string[]; assumed: boolean } {
  if (game.botSeats) return { seats: [...game.botSeats], assumed: false };
  const all = game.setup.decks.map((d) => d.seat);
  return { seats: all.filter((s) => s !== yourName), assumed: true };
}
