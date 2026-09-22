/**
 * Bot playstyles (docs/ai-playstyles-design.md).
 *
 * A playstyle is a `Partial<Weights>` overlay on the tuned defaults —
 * nothing else. Three reasons it is a weight set rather than a subclass:
 *
 *  - `HeuristicAgent` already takes `weights?: Partial<Weights>` and
 *    merges over the defaults, so the seam exists;
 *  - the weight table is documented as **the thing to be argued with**,
 *    and a style is an argument in that same vocabulary;
 *  - it makes every style measurable by the existing bench, because
 *    `PolicySpec.make` is exactly "an agent from a seed". A style that
 *    cannot be benched is a style nobody can tell is working.
 *
 * **`balanced` is `{}` on purpose.** It is the tuned defaults, four
 * rounds of measurement deep (docs/richer-options-design.md §5–§8), and
 * keeping it empty means shipping this feature changes nothing for any
 * bot until a deck or a dropdown says otherwise — so the existing
 * baseline stays comparable.
 */

import { DEFAULT_WEIGHTS, type Weights } from "./heuristic.ts";

export const PLAYSTYLES_LIST = [
  "balanced",
  "bruiser",
  "stalker",
  "turtle",
  "politician",
  "builder",
] as const;
export type Playstyle = (typeof PLAYSTYLES_LIST)[number];

/** What the dropdown shows. "Default" is a separate stored value that
 *  means "whatever this seat's DECK is set to" — not a style. */
export const PLAYSTYLE_LABELS: Record<Playstyle, string> = {
  balanced: "Balanced",
  bruiser: "Bruiser",
  stalker: "Stalker",
  turtle: "Turtle",
  politician: "Politician",
  builder: "Builder",
};

export function isPlaystyle(value: unknown): value is Playstyle {
  return typeof value === "string" && (PLAYSTYLES_LIST as readonly string[]).includes(value);
}

/**
 * The four, as weight overlays.
 *
 * The numbers are a starting point and are meant to be argued with; what
 * is deliberate is the SHAPE of each — which lever each style leans on,
 * and which it leaves alone. Every style leaves `selfOustGuard` untouched:
 * nothing outranks not being ousted, whatever your temperament.
 *
 * SURVIVAL IS THE ONE THING EVERY STYLE NOW STATES (2026-09-22, owner
 * request: bots were spending themselves to death to play a card). Each
 * one sets all three of `poolFloor`, `lowPoolThreshold` and
 * `lowPoolCaution`, and they are the only weights the whole set agrees to
 * have an opinion about — because "how close to death will you go for a
 * card" is a question of temperament in a way that `blockHunt` is not,
 * and because a style that left them out would read as *not caring*
 * rather than as *taking the default*
 * (docs/ai-pool-preservation-design.md §4).
 */
