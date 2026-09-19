/**
 * AI v2 — a SEARCH agent (docs/ai-v2-design.md).
 *
 * Where `HeuristicAgent` prices each option from a table, this one plays
 * the move and looks at what happens: clone, apply, evaluate the position,
 * keep the best. That is the one thing a per-option score structurally
 * cannot do (docs/richer-options-design.md §8) — a plan is about the
 * position a move leads to, not about the move's own label.
 *
 * THE HIDDEN-INFORMATION BOUNDARY IS THE WHOLE DESIGN, and it is the
 * owner's ruling of 2026-09-06: "The AI should work like a player and only
 * work off of the information a normal player would possibly know or can
 * see/read from the table."
 *
 * So this searches on `redactFor(state, seat)` — a real `GameState` with
 * every card this seat may not see already blanked. Three things make that
 * legitimate rather than a loophole:
 *
 *  1. it is **exactly the object multiplayer sends to a remote player**
 *     (`LocalTransport.stateFor`), so everything in it is readable by a
 *     person playing that seat from another machine;
 *  2. it is produced by `redactFor`, which is THE masking rule — there is
 *     no second set of rules here to get wrong;
 *  3. `tests/ai/information-boundary.test.ts` checks it, per card
 *     instance, over whole games.
 *
 * What it therefore CANNOT do, and does not pretend to: it cannot know
 * what an opponent holds, so it cannot search their replies. It looks one
 * ply — its own move — and evaluates. Deeper search needs determinization
 * (guessing the hidden cards), which is a separate piece of work and needs
 * deck knowledge this projection deliberately does not carry (§6).
 */

import type { Agent, PlayerView } from "../engine/agent.ts";
import { viewFor } from "../engine/agent.ts";
import { VtesEngine } from "../engine/engine.ts";
import type { HandlerRegistry } from "../engine/handlers.ts";
import type { DecisionPoint, LegalOption } from "../engine/options.ts";
import type { GameState, SeatId } from "../engine/state.ts";
import { HeuristicAgent, type Weights } from "./heuristic.ts";
import { predatorOf, preyOf } from "./seats.ts";

/** How a position is judged. Every term is something a player can see. */
export interface SearchWeights {
  /** Victory points, which are what the game is scored in (p. 43). */
  victoryPoints: number;
  /** Your own pool: it is your life, and the game is won by removing
   *  other people's (p. 4). */
  pool: number;
  /** Your PREY's pool, negatively — the pool you are trying to remove. */
  preyPool: number;
  /** Your predator's pool, negatively and much more weakly: they are a
   *  threat, but not yours to oust. */
  predatorPool: number;
  /** Capacity of your ready minions — the board you act with. */
  board: number;
  /**
   * A counter already moved onto an uncontrolled vampire.
   *
   * WITHOUT THIS THE SEARCH CANNOT INFLUENCE. A transfer moves 1 pool
   * (worth `pool`) onto a card that will not reach play for several more
   * turns, so a one-ply lookahead sees a pure loss and never does it — and
   * influence is 39.6% of every real choice. Pricing a committed counter
   * near `pool` makes a transfer roughly value-neutral in the moment,
   * which is what it actually is: the pool is not gone, it is spent
   * (p. 35–36, and it becomes the vampire's blood on taking control).
   */
  uncontrolled: number;
  /** Blood on your minions: fuel, worth much less than pool. */
  blood: number;
  /** Cards in hand. */
  hand: number;
  /** Being ousted. Dominates everything. */
  ousted: number;
  /**
   * How much of the final score is the LOOKAHEAD, against the tuned
   * policy's own opinion of the option.
   *
   * A blend rather than a replacement, and deliberately: the policy is
   * four rounds of measurement deep (docs/richer-options-design.md §5–§8),
   * and a one-ply search with a crude value function is not automatically
   * better than that. 1 is pure search, 0 is pure policy.
   */
  lookahead: number;
}

export const DEFAULT_SEARCH_WEIGHTS: SearchWeights = {
  victoryPoints: 100,
  pool: 3,
  preyPool: -2,
  predatorPool: -0.3,
  board: 1,
  uncontrolled: 3,
  blood: 0.3,
  hand: 0.5,
  ousted: -500,
  lookahead: 1,
};

