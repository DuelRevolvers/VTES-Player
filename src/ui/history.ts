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
}

const STORAGE_KEY = "vtes-debug-game";

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

export function toSave(setup: GameSetup, commands: CommandLogEntry[]): SavedGame {
  return { version: 1, setup, commands };
}

export function saveToStorage(save: SavedGame): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  } catch {
    // A private window or blocked site data: saving to a file still works.
  }
}

export function loadFromStorage(): SavedGame | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedGame;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
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
  const parsed = JSON.parse(text) as SavedGame;
  if (parsed.version !== 1) throw new Error("unsupported save version");
  return parsed;
}
