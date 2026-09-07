/**
 * Batch simulation (phase 5, docs/ai-v1-design.md §4).
 *
 * Runs whole games headlessly — no DOM, no transport, no UI — by driving
 * the engine's own pull loop: ask for the decision, ask the seat's agent,
 * apply, repeat. That is the same loop the debug UI uses, which is the
 * point: an agent that works here works at a real table.
 *
 * Everything is seeded. A run is reproducible from `{seed, games}` alone,
 * which is architecture principle 2 paying out again: a failing game can
 * be replayed exactly, and a batch that changes between runs means the
 * code changed, not the dice.
 */

import type { Agent } from "../engine/agent.ts";
import { redactFor, viewFor } from "../engine/agent.ts";
import { VtesEngine } from "../engine/engine.ts";
import type { HandlerRegistry } from "../engine/handlers.ts";
import type { GameState, SeatId } from "../engine/state.ts";

export interface GameResult {
  seed: number;
  /** The seat that won, or null for a draw (the turn cap, an engine
   *  safeguard rather than a rule). */
  winner: SeatId | null;
  /** Victory points per seat at the end. */
  victoryPoints: Record<SeatId, number>;
  /** Pool per seat at the end — 0 means ousted. */
  pool: Record<SeatId, number>;
  ousted: SeatId[];
  turns: number;
  decisions: number;
  events: number;
  /** Set when the game ended by throwing rather than finishing. */
  error?: string;
}

export interface BatchOptions {
  games: number;
  /** The first game's seed; each later game uses `seed + n`. */
  seed: number;
  /** Build a fresh starting state for one seed. */
  buildState: (seed: number) => GameState;
  /** One agent per seat id. A seat with no agent is a hard error: a
   *  silent fallback would make the batch measure something other than
   *  the agents under test. */
  agents: (seed: number) => Record<SeatId, Agent>;
  registry: HandlerRegistry;
  /** Safety net for a policy that stalls; not a game rule. */
  maxDecisions?: number;
  /** Called after each game, for progress reporting. */
  onGame?: (r: GameResult, index: number) => void;
}

export interface BatchSummary {
  games: number;
  results: GameResult[];
  /** Wins per seat, plus draws. */
  wins: Record<SeatId, number>;
  draws: number;
  errors: number;
  /** Mean turns and decisions across completed games. */
  meanTurns: number;
  meanDecisions: number;
  /** Mean victory points per seat — the real signal when seats are
   *  asymmetric, because a 5-player table has no symmetric "win rate". */
  meanVictoryPoints: Record<SeatId, number>;
}

/** Play one game to completion. Never throws: a crash is a result. */
export function runGame(
  seed: number,
  state: GameState,
  agents: Record<SeatId, Agent>,
  registry: HandlerRegistry,
  maxDecisions = 20000,
): GameResult {
  const engine = new VtesEngine(state, registry);
  let decisions = 0;
  let error: string | undefined;
  try {
    for (;;) {
      const dp = engine.decision();
      if (!dp) break;
      if (decisions++ >= maxDecisions) {
        error = `exceeded ${maxDecisions} decisions`;
        break;
      }
      const agent = agents[dp.seat];
      if (!agent) throw new Error(`no agent for seat ${dp.seat}`);
      // The agent sees the MASKED view, never the state. This is the one
      // line that makes the AI honest (principle 5).
      // The masked state is the SAME information as the view, in the form
      // a search agent can apply a move to — and is exactly what a peer is
      // sent (docs/ai-v2-design.md §2). A policy agent ignores it.
      const choice = agent.decide(
        dp,
        dp.options,
        viewFor(engine.state, dp.seat),
        redactFor(engine.state, dp.seat),
      );
      if (!dp.options.some((o) => o.id === choice)) {
        throw new Error(`agent for ${dp.seat} chose "${choice}", which was not offered`);
      }
      engine.choose(choice);
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const s = engine.state;
  const ended = [...s.eventLog].reverse().find((e) => e.type === "GameEnded");
  const victoryPoints: Record<SeatId, number> = {};
  const pool: Record<SeatId, number> = {};
  for (const seat of s.seats) {
    victoryPoints[seat.id] = seat.victoryPoints;
    pool[seat.id] = seat.pool;
  }
  const result: GameResult = {
    seed,
    winner: ended && ended.type === "GameEnded" ? ended.winner : null,
    victoryPoints,
    pool,
    ousted: s.seats.filter((x) => x.ousted).map((x) => x.id),
    turns: s.eventLog.filter((e) => e.type === "TurnBegan").length,
    decisions,
    events: s.eventLog.length,
  };
  if (error !== undefined) result.error = error;
  return result;
}

export function runBatch(opts: BatchOptions): BatchSummary {
  const results: GameResult[] = [];
  for (let i = 0; i < opts.games; i++) {
    const seed = opts.seed + i;
    const r = runGame(
      seed,
      opts.buildState(seed),
      opts.agents(seed),
      opts.registry,
      opts.maxDecisions,
    );
    results.push(r);
    opts.onGame?.(r, i);
  }

  const wins: Record<SeatId, number> = {};
  const vpTotal: Record<SeatId, number> = {};
  for (const r of results) {
    for (const seat of Object.keys(r.victoryPoints)) {
      wins[seat] ??= 0;
      vpTotal[seat] = (vpTotal[seat] ?? 0) + (r.victoryPoints[seat] ?? 0);
    }
    if (r.winner) wins[r.winner] = (wins[r.winner] ?? 0) + 1;
  }
  const completed = results.filter((r) => r.error === undefined);
  const meanVictoryPoints: Record<SeatId, number> = {};
  for (const seat of Object.keys(vpTotal)) {
    meanVictoryPoints[seat] = vpTotal[seat]! / Math.max(1, results.length);
  }
  return {
    games: results.length,
    results,
    wins,
    draws: results.filter((r) => r.winner === null && r.error === undefined).length,
    errors: results.filter((r) => r.error !== undefined).length,
    meanTurns: mean(completed.map((r) => r.turns)),
    meanDecisions: mean(completed.map((r) => r.decisions)),
    meanVictoryPoints,
  };
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** A one-screen report of a batch, for the CLI and for test failures. */
export function formatSummary(s: BatchSummary): string {
  const lines: string[] = [];
  lines.push(`games: ${s.games}   draws: ${s.draws}   errors: ${s.errors}`);
  lines.push(
    `mean turns: ${s.meanTurns.toFixed(1)}   mean decisions: ${s.meanDecisions.toFixed(0)}`,
  );
  lines.push("");
  lines.push("seat            wins   mean VP");
  for (const seat of Object.keys(s.meanVictoryPoints).sort()) {
    lines.push(
      `${seat.padEnd(14)} ${String(s.wins[seat] ?? 0).padStart(5)}   ${
        s.meanVictoryPoints[seat]!.toFixed(2)
      }`,
    );
  }
  if (s.errors > 0) {
    lines.push("");
    lines.push("errors:");
    const seen = new Map<string, number>();
    for (const r of s.results) {
      if (!r.error) continue;
      seen.set(r.error, (seen.get(r.error) ?? 0) + 1);
    }
    for (const [msg, n] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
      const example = s.results.find((r) => r.error === msg)!;
      lines.push(`  ${n}x  ${msg}   (first at seed ${example.seed})`);
    }
  }
  return lines.join("\n");
}
