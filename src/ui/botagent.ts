/**
 * THE ONE PLACE A BOT IS BUILT (docs/ai-playstyles-design.md §6).
 *
 * `new HeuristicAgent({ seed: seatSeed(seat) })` appeared in **five**
 * places before this — three in `loop.ts`, two in `shell.ts` — each
 * spelling out the same thing. Adding a two-branch playstyle rule to
 * five copies is five chances to drift, which is the lesson this project
 * has paid for more than once; so the rule lives here and the five sites
 * call it.
 *
 * The seed is unchanged and still comes from the seat id: a playstyle
 * changes WEIGHTS, never the RNG. Two agents with the same seed and the
 * same style make identical choices, and switching style must not change
 * how many numbers are drawn — a style that perturbed the stream would
 * make a replay a lie (architecture principle 2).
 */

import { HeuristicAgent } from "../ai/heuristic.ts";
import { PLAYSTYLES, isPlaystyle, type Playstyle } from "../ai/playstyles.ts";
import deckPlaystyles from "../../config/deck-playstyles.json" with { type: "json" };
import type { DeckSource } from "./newgame.ts";
import { botPlaystyleFor, seatSeed, type UiSettings } from "./settings.ts";

const STYLES = (deckPlaystyles as { styles: Record<string, string> }).styles;

/**
 * The style a DECK plays, or null when nothing says.
 *
 * TOTAL over every deck source by construction: a pasted or imported
 * deck has no precon identity at all, and an unknown precon key is
 * equally possible the day a set is added. Both mean "no opinion", never
 * an error — the caller falls back to balanced.
 */
export function deckPlaystyle(deck: DeckSource | null | undefined): Playstyle | null {
  if (!deck || deck.kind !== "precon") return null;
  const found = STYLES[`${deck.set}|${deck.name}`];
  return isPlaystyle(found) ? found : null;
}

/**
 * Which style this bot seat actually plays.
 *
 * The owner's rule, in order: the Profile OVERRIDE if one is set, else
 * the DECK's style, else balanced. `botIndex` is 1-based and positional,
 * matching the "Bot 1…5" boxes.
 */
export function playstyleFor(
  settings: UiSettings,
  botIndex: number,
  deck: DeckSource | null | undefined,
): Playstyle {
  return botPlaystyleFor(settings, botIndex) ?? deckPlaystyle(deck) ?? "balanced";
}

export interface BotAgentOptions {
  /** Explicit style, when the caller already knows it — a saved game
   *  restoring the bots it was saved with (§9.1). */
  playstyle?: Playstyle;
  settings?: UiSettings;
  /** 1-based bot seat index, for the positional Profile override. */
  botIndex?: number;
  deck?: DeckSource | null;
}

/**
 * A bot that remembers which style it was built with.
 *
 * The style is stamped on the agent rather than tracked beside it,
 * because the one place that needs to read it back is the SAVE
 * (`SavedGame.botPlaystyles`, §9.1) and the transport already holds the
 * agents. A parallel map keyed by seat would be a second thing to keep
 * in step with `setAgent`, and it would get out of step the first time a
 * seat was handed back to a human.
 */
export type StyledAgent = HeuristicAgent & { readonly playstyle: Playstyle };

/** The style an agent was built with, or null for one that was not built
 *  here (a test's bare `HeuristicAgent`, or a human seat). */
export function playstyleOf(agent: unknown): Playstyle | null {
  const found = (agent as { playstyle?: unknown } | null)?.playstyle;
  return isPlaystyle(found) ? found : null;
}

/** A bot for `seat`, with the weights its style calls for. */
export function botAgentFor(seat: string, opts: BotAgentOptions = {}): StyledAgent {
  const style =
    opts.playstyle ??
    (opts.settings && opts.botIndex !== undefined
      ? playstyleFor(opts.settings, opts.botIndex, opts.deck)
      : (deckPlaystyle(opts.deck) ?? "balanced"));
  const agent = new HeuristicAgent({
    seed: seatSeed(seat),
    // `balanced` is `{}`, so this is the tuned default and the object is
    // passed anyway — one path, not two.
    weights: PLAYSTYLES[style],
  });
  return Object.assign(agent, { playstyle: style }) as StyledAgent;
}
