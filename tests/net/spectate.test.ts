/**
 * Deck fingerprints and spectators (docs/lobby-design.md §9, §10).
 *
 * Both are about what a client may KNOW: a hash says two decks match
 * without saying what is in either, and a spectator watches a table
 * without being told anything a player is entitled to hide.
 */

import { describe, expect, it } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import { HostSession } from "../../src/net/host.ts";
import { LobbyHost, LobbyPeer } from "../../src/net/lobby.ts";
import { PeerTransport } from "../../src/net/peer.ts";
import { loopback } from "../../src/net/protocol.ts";
import { canonicalDeck, deckHash } from "../../src/ui/deckhash.ts";
import type { DeckDef, DeckList, GameSetup } from "../../src/ui/decks.ts";
import { preconDeck, supportedPrecons } from "../../src/ui/deckimport.ts";
import { defaultTable } from "../../src/ui/newgame.ts";
import { LocalTransport } from "../../src/ui/transport.ts";

const config = playtestDecks as unknown as {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
};
const setup: GameSetup = { decks: config.decks, seed: config.seed, maxTurns: 40 };
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const playable = supportedPrecons().filter((p) => p.playable);

describe("the deck fingerprint", () => {
  const deck = (): DeckList => preconDeck(playable[0]!.set, playable[0]!.name, "A")!;

  it("is the same deck however it was ordered", () => {
    // A deck is a MULTISET — the order cards were listed in is not part of
    // it — so the fingerprint has to be blind to that or it fingerprints
    // the typing rather than the deck.
    const a = deck();
    const b: DeckList = {
      ...a,
      crypt: [...a.crypt].reverse(),
      library: [...a.library].reverse(),
    };
    expect(deckHash(b)).toBe(deckHash(a));
    expect(canonicalDeck(b)).toBe(canonicalDeck(a));
  });

  it("does not depend on which seat holds it", () => {
    const mine = preconDeck(playable[0]!.set, playable[0]!.name, "Alice")!;
    const yours = preconDeck(playable[0]!.set, playable[0]!.name, "Bob")!;
    expect(deckHash(yours)).toBe(deckHash(mine));
  });

  it("changes when a single card changes", () => {
    const a = deck();
    const b: DeckList = { ...a, library: [...a.library.slice(1), "Blood Doll"] };
    expect(deckHash(b)).not.toBe(deckHash(a));
    // ...including when only the COUNT changes.
    const c: DeckList = { ...a, library: [...a.library, a.library[0]!] };
    expect(deckHash(c)).not.toBe(deckHash(a));
  });

  it("tells the pool's precons apart", () => {
    // The real test of a 40-bit fingerprint: 18 real decks, no collisions.
    const hashes = playable.map((p) => deckHash(preconDeck(p.set, p.name, "A")!));
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("is readable — no characters people confuse", () => {
    expect(deckHash(deck())).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  });
});

describe("spectators", () => {
  async function watchedGame(): Promise<{
    host: LocalTransport;
    session: HostSession;
    watcher: PeerTransport;
  }> {
    const host = new LocalTransport({ setup });
    const session = new HostSession(host);
    const { host: h, peer: p } = loopback();
    session.accept(h);
    const watcher = new PeerTransport(p, null, "Nosy");
    await settle();
    return { host, session, watcher };
  }

  it("is sent the table with EVERY hand face down", async () => {
    // Not "their own hand" — a spectator holds no seat, so there is no
    // hand that is theirs, and the masking is to nobody.
    const { watcher } = await watchedGame();
    expect(watcher.connected).toBe(true);
    expect(watcher.spectating).toBe(true);
    for (const s of watcher.view().seats) {
      expect(s.hand.every((c) => c.name === "")).toBe(true);
      expect(s.uncontrolled.every((u) => u.card.name === "")).toBe(true);
      // Counts are public — the height of a pile is visible at a table.
      expect(s.hand.length).toBeGreaterThan(0);
    }
  });

  it("leaks no card name at all, from any seat", async () => {
    const { watcher } = await watchedGame();
    const json = JSON.stringify(watcher.view());
    const secrets = new Set<string>();
    for (const deck of setup.decks) {
      if (!("library" in deck)) continue;
      for (const name of deck.library) secrets.add(name);
    }
    expect([...secrets].filter((n) => json.includes(n))).toEqual([]);
  });

  it("is never given a decision", async () => {
    const { host, watcher } = await watchedGame();
    for (let i = 0; i < 30; i++) {
      expect(watcher.decision()).toBeNull();
      const dp = host.decision();
      if (!dp) break;
      await host.choose(dp.options[0]!.id);
      await settle();
    }
    // ...so there is nothing for them to answer.
    await expect(watcher.choose("pass")).rejects.toThrow(/not your decision/i);
  });

  it("keeps up as the game moves", async () => {
    const { host, watcher } = await watchedGame();
    for (let i = 0; i < 10; i++) {
      const dp = host.decision();
      if (!dp) break;
      await host.choose(dp.options[0]!.id);
    }
    await settle();
    expect(watcher.view().commandLog.length).toBe(host.view().commandLog.length);
  });

  it("does not take a seat, and does not stop a table filling up", async () => {
    // Any number may watch, and watching is not playing: a lobby with one
    // open seat still has one open seat after ten spectators arrive.
    const table = defaultTable("Aaron");
    table.seats[1]!.kind = "open";
    table.seats[1]!.deck = null;
    table.privateGame = false;
    const lobby = new LobbyHost("K7M2QP", table, () => {});

    for (let i = 0; i < 3; i++) {
      const ch = loopback();
      lobby.accept(ch.host);
      new LobbyPeer(ch.peer, `Watcher ${i}`, () => {}, true);
    }
    await settle();
    expect(lobby.spectatorCount).toBe(3);
    expect(lobby.seats.filter((s) => s.kind === "open")).toHaveLength(1);

    // And a player can still take that seat.
    const ch = loopback();
    lobby.accept(ch.host);
    const player = new LobbyPeer(ch.peer, "Bob", () => {});
    await settle();
    expect(player.state!.you).toBe("Bob");
    expect(lobby.spectatorCount).toBe(3);
  });

  it("shows a lobby the deck fingerprints, and no deck lists", async () => {
    const table = defaultTable("Aaron");
    table.seats[1]!.kind = "open";
    table.seats[1]!.deck = null;
    table.privateGame = false;
    const lobby = new LobbyHost("K7M2QP", table, () => {});
    const ch = loopback();
    lobby.accept(ch.host);
    const bob = new LobbyPeer(ch.peer, "Bob", () => {});
    await settle();
    bob.setDeck({ kind: "precon", set: playable[1]!.set, name: playable[1]!.name });
    await settle();

    const seat = bob.state!.seats.find((s) => s.name === "Bob")!;
    expect(seat.deckHash).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    // The fingerprint of the same precon, computed independently, matches
    // — which is exactly the use: two people confirming one deck.
    expect(seat.deckHash).toBe(deckHash(preconDeck(playable[1]!.set, playable[1]!.name, "Bob")!));
    // Every other seat has one too, and none of them is a card list.
    for (const s of bob.state!.seats) {
      if (s.deck) expect(s.deckHash).not.toBeNull();
    }
  });
});
