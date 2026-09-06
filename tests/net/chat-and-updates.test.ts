/**
 * The 2026-09-06 lobby pass: the host's own screen learning that something
 * changed, a guest bringing their own deck, one conversation across the
 * lobby and the game, and a seat that keeps playing when its player goes.
 *
 * All four were owner-reported as broken or missing, and all four are
 * about the same thing — the host end of a lobby knew things nobody told
 * it, or told everyone except itself.
 */

import { describe, expect, it } from "vitest";
import { LobbyHost, LobbyPeer } from "../../src/net/lobby.ts";
import { loopback, PROTOCOL_VERSION } from "../../src/net/protocol.ts";
import { addChat, chatLines, clearChat } from "../../src/ui/chat.ts";
import { supportedPrecons } from "../../src/ui/deckimport.ts";
import type { TableConfig } from "../../src/ui/newgame.ts";
import { defaultTable } from "../../src/ui/newgame.ts";
import type { LocalTransport } from "../../src/ui/transport.ts";

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const playable = supportedPrecons().filter((p) => p.playable);
const deckFor = (i: number): { kind: "precon"; set: string; name: string } => {
  const p = playable[i % playable.length]!;
  return { kind: "precon", set: p.set, name: p.name };
};

function hostingTable(openSeats: number): TableConfig {
  const config = defaultTable("Aaron");
  for (let i = 1; i <= openSeats; i++) {
    const seat = config.seats[i];
    if (seat) {
      seat.kind = "open";
      seat.name = `Open seat ${i}`;
      seat.deck = null;
    }
  }
  config.privateGame = false;
  return config;
}

describe("the host's own screen is told when something changes", () => {
  it("fires onChanged when a guest joins, renames and picks a deck", async () => {
    // THE BUG. Every guest learned through `broadcast`; the host learned
    // nothing, so the screen sat showing the state before the change and
    // the owner reported "the host lobby doesn't update". The screen is a
    // pure function of this object — it only ever needed telling.
    const table = hostingTable(1);
    const host = new LobbyHost("ABCDEF", table, () => {});
    let changes = 0;
    host.onChanged(() => changes++);

    const { host: hostSide, peer: peerSide } = loopback();
    host.accept(hostSide);
    const peer = new LobbyPeer(peerSide, "Bea", () => {});
    await settle();
    expect(changes).toBeGreaterThan(0);

    const afterJoin = changes;
    peer.setName("Beatrice");
    await settle();
    expect(changes).toBeGreaterThan(afterJoin);

    const afterName = changes;
    peer.setDeck(deckFor(1));
    await settle();
    expect(changes).toBeGreaterThan(afterName);
  });

  it("a guest's deck reaches the host's table, not just their own screen", async () => {
    // The other half of the same report: "anyone joining a lobby cannot
    // select their own decks". They could send it; nothing on the host
    // side repainted, so it looked as though nothing had happened.
    const table = hostingTable(1);
    const host = new LobbyHost("ABCDEF", table, () => {});
    const { host: hostSide, peer: peerSide } = loopback();
    host.accept(hostSide);
    const peer = new LobbyPeer(peerSide, "Bea", () => {});
    await settle();

    expect(host.seats.find((s) => s.name === "Bea")?.deck).toBeNull();
    peer.setDeck(deckFor(2));
    await settle();

    const seat = host.seats.find((s) => s.name === "Bea");
    expect(seat?.kind).toBe("remote");
    expect(seat?.deck).toEqual(deckFor(2));
    // And the guest is told the result rather than assuming it stood.
    expect(peer.state?.seats.find((s) => s.mine)?.deck).not.toBeNull();
  });
});

describe("one conversation", () => {
  it("relays a guest's line to the host and to the other guests", async () => {
    clearChat();
    const table = hostingTable(2);
    const host = new LobbyHost("ABCDEF", table, () => {});
    const a = loopback();
    const b = loopback();
    host.accept(a.host);
    host.accept(b.host);
    new LobbyPeer(a.peer, "Bea", () => {});
    new LobbyPeer(b.peer, "Cal", () => {});
    await settle();

    // WATCH THE WIRE, not the store. Both ends share one module in a test
    // process, so counting `chatLines()` would count the harness rather
    // than the relay — every LobbyPeer here adds to the same array a real
    // client would own alone.
    const toBea: string[] = [];
    const toCal: string[] = [];
    a.peer.onMessage((m) => {
      if (m.type === "chatLine") toBea.push(`${m.from}: ${m.text}`);
    });
    b.peer.onMessage((m) => {
      if (m.type === "chatLine") toCal.push(`${m.from}: ${m.text}`);
    });

    a.peer.send({ type: "chat", text: "shall we start?" });
    await settle();

    // It goes to EVERYONE, the sender included: the host is the only
    // relay, so its order is the order, and a sender who added its own
    // line locally would see the conversation differently from everybody
    // else. Attributed to the seat name the host knows them by.
    expect(toBea).toEqual(["Bea: shall we start?"]);
    expect(toCal).toEqual(["Bea: shall we start?"]);
    // The host's own screen has it too.
    expect(chatLines().some((l) => l.from === "Bea" && l.text === "shall we start?")).toBe(true);
  });

  it("survives the handover from lobby to game", async () => {
    // The whole reason the store is module-level rather than screen state:
    // the lobby object and the table are two different things with two
    // different lifetimes, and the conversation belongs to neither.
    clearChat();
    const table = hostingTable(1);
    let started: LocalTransport | null = null;
    const host = new LobbyHost("ABCDEF", table, (t) => (started = t));
    const { host: hostSide, peer: peerSide } = loopback();
    host.accept(hostSide);
    const peer = new LobbyPeer(peerSide, "Bea", () => {});
    await settle();
    peer.setDeck(deckFor(1));
    for (const s of host.seats) if (s.deck === null) s.deck = deckFor(3);
    await settle();

    host.say("good luck", "Aaron");
    expect(chatLines().map((l) => l.text)).toContain("good luck");

    host.start();
    await settle();
    expect(started).not.toBeNull();
    // Still there on the other side of the start.
    expect(chatLines().map((l) => l.text)).toContain("good luck");
  });

  it("keeps at most MAX_CHAT lines", () => {
    clearChat();
    for (let i = 0; i < 260; i++) addChat({ from: "x", text: `m${i}`, at: i });
    expect(chatLines().length).toBeLessThanOrEqual(200);
    // The NEWEST are the ones kept — dropping the newest would be worse
    // than keeping none.
    expect(chatLines().at(-1)?.text).toBe("m259");
  });
});