export interface SearchOptions {
  registry: HandlerRegistry;
  seed?: number;
  weights?: Partial<SearchWeights>;
  /** Weights for the fallback policy, which also supplies the blended
   *  per-option opinion. */
  policyWeights?: Partial<Weights>;
  /** Options to look at, most promising first. A cap, because the cost is
   *  linear in it and one decision in this game can offer 2168 legal
   *  terms (Revolutionary Council). */
  maxOptions?: number;
}

export class SearchAgent implements Agent {
  private readonly policy: HeuristicAgent;
  private readonly w: SearchWeights;
  private readonly registry: HandlerRegistry;
  private readonly maxOptions: number;
  /** Counted, not logged: a simulation that throws is a fact about the
   *  engine worth reporting, and silently falling back would hide it. */
  public simulationFailures = 0;
  public simulationsRun = 0;
  /**
   * Votes the OPPONENT MODEL cast inside a simulation.
   *
   * Public for the same reason the two counters above are: a model that
   * never ran would look exactly like one that ran and changed nothing,
   * and the difference is the whole feature. A test that asserts the
   * agent's final CHOICE cannot tell them apart — the policy votes
   * correctly on its own since item 3, so the argmax agrees either way.
   */
  public modelledVotes = 0;
  private rng: number;

  constructor(opts: SearchOptions) {
    this.registry = opts.registry;
    this.w = { ...DEFAULT_SEARCH_WEIGHTS, ...opts.weights };
    this.maxOptions = opts.maxOptions ?? 24;
    this.rng = (opts.seed ?? 1) >>> 0;
    this.policy = new HeuristicAgent({
      seed: opts.seed ?? 1,
      ...(opts.policyWeights ? { weights: opts.policyWeights } : {}),
    });
  }

  decide(
    dp: DecisionPoint,
    options: LegalOption[],
    view: PlayerView,
    masked?: GameState,
  ): string {
    const fallback = this.policy.decide(dp, options, view);
    // No state to search, or nothing to choose between.
    if (!masked || options.length < 2) return fallback;

    // The policy's opinion does two jobs: it is half the score, and it
    // ORDERS the candidates so a cap keeps the ones worth looking at.
    const scored = options
      .map((o) => ({ o, policy: this.policy.score(o, dp, view) }))
      .sort((a, b) => b.policy - a.policy)
      .slice(0, this.maxOptions);

    // ONCE per decision, not once per option: every candidate must be
    // judged against the same deck, or the comparison measures the
    // shuffle instead of the move.
    const world = this.determinize(masked, dp.seat);
    const before = this.evaluate(world, dp.seat);
    /** Policy opinion plus the lookahead. A move that could not be
     *  simulated keeps its policy score and loses the lookahead term
     *  rather than being dropped: an option that cannot be searched is
     *  not an illegal one. */
    const total = (o: LegalOption, policy: number): number => {
      const gain = this.simulate(world, dp, o);
      return policy + (gain === null ? 0 : this.w.lookahead * (gain - before));
    };

    // SEEDED WITH THE POLICY'S OWN CHOICE, so the search must strictly
    // BEAT it to override it. Without this the two agents disagree on
    // every tie — the policy breaks ties on its seeded stream, this one
    // would break them by candidate order — and then `lookahead: 0` is
    // not the policy, which is the control every measurement here rests
    // on. Its own test caught exactly that.
    let bestId = fallback;
    const seed = scored.find((x) => x.o.id === fallback);
    let best = seed ? total(seed.o, seed.policy) : -Infinity;
    for (const { o, policy } of scored) {
      if (o.id === fallback) continue;
      const t = total(o, policy);
      if (t > best) {
        best = t;
        bestId = o.id;
      }
    }
    return bestId;
  }

