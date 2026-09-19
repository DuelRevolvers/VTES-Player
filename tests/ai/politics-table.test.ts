/**
 * The POLITICS table actually produces politics
 * (docs/ai-politics-bench-design.md §6).
 *
 * THIS IS THE TEST THE PROJECT DID NOT HAVE, and its absence is why every
 * AI measurement taken so far was blind to voting: the default playtest
 * table holds three political action cards across three decks, all in one
 * seat, so `castVote` came out at 2.4% of real choices and that number
 * described the FIXTURE rather than the game
 * (docs/ai-decision-profile-2026-09-18.md).
 *
 * Two assertions, and they are deliberately different in kind, because
 * "a card in the decks is not a card the AI can PLAY":
 *
 *  1. a STATIC one — the decks contain political actions, in more than one
 *     seat — which is fast and pins the composition;
 *  2. a DYNAMIC one — referendums are actually polled in real games —
 *     which is the only thing that proves the first one reaches the table.
 *
 * Neither is an assertion about a total: counts drift with every card
 * wave and pinning one would make this a hostage. The floors are "more
 * than none" and "more than one seat", which is the REASON this table
 * exists.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runBatch } from "../../src/ai/batch.ts";
import { HeuristicAgent } from "../../src/ai/heuristic.ts";
import { buildHandlerRegistry } from "../../src/cards/effects/cards.ts";
import registry from "../../src/cards/registry.json" with { type: "json" };
import type { Agent, PlayerView } from "../../src/engine/agent.ts";
import type { DecisionPoint, LegalOption } from "../../src/engine/options.ts";
import type { SeatId } from "../../src/engine/state.ts";
import { buildGame, validateDecks, type DeckDef } from "../../src/ui/decks.ts";

interface TableConfig {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
}

async function loadTable(file: string): Promise<TableConfig> {
  const raw = await readFile(path.join(process.cwd(), "config", file), "utf-8");
  return JSON.parse(raw) as TableConfig;
}

/** Card names that are Political Action cards, from the registry. */
const POLITICAL = new Set(
  Object.values(registry.entries as Record<string, { card: { name: string; types?: string[] } }>)
    .filter((e) => (e.card.types ?? []).some((t) => /Political/i.test(t)))
    .map((e) => e.card.name),
);

/** How many political action cards each seat's library holds. */
function politicalBySeat(decks: DeckDef[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const deck of decks) {
    // Both DeckDef shapes — a snapshot deck and a decklist — carry
    // `library` as card NAMES, so one read serves either.
    out[deck.seat] = deck.library.filter((n) => POLITICAL.has(n)).length;
  }
  return out;
}

