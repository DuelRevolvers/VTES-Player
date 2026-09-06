/**
 * Host and peer over a loopback channel (docs/multiplayer-design.md).
 *
 * The protocol sits above the carrier, so a whole networked game can be
 * played here with no network — which is the only way any of this gets
 * tested. What is pinned, in order of how badly it would hurt:
 *
 *  1. A peer is never sent what it must not see.
 *  2. The host refuses what a peer must not do.
 *  3. `PeerTransport` satisfies the same `GameTransport` contract the UI
 *     already renders, so the client needs no change to go online.
 */

import { describe, expect, it } from "vitest";
import playtestDecks from "../../config/playtest-decks.json";
import type { DeckDef, GameSetup } from "../../src/ui/decks.ts";
import { LocalTransport } from "../../src/ui/transport.ts";
import { HostSession } from "../../src/net/host.ts";
import { PeerTransport } from "../../src/net/peer.ts";
import { loopback, PROTOCOL_VERSION } from "../../src/net/protocol.ts";

const config = playtestDecks as unknown as {
  seed: number;
  maxTurns: number | null;
  decks: DeckDef[];
};
const setup: GameSetup = { decks: config.decks, seed: config.seed, maxTurns: 40 };
const SEATS = config.decks.map((d) => d.seat);

/** Let the loopback's queued messages drain. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

async function table(): Promise<{
  host: LocalTransport;
  session: HostSession;
  peers: Record<string, PeerTransport>;
}> {
  const host = new LocalTransport({ setup });
  const session = new HostSession(host);
  const peers: Record<string, PeerTransport> = {};
  // Alice plays at the host's own screen; Bob and Carol are remote.
  for (const seat of SEATS.slice(1)) {
    const { host: hostSide, peer: peerSide } = loopback();
    session.accept(hostSide);
    peers[seat] = new PeerTransport(peerSide, seat, seat);
  }
  await settle();
  return { host, session, peers };
}

describe("joining a table", () => {
  it("seats a peer and tells it who else is here", async () => {
    const { session, peers } = await table();
    expect(peers["Bob"]!.seat).toBe("Bob");
    expect(peers["Bob"]!.connected).toBe(true);
    expect(session.connectedSeats.sort()).toEqual(SEATS.slice(1).sort());
    expect(session.roster.map((r) => r.seat).sort()).toEqual(SEATS.slice(1).sort());
  });

  it("turns away a seat that does not exist, with a reason", async () => {
    const host = new LocalTransport({ setup });
    const session = new HostSession(host);
    const { host: h, peer: p } = loopback();
    session.accept(h);
    const t = new PeerTransport(p, "Mallory");
    await settle();
    expect(t.connected).toBe(false);
    expect(t.closedReason).toContain("Mallory");
  });

  it("turns away a second peer for a seat already taken", async () => {
    const { session } = await table();
    const { host: h, peer: p } = loopback();
    session.accept(h);
    const intruder = new PeerTransport(p, "Bob");
    await settle();
    expect(intruder.closedReason).toContain("already taken");
  });

  it("turns away a peer speaking a different protocol version", async () => {
    const host = new LocalTransport({ setup });
    const session = new HostSession(host);
    const { host: h, peer: p } = loopback();
    session.accept(h);
    let bye = "";
    p.onMessage((m) => {
      if (m.type === "bye") bye = m.reason;
    });
    p.send({ type: "hello", version: PROTOCOL_VERSION + 1, seat: "Bob" });
    await settle();
    expect(bye).toContain(String(PROTOCOL_VERSION));
  });

  it("lets a dropped peer come back to its own seat", async () => {
    // A reconnect needs no catch-up machinery: the whole state is re-sent
    // on every change, so a returning peer simply gets the next one.
    const { session, peers } = await table();
    peers["Bob"]!.close();
    const { host: h, peer: p } = loopback();
    session.accept(h);
    const again = new PeerTransport(p, "Bob");
    await settle();
    expect(again.connected).toBe(true);
    expect(again.view().seats).toHaveLength(SEATS.length);
  });
});

describe("what a peer is allowed to see", () => {
  it("sends each peer its OWN hand and nobody else's", async () => {
    const { peers } = await table();
    const view = peers["Bob"]!.view();
    const mine = view.seats.find((s) => s.id === "Bob")!;
    expect(mine.hand.every((c) => c.name !== "")).toBe(true);
    for (const other of view.seats.filter((s) => s.id !== "Bob")) {
      expect(other.hand.every((c) => c.name === "")).toBe(true);
      expect(other.uncontrolled.every((u) => u.card.name === "")).toBe(true);
    }
  });

  it("masks to the RECIPIENT, not to whoever is being asked", async () => {
    // The local view masks to the deciding seat, which is right for a
    // shared screen and wrong here: a peer must see their own hand all the
    // time, whoever the game is waiting on.
    const { host, peers } = await table();
    expect(host.decision()!.seat).toBe("Alice");
    const bob = peers["Bob"]!.view().seats.find((s) => s.id === "Bob")!;
    expect(bob.hand.every((c) => c.name !== "")).toBe(true);
  });

  it("never puts another seat's hand on the wire at all", async () => {
    // Not "the UI does not show it" — it is not sent. A peer cannot leak
    // what it was never given.
    const { peers } = await table();
    const json = JSON.stringify(peers["Bob"]!.view());
    const secrets = new Set<string>();
    for (const deck of setup.decks) {
      if (deck.seat === "Bob") continue;
      for (const name of deck.library) secrets.add(name);
    }
    expect([...secrets].filter((n) => json.includes(n))).toEqual([]);
  });

  it("withholds a decision that is not this peer's", async () => {
    // A DecisionPoint carries that seat's legal options, and an option
    // list says what is in their hand.
    const { peers } = await table();
    expect(peers["Bob"]!.decision()).toBeNull();
    expect(peers["Carol"]!.decision()).toBeNull();
  });

  it("does not broadcast the host's debug reveal", async () => {
    // `omniscient` is a local switch for reading the engine, not a licence
    // to show the table everyone's hand.
    const { host, peers } = await table();
    host.setOmniscient(true);
    await settle();
    const others = peers["Bob"]!.view().seats.filter((s) => s.id !== "Bob");
    expect(others.every((s) => s.hand.every((c) => c.name === ""))).toBe(true);
  });
});

describe("what a peer is allowed to do", () => {
  it("refuses an answer to somebody else's decision", async () => {
    const { peers } = await table();
    // Bob has no decision, so the transport stops it before the wire...
    await expect(peers["Bob"]!.choose("pass")).rejects.toThrow(/not your decision/i);
  });

  it("refuses an answer to a decision that has already moved on", async () => {
    // The network case a local click cannot have: an answer made against
    // decision N arriving after somebody has already answered N.
    //
    // Driven over a RAW channel rather than a PeerTransport, because the
    // transport would refuse it locally first — and it is the HOST's
    // refusal that has to be pinned. A host that trusted the option id
    // alone would apply this click to whatever decision is current now.
    const host = new LocalTransport({ setup });
    const session = new HostSession(host);
    const { host: h, peer: p } = loopback();
    session.accept(h);
    let error = "";
    p.onMessage((m) => {
      if (m.type === "ack" && m.error) error = m.error;
    });
    p.send({ type: "hello", version: PROTOCOL_VERSION, seat: "Bob" });
    await settle();

    for (let i = 0; i < 400 && host.decision()?.seat !== "Bob"; i++) {
      await host.choose(host.decision()!.options[0]!.id);
    }
    const stale = host.decision()!;
    expect(stale.seat).toBe("Bob");
    await settle();

    // Somebody answers it first — here, the host on Bob's behalf.
    await host.choose(stale.options[0]!.id);
    await settle();

    p.send({ type: "choose", id: 1, seq: stale.seq, option: stale.options[0]!.id });
    await settle();
    expect(error).toContain("already moved on");

    // ...and a CURRENT decision that belongs to somebody else is refused
    // too, with the other reason. Both host branches, not just the one the
    // transport happens to reach first.
    const live = host.decision();
    if (live && live.seat !== "Bob") {
      error = "";
      p.send({ type: "choose", id: 2, seq: live.seq, option: live.options[0]!.id });
      await settle();
      expect(error).toContain("not yours");
    }
  });

  it("refuses an illegal option with the engine's own message", async () => {
    const { host, peers } = await table();
    for (let i = 0; i < 400 && host.decision()?.seat !== "Bob"; i++) {
      await host.choose(host.decision()!.options[0]!.id);
    }
    await settle();
    await expect(peers["Bob"]!.choose("not-a-real-option")).rejects.toThrow(/illegal option/i);
    // ...and the game did not move.
    expect(host.decision()!.seat).toBe("Bob");
  });

  it("gives a peer no history to rewind a shared game with", async () => {
    const { peers } = await table();
    expect(peers["Bob"]!.history).toBeNull();
  });
});

describe("playing a whole game across the table", () => {
  it("runs to a finish with two seats remote and one local", async () => {
    const { host, peers } = await table();
    // A proper stream, not `steps % length`: a walker that cycles the
    // index in step with the loop counter can revisit the same option for
    // ever and look like a game that will not end.
    const rng = { n: 7 };
    const pick = (count: number): number => {
      rng.n = (rng.n * 1103515245 + 12345) & 0x7fffffff;
      return rng.n % count;
    };
    let steps = 0;
    for (;;) {
      const dp = host.decision();
      if (!dp) break;
      if (++steps > 20000) throw new Error("the game did not terminate");
      if (dp.seat === "Alice") {
        await host.choose(dp.options[pick(dp.options.length)]!.id);
        continue;
      }
      // A remote seat answers from what it was SENT, never from the host's
      // state — which is the point of the exercise.
      await settle();
      const peer = peers[dp.seat]!;
      const mine = peer.decision();
      expect(mine, `${dp.seat} was not sent its own decision`).not.toBeNull();
      expect(mine!.seq).toBe(dp.seq);
      await peer.choose(mine!.options[pick(mine!.options.length)]!.id);
      await settle();
    }
    expect(steps).toBeGreaterThan(100);
    // Everyone ended up looking at the same game.
    for (const seat of SEATS.slice(1)) {
      expect(peers[seat]!.view().commandLog.length).toBe(host.view().commandLog.length);
    }
  });

  it("keeps every peer's view current as other seats move", async () => {
    const { host, peers } = await table();
    let painted = 0;
    peers["Bob"]!.onChanged(() => (painted += 1));
    for (let i = 0; i < 5; i++) {
      const dp = host.decision();
      if (!dp || dp.seat !== "Alice") break;
      await host.choose(dp.options[0]!.id);
    }
    await settle();
    expect(painted).toBeGreaterThan(0);
    expect(peers["Bob"]!.view().commandLog.length).toBe(host.view().commandLog.length);
  });

  it("leaves the host playing when the table closes", async () => {
    // Everyone else leaving is not the end of the game — it is a hotseat
    // game again.
    const { host, session, peers } = await table();
    session.close("goodnight");
    await settle();
    expect(peers["Bob"]!.closedReason).toBe("goodnight");
    expect(host.decision()).not.toBeNull();
    await host.choose(host.decision()!.options[0]!.id);
    expect(host.view().commandLog.length).toBeGreaterThan(0);
  });

  it("fails a peer's in-flight submission when the table closes", async () => {
    // Otherwise the client sits with its buttons disabled for ever,
    // waiting for an answer that is never coming.
    const { host, session, peers } = await table();
    for (let i = 0; i < 400 && host.decision()?.seat !== "Bob"; i++) {
      await host.choose(host.decision()!.options[0]!.id);
    }
    await settle();
    const bob = peers["Bob"]!;
    const inFlight = bob.choose(bob.decision()!.options[0]!.id);
    session.close("host left");
    await expect(inFlight).rejects.toThrow(/host left/);
  });
});