export const PLAYSTYLES: Record<Playstyle, Partial<Weights>> = {
  /** The tuned defaults. The control, and the reason this ships inert. */
  balanced: {},

  /**
   * AGGRESSIVE: pressure over safety.
   *
   * Bleeds harder and values the bleed's size more, presses combat,
   * blocks less readily, and is markedly less afraid of a losing fight.
   * Note it is NOT "combat" — §5 of the design doc records that this
   * bucket holds stealth-bleed decks that never fight, so the style is
   * about pressing an advantage rather than about punching.
   */
  bruiser: {
    bleedPrey: 16,
    bleedPerPoint: 3,
    blockBleed: 4,
    blockHunt: -1,
    blockOutmatched: -2,
    pressToFinish: 8,
    pressWhenLosing: -2,
    strikeDamage: 4,
    hunt: 0,
    // It is in a RACE, and pool held back is tempo it never spends. The
    // lowest threshold of any style and the default floor: it will go
    // right down to the last safe point for a card, but it still will not
    // walk into an oust.
    poolFloor: 2,
    lowPoolThreshold: 6,
    lowPoolCaution: 0.5,
  },

  /**
   * DEFENSIVE: the board over the clock.
   *
   * Blocks readily, keeps its minions alive and fed, and is far more
   * reluctant to throw a vampire into a fight it loses. It hunts sooner,
   * because a fed minion is one that can pay tolls and mend (p. 31).
   */
  turtle: {
    blockBleed: 9,
    blockPerBleedPoint: 3,
    blockCardEffect: 5,
    blockRescue: 6,
    blockOutmatched: -9,
    dodgeWhenLosing: 9,
    pressWhenLosing: -7,
    hunt: 3,
    huntWhenEmpty: 10,
    // THE STYLE THIS FEATURE IS FOR. It starts counting its pool while it
    // still has 14 of it, keeps five in hand come what may, and is the
    // only style that will stop influencing to stay alive — a Turtle at 6
    // pool with a board would rather sit on it than buy another body.
    poolFloor: 5,
    lowPoolThreshold: 14,
    lowPoolCaution: 1.8,
  },

  /**
   * STRATEGIC: the referendum over the bleed.
   *
   * Values calling and winning votes, and stopping other people's. This
   * is the style that most needed the politics stack to exist —
   * before items 0–5 a Politician bot would have been named for a
   * competence it did not have (design doc §11.3).
   */
  politician: {
    voteOwn: 4,
    voteAgainstOthers: 2.5,
    votePoolMe: 1.4,
    votePoolPrey: -1.4,
    voteOustsPrey: 30,
    blockPolitical: 10,
    voteTollCost: 1,
    bleedPrey: 10,
    // A referendum can take four pool off the table in one resolution, so
    // this one wants a buffer for a reason no other style has: the swing
    // it is about to be on the wrong end of is one it can SEE coming and
    // cannot always outvote.
    poolFloor: 3,
    lowPoolThreshold: 10,
    lowPoolCaution: 1.2,
  },

  /**
   * SNEAKY: slip the bleed past, and stay out of the fight.
   *
   * Split out of `bruiser` on 2026-09-19 after measuring what the precons
   * actually play. Seven of the 32 combine heavy bleed with heavy stealth
   * — Fifth Edition Malkavian is 34% bleed and **52% stealth** — and they
   * play nothing like a rush deck. Sneaking a bleed past a blocker and
   * punching somebody are opposite skills, and one weight set cannot want
   * both.
   *
   * So: bleed hard, pay for stealth, and treat combat as a thing to
   * escape rather than win — a stealth bleeder's vampire is worth more
   * unlocked and alive than traded for a body.
   */
  stalker: {
    bleedPrey: 18,
    bleedPerPoint: 3.5,
    effectValue: { ...DEFAULT_WEIGHTS.effectValue, stealth: 2.5, bleed: 4 },
    // It does not want the block, and it does not want the fight the
    // block would start.
    blockBleed: 3,
    blockOutmatched: -10,
    dodgeWhenLosing: 9,
    pressWhenLosing: -8,
    pressToFinish: 2,
    strikeDamage: 1,
    // Close to the default. A stealth bleeder wins on the clock, so it
    // spends fairly freely — but its cards are cheap and its vampires do
    // the work, so there is rarely a reason to go to the last point.
    poolFloor: 2,
    lowPoolThreshold: 7,
    lowPoolCaution: 0.7,
  },

  /**
   * BUILDER: put bodies on the table and grind.
   *
   * The second cluster the measurement turned up, and the one I did not
   * expect: six precons are mostly PERMANENTS — allies, retainers,
   * equipment — rather than bleed, combat or votes. New Blood III
   * Tzimisce is 44% board against 8% bleed. They were scattered across
   * three other styles, none of which describes them.
   *
   * It is also a partial answer to a defect that affects every bot: a
   * permanent is scored at a flat `playCard` and a bleed at six times
   * that, so no bot ever employs a retainer
   * (docs/ai-politics-bench-design.md §7.3). A Builder is the one style
   * that should, and raising it here is the safe place to find out
   * whether it helps before touching the default.
   */
  builder: {
    playCard: 4,
    effectValue: { ...DEFAULT_WEIGHTS.effectValue, board: 3, bloodGain: 1 },
    // A board is worth having only if it survives, and the bodies are
    // the point rather than the currency.
    blockOutmatched: -9,
    bleedPrey: 9,
    // Feeding the board is real work for this style, not a wasted phase.
    hunt: 3,
    huntWhenEmpty: 10,
    // THE AWKWARD ONE, and the reason `lowPoolCaution` is a separate
    // weight from the threshold. A Builder spends pool by design — it is
    // the style that pays for permanents — so it starts watching EARLY
    // (11) and then charges itself LIGHTLY (0.8) for what it spends. High
    // threshold, low caution: keep a cushion, but do not stop building
    // once you are inside it.
    poolFloor: 3,
    lowPoolThreshold: 11,
    lowPoolCaution: 0.8,
  },
};
