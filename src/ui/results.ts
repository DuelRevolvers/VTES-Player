/**
 * Finished games, and the leaderboard built from them
 * (docs/shell-design.md §6).
 *
 * PER DEVICE, like everything else about a profile: there is no server to
 * share results with, which is the same decision that makes the profile
 * local. The screen says so rather than showing an empty table that looks
 * broken.
 *
 * The split here is the one the rest of the project uses: `resultFrom` and
 * `standings` are PURE — they turn a finished game into a row, and rows
 * into a table — and only `loadResults`/`recordResult` touch storage, with
 * every access guarded.
 */

import type { GameState } from "../engine/index.ts";

const KEY = "vtes-results";

/** How many games one browser keeps. The standings are a fold over the
 *  whole list, so this is a storage guard, not a window: 200 games is a
 *  few tens of kilobytes and more history than anyone will scroll. */
export const MAX_RESULTS = 200;

export interface SeatResult {
  name: string;
  victoryPoints: number;
  ousted: boolean;
  /** An AI played this seat. Kept so the standings can separate people
   *  from the computer — a table of bot win rates is not a leaderboard. */
  bot: boolean;
  /**
   * The deck this seat brought, as the label the lobby showed ("Hecata —
   * Fifth Edition", "a pasted deck list"), or null when the recorder did
   * not know it.
   *
   * A LABEL, never the list: what is in a deck is its owner's business,
   * and a result is kept for ever. Optional because rows recorded before
   * this existed have none, and the leaderboard must still read them.
   */
  deck?: string | null;
}

export interface GameResult {
  /** ISO date the game finished. */
  played: string;
  seats: SeatResult[];
  /** The seat that won, or null for a draw (the engine's turn cap). */
  winner: string | null;
  /** The seat the person at this device was playing, if any. */
  you: string | null;
}

/**
 * Turn a FINISHED game into a result row, or null if it is not over.
 *
 * Reads `GameEnded` rather than inferring an ending from the board: the
 * engine emits it at both endings it has — the last Methuselah standing,
 * and the turn cap, which is a safeguard rather than a rule and correctly
 * produces a draw.
 */
export function resultFrom(
  state: GameState,
  meta: {
    bots: Record<string, boolean>;
    you: string | null;
    /** Seat id → the deck label they brought. A seat with none records null. */
    decks?: Record<string, string>;
  },
): GameResult | null {
  const ended = [...state.eventLog].reverse().find((e) => e.type === "GameEnded");
  if (!ended || ended.type !== "GameEnded") return null;
  return {
    played: new Date().toISOString(),
    seats: state.seats.map((s) => ({
      name: s.id,
      victoryPoints: s.victoryPoints,
      ousted: s.ousted,
      bot: meta.bots[s.id] ?? false,
      deck: meta.decks?.[s.id] ?? null,
    })),
    winner: ended.winner,
    you: meta.you,
  };
}

export interface Standing {
  name: string;
  games: number;
  wins: number;
  victoryPoints: number;
  bot: boolean;
}

/**
 * The table: one row per name, ordered by wins, then victory points, then
 * name so the order is stable rather than dependent on insertion.
 *
 * DECKS ARE NOT IN HERE. A standing is a person across many games, and a
 * person brings a different deck most games — so a deck column was a
 * growing list stapled to a tally, and it made the tally harder to read
 * (owner request 2026-09-07). Which deck was played WHEN is a fact about
 * one game, and it is on the `SeatResult` where the games list reads it.
 *
 * A name is counted as a BOT only if it has never been played by a person.
 * The seat names in a private game are "Bot 1"…"Bot 3" and a human's is
 * their profile name, so the two do not normally mix — but a player who
 * names themselves "Bot 2" should appear as a player, and the same name
 * taken over from an AI mid-game is a person's result.
 */
export function standings(results: GameResult[]): Standing[] {
  const rows = new Map<string, Standing>();
  for (const r of results) {
    for (const s of r.seats) {
      const row = rows.get(s.name) ?? {
        name: s.name,
        games: 0,
        wins: 0,
        victoryPoints: 0,
        bot: true,
      };
      row.games += 1;
      if (r.winner === s.name) row.wins += 1;
      row.victoryPoints += s.victoryPoints;
      if (!s.bot) row.bot = false;
      rows.set(s.name, row);
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.wins - a.wins || b.victoryPoints - a.victoryPoints || a.name.localeCompare(b.name),
  );
}

/** Every recorded result, newest first. Never throws. */
export function loadResults(): GameResult[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isResult);
  } catch {
    return [];
  }
}

function isResult(r: unknown): r is GameResult {
  if (typeof r !== "object" || r === null) return false;
  const g = r as Partial<GameResult>;
  return typeof g.played === "string" && Array.isArray(g.seats);
}

/** Store a finished game. Silently does nothing if storage refuses — a
 *  leaderboard is a convenience, and losing one row is not worth an
 *  error in front of somebody who has just finished a game. */
export function recordResult(result: GameResult): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify([result, ...loadResults()].slice(0, MAX_RESULTS)),
    );
  } catch {
    // Quota, or site data blocked.
  }
}

export function clearResults(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * The date a game finished, as a person would read it.
 *
 * `played` is an ISO string written by whoever recorded the game, so it
 * can be anything — a row from a hand-edited store, or from a browser
 * whose clock was wrong. An unreadable one falls back to the raw string
 * rather than rendering "Invalid Date", which looks like a bug in the
 * leaderboard rather than a bad row in it.
 */
export function playedOn(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
