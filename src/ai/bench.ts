/**
 * Comparing two AI policies fairly (docs/ai-bench-design.md).
 *
 * `batch.ts` answers "does the AI play a whole game without falling
 * over". This answers a harder question: **is policy B better than policy
 * A** — and it exists because until now nothing could tell.
 *
 * Three things make an answer meaningless, and each is dealt with here:
 *
 *  1. **Different decks.** `npm run simulate` plays the playtest snapshot,
 *     where the seats hold different decks and different pools. A win
 *     there measures the deck. So a match is a MIRROR: the same deck in
 *     every seat, dealt fresh (p. 14), so the only thing that differs is
 *     who is deciding.
 *
 *  2. **Seat position.** Your prey and your predator are fixed by where
 *     you sit, and the seat that starts is chosen by the deal. So every
 *     seed is played once per ROTATION of the policy assignment: each
 *     policy sits in each seat the same number of times, against the same
 *     shuffle. That is a paired design, and it is what makes a few hundred
 *     games enough.
 *
 *  3. **Noise.** A difference is reported with a margin, so a 0.05 that
 *     means nothing looks like a 0.05 that means nothing.
 *
 * The metric is VICTORY POINTS, not wins. VTES is a multiplayer game
 * where "winning" is one seat out of four or five, so win counts throw
 * away most of what happened; VPs are the game's own measure and every
 * oust shows up in them (p. 43).
 *
 * Like `batch.ts`, this takes a `buildState` rather than importing the
 * deck builder: the AI layer must not reach into the UI's, so the caller
 * wires the decks (principle 1).
 */

import type { Agent } from "../engine/agent.ts";
import type { HandlerRegistry } from "../engine/handlers.ts";
import type { GameState, SeatId } from "../engine/state.ts";
import { runGame, type GameResult } from "./batch.ts";

/** One contender. `make` is called per seat per game, so a policy that
 *  holds state cannot leak it from one game into the next. */
export interface PolicySpec {
  name: string;
  make: (seed: number) => Agent;
}

export interface MatchOptions {
  /** The two policies to compare. The same spec twice is the CONTROL
   *  run — see `AA` in the tests: it must come out a dead heat, or the
   *  harness is measuring itself. */
  policies: [PolicySpec, PolicySpec];
  /** Seat ids, in table order. Length decides the rotation count. */
  seats: SeatId[];
  /** How many distinct deals. Each is played `seats.length` times. */
  deals: number;
  /** First deal's seed; later deals use seed + n. */
  seed: number;
  buildState: (seed: number) => GameState;
  registry: HandlerRegistry;
  onGame?: (r: GameResult, policyBySeat: Record<SeatId, string>, index: number) => void;
}

export interface PolicyScore {
  name: string;
  /** How many seats-worth of games this policy played. */
  games: number;
  meanVictoryPoints: number;
  /** Standard error of that mean — the honest width of the answer. */
  standardError: number;
  /** Games in which this policy's seat held the most VPs (ties count for
   *  nobody, the way a shared lead is not a win). */
  wins: number;
  /** Games in which this policy's seat was ousted. */
  ousted: number;
}

export interface MatchSummary {
  policies: [PolicyScore, PolicyScore];
  /** Mean VP of the first policy minus the second. */
  difference: number;
  /** 95% margin on that difference. A difference smaller than its own
   *  margin is not a finding. */
  margin: number;
  /** True when the difference clears its margin. */
  significant: boolean;
  games: number;
  draws: number;
  errors: number;
  /** Mean VP by SEAT INDEX, whoever was sitting there — the seat bias the
   *  rotation exists to cancel. Reported so it can be seen rather than
   *  assumed away. */
  meanVictoryPointsBySeat: number[];
  /** One reproducing seed per distinct error message. */
  errorSeeds: Record<string, number>;
}

/**
 * Which policy sits in which seat, for one rotation.
 *
 * A BLOCK — the first half of the table to policy 0, the rest to policy 1
 * — rotated one seat per pass. Every policy sits in every seat the same
 * number of times across the full set of rotations.
 *
 * It was written as an ALTERNATING pattern first, and that was a real
 * bug: `[0,1,0,1]` rotated by one is `[1,0,1,0]` and then `[0,1,0,1]`
 * again, so a 4-seat table produced only TWO distinct assignments and
 * played each twice. Half the games were exact duplicates — same deal,
 * same seating, same dice — which wasted the time and, worse, told the
 * margin it had twice the sample it really did. The control run gave
 * exactly 0.000, which was the tell: a measurement that cannot come out
 * any other way is not a measurement.
 */
export function assignment(rotation: number, seats: number): number[] {
  const half = Math.ceil(seats / 2);
  const out: number[] = [];
  for (let i = 0; i < seats; i++) {
    // Which seat of the base pattern this seat is playing this rotation.
    const base = (i - rotation + seats * seats) % seats;
    out.push(base < half ? 0 : 1);
  }
  return out;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Standard error of the mean. Zero for fewer than two samples, because
 *  one game says nothing about spread. */
function standardError(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance / xs.length);
}