  /**
   * Fill in this seat's OWN library with the cards it knows are in there.
   *
   * Owner ruling, 2026-09-06: "The AI should know what cards they have in
   * their deck." A player built their deck, so a simulated draw should
   * produce a card they might actually draw — not the blank the masking
   * leaves behind, which makes every simulated replacement draw worthless.
   *
   * It is a DETERMINIZATION, not knowledge: the library's ORDER is still
   * hidden (p. 14), so this assigns the remaining cards in a seeded
   * arbitrary order and any one simulation sees one plausible deck rather
   * than the real one. The remainder is the deck minus everything the
   * owner can see has left it — hand, ash heap, and cards in play.
   *
   * Nobody else's library is touched. Deck lists are private in VTES, so
   * an opponent's deck is exactly the thing this agent may not guess from
   * (docs/ai-v2-design.md §6).
   */
  /** PUBLIC so its effect can be asserted directly: a determinization
   *  that silently did nothing would look exactly like one that did
   *  nothing useful. */
  determinize(masked: GameState, seat: SeatId): GameState {
    const s = masked.seats.find((x) => x.id === seat);
    if (!s?.deckList) return masked;
    const left = new Map<string, number>();
    for (const name of s.deckList.library) left.set(name, (left.get(name) ?? 0) + 1);
    const spend = (name: string): void => {
      const n = left.get(name);
      if (n === undefined) return;
      if (n <= 1) left.delete(name);
      else left.set(name, n - 1);
    };
    for (const c of s.hand) spend(c.name);
    for (const c of s.ashHeap ?? []) spend(c.name);
    for (const p of s.permanents) spend(p.card.name);
    for (const m of s.minions) for (const p of m.attached) spend(p.card.name);

    const pool: string[] = [];
    for (const [name, n] of left) for (let i = 0; i < n; i++) pool.push(name);
    // Seeded, so a decision is reproducible: architecture principle 2
    // applies to the agent's own dice as much as to the engine's.
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    const out = structuredClone(masked);
    const mine = out.seats.find((x) => x.id === seat);
    if (!mine) return out;
    mine.library = mine.library.map((c, i) => ({ ...c, name: pool[i] ?? c.name }));
    return out;
  }

  /** The agent's own seeded stream — never `Math.random`, which would
   *  make a replay a lie (principle 2). */
  private random(): number {
    this.rng = (this.rng * 1664525 + 1013904223) >>> 0;
    return this.rng / 0x100000000;
  }

  /** Apply one option to a private clone and value the result. `null` if
   *  the simulation could not be run. */
  private simulate(masked: GameState, dp: DecisionPoint, o: LegalOption): number | null {
    this.simulationsRun++;
    try {
      const sim = new VtesEngine(structuredClone(masked), this.registry);
      const seen = sim.decision();
      // The masked state must be offering the same decision, or we would
      // be searching a different game than the one being played.
      if (!seen || seen.seq !== dp.seq || !seen.options.some((x) => x.id === o.id)) return null;
      sim.choose(o.id);
      this.settle(sim, dp.seat);
      return this.evaluate(sim.state, dp.seat);
    } catch {
      this.simulationFailures++;
      return null;
    }
  }

  /**
   * Run the simulated game on until the action in flight has RESOLVED,
   * with every seat passing.
   *
   * WITHOUT THIS THE SEARCH SEES COSTS AND NOT BENEFITS, which is not a
   * tuning problem but the shape of the game: almost nothing in VTES pays
   * off at the moment it is chosen. Announcing a bleed transfers no pool
   * and locks the actor; playing a master spends the pool immediately and
   * returns its value over the next several turns. Evaluated one step
   * after the choice, every constructive move looks like a loss and
   * passing looks free.
   *
   * "Everyone passes" is a stated approximation, not a model of the
   * opponents: it is the branch where nobody reacts. It is also the only
   * branch this agent may legitimately explore, since it cannot see their
   * hands and so cannot know what they would answer with (§6).
   *
   * **WITH ONE EXCEPTION, and it is the one place in VTES where it is
   * legitimate: POLLING** (owner ruling, 2026-09-19;
   * docs/ai-vote-search-horizon-design.md §4). See `settleChoice`.
   */
  private settle(sim: VtesEngine, me: SeatId, limit = 60): void {
    for (let i = 0; i < limit; i++) {
      const dp = sim.decision();
      if (!dp) return;
      // Stop as soon as nothing is in flight: the action has resolved and
      // anything further is the next decision, not this one's consequence.
      //
      // A REFERENDUM COUNTS AS IN FLIGHT, and it did not before — which
      // is why a cast vote used to be evaluated at the cast rather than
      // at the tally, leaving both directions identical and the whole
      // lookahead contributing nothing to a vote (§1). It is the same
      // argument as the rest of this comment: almost nothing in VTES pays
      // off at the moment it is chosen.
      const busy = sim.state.frames.some(
        (f) =>
          f.kind === "action" ||
          f.kind === "combat" ||
          f.kind === "cardPlay" ||
          f.kind === "referendum",
      );
      if (!busy) return;
      const choice = this.settleChoice(sim, dp, me);
      if (choice === null) return;
      sim.choose(choice);
    }
  }

