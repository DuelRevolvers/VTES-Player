/**
 * Table chat — the lobby and the game share one conversation.
 *
 * A module-level store rather than state on a screen, because the whole
 * point is that it SURVIVES the handover: you agree a deck in the lobby,
 * the host starts, and the thread is still there. The lobby screen and the
 * table are two different objects with two different lifetimes; the
 * conversation belongs to neither.
 *
 * It is deliberately NOT game state. Nothing here reaches the command log,
 * so a save replays the same game without it, and an undo does not rewind
 * anything anybody said — the same rule the hand order and the per-seat
 * auto-pass toggle follow (docs/debug-ui-design.md).
 *
 * Ordering is the HOST's. A guest never adds its own line locally; it
 * sends, the host relays to everyone including the sender, and everyone
 * lists the same conversation in the same order. Adding locally as well
 * would show the sender their own line twice and, worse, in a different
 * order from everybody else's.
 */

import { colorProblem } from "./profile.ts";

export interface ChatLine {
  from: string;
  text: string;
  /** Wall clock at the relaying end, for the timestamp only. */
  at: number;
  /** A join, a leave, a bot taking over — printed differently. */
  system?: boolean;
  /**
   * `#rrggbb` for the sender's name, or absent for the default.
   *
   * Stamped by the HOST from what it knows about that player, not taken
   * from the line's own sender — the host already owns `from` for the same
   * reason (a guest must not be able to write somebody else's name into
   * the conversation, and must not be able to write somebody else's
   * colour either). Validated with `colorProblem` before it is stored,
   * because it ends up in a `style` attribute.
   */
  color?: string;
}

/** Long enough for a real conversation, short enough never to matter. */
export const MAX_CHAT = 200;
export const MAX_CHAT_TEXT = 400;

const lines: ChatLine[] = [];
const listeners = new Set<() => void>();

export function chatLines(): readonly ChatLine[] {
  return lines;
}

export function addChat(line: ChatLine): void {
  // A colour off the wire is somebody else's data and goes into a `style`
  // attribute, so it is checked HERE — one gate on the way in, rather
  // than at each of the places that draw a line.
  //
  // The key is DELETED rather than overwritten with a spread: `{...line,
  // ...{}}` keeps whatever `line.color` held, so the first version of this
  // gate let every bad value straight through. Caught by the test that
  // feeds it a quoted string — a gate has to be asserted against the thing
  // it exists to stop.
  const clean: ChatLine = { ...line, text: line.text.slice(0, MAX_CHAT_TEXT) };
  if (!clean.color || colorProblem(clean.color)) delete clean.color;
  lines.push(clean);
  if (lines.length > MAX_CHAT) lines.splice(0, lines.length - MAX_CHAT);
  for (const cb of listeners) cb();
}

/** A line nobody typed: "X joined", "a bot is playing Y". */
export function addChatSystem(text: string): void {
  addChat({ from: "", text, at: Date.now(), system: true });
}

export function onChat(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Between games — the shell calls this when a table is left. */
export function clearChat(): void {
  lines.length = 0;
  for (const cb of listeners) cb();
}

/**
 * What a message may be. Empty after trimming is not a message; over-long
 * is trimmed rather than refused, because a refusal mid-sentence is worse
 * than a truncation nobody will hit.
 */
export function chatProblem(text: string): string | null {
  if (text.trim() === "") return "nothing to say";
  return null;
}