export function runMatch(opts: MatchOptions): MatchSummary {
  const { policies, seats, deals, seed, buildState, registry } = opts;
  const vp: [number[], number[]] = [[], []];
  /**
   * Per GAME, policy 0's mean VP minus policy 1's.
   *
   * This is what the margin is computed from, and it has to be, because
   * the two policies' scores come out of the SAME game and are strongly
   * negatively correlated — the victory points in a game are close to a
   * fixed total (an oust each, plus one for the last standing, p. 43), so
   * one policy scoring more forces the other to score less.
   *
   * Treating them as two independent samples — `sqrt(seA² + seB²)` — gets
   * this exactly backwards: `Var(A-B) = Var(A) + Var(B) - 2Cov(A,B)`, and
   * a negative covariance makes the true variance LARGER than that
   * formula, not smaller. So the first version reported margins that were
   * too NARROW, which is the dangerous direction: it would have called
   * noise a finding. A paired difference measures the thing directly and
   * needs no covariance term at all.
   *
   * It is a mean per seat rather than a total, so an odd-sized table —
   * where one policy holds one more seat — is not counted as ahead for
   * having more chairs.
   */
  const perGameDiff: number[] = [];
  const wins = [0, 0];
  const ousted = [0, 0];
  const seatVp: number[][] = seats.map(() => []);
  const errorSeeds: Record<string, number> = {};
  let draws = 0;
  let errors = 0;
  let index = 0;

  for (let d = 0; d < deals; d++) {
    const gameSeed = seed + d;
    for (let rotation = 0; rotation < seats.length; rotation++) {
      const which = assignment(rotation, seats.length);
      const agents: Record<SeatId, Agent> = {};
      const policyBySeat: Record<SeatId, string> = {};
      seats.forEach((id, i) => {
        const p = policies[which[i]!]!;
        // The tie-breaking stream belongs to the SEAT, not to the policy:
        // rotating the assignment must not also change the dice, or the
        // rotation would be measuring two things at once.
        agents[id] = p.make(gameSeed * 1000 + i);
        policyBySeat[id] = p.name;
      });

      // Every rotation replays the SAME DEAL. That is the whole point of
      // the pairing: the shuffle is held constant and only the seating of
      // the policies moves.
      const result = runGame(gameSeed, buildState(gameSeed), agents, registry);
      index++;
      if (result.error) {
        errors++;
        errorSeeds[result.error] ??= gameSeed;
      }
      if (result.winner === null) draws++;

      const best = Math.max(...seats.map((id) => result.victoryPoints[id] ?? 0));
      const leaders = seats.filter((id) => (result.victoryPoints[id] ?? 0) === best);
      const inGame: [number[], number[]] = [[], []];
      seats.forEach((id, i) => {
        const p = which[i]!;
        const points = result.victoryPoints[id] ?? 0;
        vp[p]!.push(points);
        inGame[p]!.push(points);
        seatVp[i]!.push(points);
        // A shared lead is nobody's win — otherwise a four-way tie on
        // zero would count as four wins.
        if (leaders.length === 1 && leaders[0] === id) wins[p]!++;
        if ((result.pool[id] ?? 0) <= 0) ousted[p]!++;
      });
      // Only when both policies actually had a seat: a one-sided game
      // says nothing about the difference between them.
      if (inGame[0].length > 0 && inGame[1].length > 0) {
        perGameDiff.push(mean(inGame[0]) - mean(inGame[1]));
      }
      opts.onGame?.(result, policyBySeat, index - 1);
    }
  }

  const score = (i: 0 | 1): PolicyScore => ({
    name: policies[i].name,
    games: vp[i].length,
    meanVictoryPoints: mean(vp[i]),
    standardError: standardError(vp[i]),
    wins: wins[i]!,
    ousted: ousted[i]!,
  });
  const a = score(0);
  const b = score(1);
  // Both read off the SAME per-game differences, so the headline number
  // and the margin can never disagree about which way the result went.
  const difference = mean(perGameDiff);
  const margin = 1.96 * standardError(perGameDiff);

  return {
    policies: [a, b],
    difference,
    margin,
    significant: Math.abs(difference) > margin,
    games: index,
    draws,
    errors,
    meanVictoryPointsBySeat: seatVp.map(mean),
    errorSeeds,
  };
}

export function formatMatch(s: MatchSummary, seats: SeatId[]): string {
  const [a, b] = s.policies;
  const row = (p: PolicyScore): string =>
    `  ${p.name.padEnd(18)} ${p.meanVictoryPoints.toFixed(3)} VP ` +
    `±${(1.96 * p.standardError).toFixed(3)}   ` +
    `${p.wins} wins   ${p.ousted} ousted   (${p.games} seats played)`;

  const verdict = s.significant
    ? `${s.difference > 0 ? a.name : b.name} is ahead by ` +
      `${Math.abs(s.difference).toFixed(3)} VP (margin ±${s.margin.toFixed(3)})`
    : `NO DIFFERENCE PROVEN — gap ${s.difference.toFixed(3)} VP is inside ` +
      `its own margin of ±${s.margin.toFixed(3)}`;

  const bias = s.meanVictoryPointsBySeat
    .map((v, i) => `${seats[i] ?? i}=${v.toFixed(2)}`)
    .join("  ");

  return [
    `${s.games} games, ${s.draws} draws, ${s.errors} errors`,
    row(a),
    row(b),
    "",
    verdict,
    "",
    `seat bias (cancelled by rotation, shown so it can be judged): ${bias}`,
    ...Object.entries(s.errorSeeds).map(([msg, seed]) => `  ERROR seed ${seed}: ${msg}`),
  ].join("\n");
}