describe("the politics table", () => {
  it("holds political actions in more than one seat", async () => {
    const config = await loadTable("playtest-decks-politics.json");
    const bySeat = politicalBySeat(config.decks);
    const seatsWithPolitics = Object.values(bySeat).filter((n) => n > 0);

    expect(seatsWithPolitics.length).toBeGreaterThan(1);
    // And the total is not a token gesture: the default table's THREE is
    // exactly what made it unusable for measuring a vote scorer.
    const total = Object.values(bySeat).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(20);
  });

  it("is a legal table — an illegal one may not be measured", async () => {
    const config = await loadTable("playtest-decks-politics.json");
    const check = validateDecks(config.decks);
    expect(check.unknown).toEqual([]);
    expect(check.unsupported).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it("actually polls referendums in real games", async () => {
    const config = await loadTable("playtest-decks-politics.json");
    const seats = config.decks.map((d) => d.seat);

    let voteDecisions = 0;
    let termsDecisions = 0;
    let forkingSources = 0;
    const oneWaySources: string[] = [];
    class Probe extends HeuristicAgent {
      override decide(
        dp: DecisionPoint,
        options: LegalOption[],
        view: PlayerView,
      ): string {
        if (options.length > 1) {
          const votes = options.filter((o) => o.kind === "castVote");
          if (votes.length > 0) {
            voteDecisions++;
            // PER SOURCE, not per decision. The vote scorer's structural
            // argument (docs/ai-vote-scoring-design.md §2) is that a
            // source offers both directions, so a term evaluating the
            // referendum necessarily varies across the fork.
            //
            // That is true of every FLEXIBLE source and false of a
            // DIRECTED GRANT: "+N votes AGAINST the referendum"
            // (Protected District) is bucketed by direction in
            // `voteGrants` and may only be cast that way
            // (docs/polling-votes-design.md §3). For such a source the
            // decision is cast-or-decline, not for-or-against.
            const bySource = new Map<string, boolean[]>();
            for (const v of votes) {
              const seen = bySource.get(v.source) ?? [];
              seen.push(v.inFavor);
              bySource.set(v.source, seen);
            }
            for (const [source, dirs] of bySource) {
              if (dirs.includes(true) && dirs.includes(false)) forkingSources++;
              else oneWaySources.push(source);
            }
          }
          if (options.some((o) => o.kind === "chooseTerms")) termsDecisions++;
        }
        return super.decide(dp, options, view);
      }
    }

    const summary = runBatch({
      games: 4,
      seed: 1,
      registry: buildHandlerRegistry(),
      buildState: (s) => buildGame({ decks: config.decks, seed: s, maxTurns: config.maxTurns ?? 40 }),
      agents: (s) => {
        const out: Record<SeatId, Agent> = {};
        seats.forEach((id, i) => {
          out[id] = new Probe({ seed: s * 1000 + i });
        });
        return out;
      },
    });

    // No game may have ERRORED: a table that throws is not a table.
    expect(summary.results.filter((r) => r.error).map((r) => r.error)).toEqual([]);
    expect(voteDecisions).toBeGreaterThan(0);
    expect(termsDecisions).toBeGreaterThan(0);
    // The fork the vote scorer depends on is the common case…
    expect(forkingSources).toBeGreaterThan(0);
    // …and every exception is a DIRECTED GRANT, which is the one source
    // that legitimately offers a single direction. Pinning the reason
    // rather than a count: if a future card makes some OTHER kind of
    // source one-way, this fails and says which, instead of quietly
    // shifting a number.
    for (const source of oneWaySources) {
      expect(source).toMatch(/^grant/);
    }
  });

  it("carries the cards that make the TOLL and the political BLOCK reachable", async () => {
    // Both rules were shipped correct and unreachable: no tolled vote
    // existed in any deck, and 0 of 45 political block decisions had a
    // block that could succeed, because an undirected action carries +1
    // stealth (p. 22) and nothing answered it.
    //
    // A STATIC assertion, because the dynamic one is a frequency rather
    // than a fact — see the design doc. What must not regress is that
    // the cards are HERE at all.
    const config = await loadTable("playtest-decks-politics.json");
    const cryptIds = config.decks.flatMap((d) =>
      (d as unknown as { crypt: Array<{ id: number }> }).crypt.map((c) => c.id),
    );
    // Alexander Silverson: "vampires must burn 1 blood to cast votes
    // against referendums called by Alexander."
    expect(cryptIds).toContain(201530);
    // Oluwafunmilayo: +1 intercept against POLITICAL ACTIONS, the only
    // thing in the pool that answers the +1 stealth on the turn it counts.
    expect(cryptIds).toContain(201656);
    // Intercept retainers, so a block does not depend on one big vampire.
    const carol = config.decks.find((d) => d.seat === "Carol");
    expect(carol?.library.filter((n) => n === "Revenant").length).toBeGreaterThan(0);
  });

  it("carries more politics than the default table, which is the whole point", async () => {
    const [politics, standard] = await Promise.all([
      loadTable("playtest-decks-politics.json"),
      loadTable("playtest-decks.json"),
    ]);
    const sum = (decks: DeckDef[]): number =>
      Object.values(politicalBySeat(decks)).reduce((a, b) => a + b, 0);

    // The comparison, not a magic number: if a future card wave enriches
    // the default table, this stays meaningful where an absolute floor
    // would silently stop testing anything.
    expect(sum(politics.decks)).toBeGreaterThan(sum(standard.decks));
  });
});
