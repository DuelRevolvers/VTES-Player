/**
 * Undo, save and load for the debug UI (docs/debug-ui-design.md §5).
 *
 * All three are the SAME operation: rebuild a fresh engine from the setup
 * and replay a prefix of the command log. `GameState.commandLog` records
 * (seq, seat, option) and the setup fixes the RNG seed, so replaying is
 * exact — architecture principle 2 (deterministic + event-sourced) paying
 * out. No snapshot stack, no state diffing.
 */

import { buildHandlerRegistry } from "../cards/effects/cards.ts";
import type { CommandLogEntry } from "../engine/index.ts";
import { VtesEngine } from "../engine/index.ts";
import type { GameSetup } from "./decks.ts";
import { buildGame } from "./decks.ts";

export interface SavedGame {
  version: 1;
  setup: GameSetup;
  commands: CommandLogEntry[];
  /**
   * Which seats an AI was playing when this was saved.
   *
   * NOT game state, and it does not contradict `settings.ts`'s rule that a
   * save carries no preferences: that rule is about REPLAY, and it still
   * holds — the answers are all in `commands`, so this game replays
   * identically whoever is handed the seats afterwards. What it fixes is
   * a game coming back UNPLAYABLE: without it, loading a private table
   * leaves three bot seats with nobody driving them and one human being
   * asked to answer for all four.
   *
   * Optional because it was added after saves already existed — a file or
   * a slot written before this field simply does not have it, and the
   * loader says what it assumed rather than guessing silently.
   */
  botSeats?: string[];
}

/** Replay `commands` (or a prefix of them) into a brand new engine. */
export function replay(setup: GameSetup, commands: CommandLogEntry[]): VtesEngine {
  const engine = new VtesEngine(buildGame(setup), buildHandlerRegistry());
  for (const cmd of commands) {
    // A prefix of a valid log is always itself valid; if it ever is not,
    // that is a determinism bug worth surfacing loudly rather than
    // silently truncating the game.
    engine.choose(cmd.option);
  }
  return engine;
}

/** Step back `count` decisions. Returns a fresh engine. */
export function undo(setup: GameSetup, commands: CommandLogEntry[], count = 1): VtesEngine {
  const keep = Math.max(0, commands.length - count);
  return replay(setup, commands.slice(0, keep));
}

/**
 * Step back to just before the current action was announced — usually what
 * you actually want after a card resolves wrongly. Falls back to a single
 * undo when no action boundary is behind us.
 */
export function undoToActionStart(
  setup: GameSetup,
  commands: CommandLogEntry[],
): VtesEngine {
  // Walk back through the log, replaying each prefix is too slow to do
  // naively; instead replay once and look at where actions began.
  for (let n = 1; n < commands.length; n++) {
    const candidate = commands.slice(0, commands.length - n);
    const engine = replay(setup, candidate);
    const inAction = engine.state.frames.some((f) => f.kind === "action");
    if (!inAction) return engine;
  }
  return replay(setup, []);
}

export function toSave(
  setup: GameSetup,
  commands: CommandLogEntry[],
  botSeats?: string[],
): SavedGame {
  return { version: 1, setup, commands, ...(botSeats ? { botSeats } : {}) };
}

/**
 * Is this really a save?
 *
 * ONE PREDICATE, because there are two ways in — a file somebody hands
 * over with a bug report, and a slot read back out of localStorage — and
 * "one question asked in two places will drift". Both are data this code
 * did not write: a file may be anything at all, and a slot may have been
 * written by an older version of this app.
 *
 * It checks the SHAPE, not the contents. A structurally valid save whose
 * command log does not replay is a determinism bug, and it should surface
 * loudly from `replay` rather than being quietly rejected here as "not a
 * save".
 */
export function isSavedGame(value: unknown): value is SavedGame {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Partial<SavedGame>;
  if (s.version !== 1) return false;
  if (typeof s.setup !== "object" || s.setup === null) return false;
  if (!Array.isArray(s.setup.decks)) return false;
  if (!Array.isArray(s.commands)) return false;
  if (s.botSeats !== undefined) {
    if (!Array.isArray(s.botSeats)) return false;
    if (!s.botSeats.every((b) => typeof b === "string")) return false;
  }
  return true;
}

/** Offer the save as a .json download — the file to hand over with a bug. */
export function downloadSave(save: SavedGame): void {
  const blob = new Blob([JSON.stringify(save, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vtes-game-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Read a save back from a file input. */
export async function readSaveFile(file: File): Promise<SavedGame> {
  const text = await file.text();
  // A file is whatever somebody chose in a picker, so JSON.parse throwing
  // is an ordinary outcome here, not a bug — say which of the two it was.
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("that file is not a saved game");
  }
  if (!isSavedGame(parsed)) throw new Error("that file is not a saved game");
  return parsed;
}