describe("a player who leaves mid-game", () => {
  it("hands their seat to a BOT, and says so", async () => {
    // Owner request. The alternative is a seat nobody can answer, and a
    // game of VTES cannot skip a Methuselah's turn — one person closing
    // a tab would stall the table for everyone else.
    clearChat();
    const table = hostingTable(1);
    let started: LocalTransport | null = null;
    const host = new LobbyHost("ABCDEF", table, (t) => (started = t));
    const { host: hostSide, peer: peerSide } = loopback();
    host.accept(hostSide);
    const peer = new LobbyPeer(peerSide, "Bea", () => {});
    await settle();
    peer.setDeck(deckFor(1));
    for (const s of host.seats) if (s.deck === null) s.deck = deckFor(3);
    await settle();
    host.start();
    await settle();
    const transport = started as unknown as LocalTransport;
    expect(transport).not.toBeNull();

    // The guest's PeerTransport says hello on the same channel — that is
    // what binds it to a seat in the GAME session, and the takeover is
    // keyed on that binding rather than on the lobby's guest list.
    peerSide.send({ type: "hello", version: PROTOCOL_VERSION, seat: "Bea", name: "Bea" });
    await settle();

    // Bea is a human seat: no agent on it.
    expect(Object.keys(transport.agentSeats)).not.toContain("Bea");

    peerSide.send({ type: "leave" });
    await settle();

    // A bot has the seat now, and the table can go on.
    expect(transport.agentSeats["Bea"]).toBe(true);
    // Announced, because it changes who is answering for that seat.
    expect(chatLines().some((l) => l.system && l.text.includes("Bea"))).toBe(true);
  });
});

describe("moderation, which only the host has", () => {
  /** A started online game, with Bea connected on a real seat. */
  async function started(): Promise<{
    session: import("../../src/net/host.ts").HostSession;
    transport: LocalTransport;
    peerSide: ReturnType<typeof loopback>["peer"];
  }> {
    clearChat();
    const table = hostingTable(1);
    let out: { t: LocalTransport; s: unknown } | null = null;
    const host = new LobbyHost("ABCDEF", table, (t, s) => (out = { t, s }));
    const { host: hostSide, peer: peerSide } = loopback();
    host.accept(hostSide);
    const peer = new LobbyPeer(peerSide, "Bea", () => {});
    await settle();
    peer.setDeck(deckFor(1));
    for (const s of host.seats) if (s.deck === null) s.deck = deckFor(3);
    await settle();
    host.start();
    await settle();
    peerSide.send({ type: "hello", version: PROTOCOL_VERSION, seat: "Bea", name: "Bea" });
    await settle();
    const got = out as unknown as { t: LocalTransport; s: never };
    return { session: got.s, transport: got.t, peerSide };
  }

  it("drops a banned player's chat at the RELAY, not on their client", async () => {
    // A banned player's browser has no reason to cooperate, so the ban is
    // enforced where the message is relayed. Nothing of theirs reaches
    // anybody, and they are not told.
    const { session, peerSide } = await started();
    session.setChatBan("Bea", true);
    peerSide.send({ type: "chat", text: "let me in" });
    await settle();
    expect(chatLines().some((l) => l.text === "let me in")).toBe(false);

    // Unbanning puts them back — the control, so this cannot pass on a
    // relay that dropped everything.
    session.setChatBan("Bea", false);
    peerSide.send({ type: "chat", text: "thanks" });
    await settle();
    expect(chatLines().some((l) => l.text === "thanks")).toBe(true);
  });

  it("kicks a player, and a bot takes the seat", async () => {
    // Same landing as leaving voluntarily, through the same helper — a
    // kick and a departure must not drift apart in what they leave
    // behind.
    const { session, transport } = await started();
    expect(Object.keys(transport.agentSeats)).not.toContain("Bea");
    session.kick("Bea");
    await settle();
    expect(transport.agentSeats["Bea"]).toBe(true);
    expect(chatLines().some((l) => l.system && l.text.includes("removed"))).toBe(true);
  });
});