  /**
   * What the simulated table does at one decision: pass, except at
   * another seat's POLLING decision, where it votes.
   *
   * THIS IS THE PROJECT'S FIRST OPPONENT MODEL, and it is narrow on
   * purpose. `ai-v2-design.md` §6 called modelling a reply unsolved
   * because a reply normally depends on a hidden hand. **Polling is the
   * exception**: a vote is decided from the referendum's declared terms,
   * the seating, and pool totals — all of it face up — so computing what
   * another seat would do is a model of a rational player rather than a
   * peek at their cards.
   *
   * Three properties keep it honest:
   *
   *  - it runs the SAME policy formula the seat itself would use, from
   *    `viewFor(sim.state, thatSeat)` — one formula, one place;
   *  - the state it reads is **already redacted for the SEARCHER**, so a
   *    modelled opponent is given no more than the searcher can see and
   *    usually less (their own hand is blanked to them). The model can
   *    only ever be more ignorant than the real player, never better
   *    informed, which is the safe direction;
   *  - it models only VOTES. The modelled seat never plays a card, so
   *    nothing here can invent a reaction out of a hand nobody can see.
   *
   * Known false-positive mode, stated rather than hidden: a vote-granting
   * card played later from a hand nobody can see can change an outcome
   * this model called. That is the same limit `castVote.decided` carries
   * (docs/ai-vote-economy-design.md §4), and the same reason this drives
   * an evaluation rather than a rule.
   */
  private settleChoice(sim: VtesEngine, dp: DecisionPoint, me: SeatId): string | null {
    const pass = dp.options.find((o) => o.kind === "pass");
    if (dp.seat !== me && dp.window === "referendum.polling") {
      const votes = dp.options.filter((o) => o.kind === "castVote");
      if (votes.length > 0) {
        const view = viewFor(sim.state, dp.seat);
        // Seeded with PASSING, so a vote has to beat declining to be
        // cast — the same shape as the search's own fallback seeding.
        let bestId: string | null = pass?.id ?? null;
        let best = pass ? this.policy.score(pass, dp, view) : -Infinity;
        for (const o of votes) {
          const s = this.policy.score(o, dp, view);
          if (s > best) {
            best = s;
            bestId = o.id;
          }
        }
        if (bestId !== null) {
          if (bestId !== pass?.id) this.modelledVotes++;
          return bestId;
        }
      }
    }
    return pass?.id ?? null;
  }

  /** What this position is worth to `me`. */
  private evaluate(state: GameState, me: SeatId): number {
    const w = this.w;
    const mine = state.seats.find((s) => s.id === me);
    if (!mine) return w.ousted;
    let v = mine.victoryPoints * w.victoryPoints + mine.pool * w.pool + mine.hand.length * w.hand;
    if (mine.ousted) v += w.ousted;
    for (const m of mine.minions) {
      if (m.inTorpor) continue;
      v += m.capacity * w.board + m.blood * w.blood;
    }
    for (const u of mine.uncontrolled) v += u.counters * w.uncontrolled;
    // The SAME ring walk the policy uses (src/ai/seats.ts). These were
    // two implementations of one question until 2026-09-18.
    const prey = preyOf(state, me);
    const predator = predatorOf(state, me);
    if (prey && prey !== me) {
      v += (state.seats.find((s) => s.id === prey)?.pool ?? 0) * w.preyPool;
    }
    if (predator && predator !== me && predator !== prey) {
      v += (state.seats.find((s) => s.id === predator)?.pool ?? 0) * w.predatorPool;
    }
    return v;
  }
}
