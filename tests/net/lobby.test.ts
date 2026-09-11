/**
 * Room codes and the lobby (docs/lobby-design.md).
 *
 * The lobby is the one place a stranger's input reaches this client before
 * a game exists, so most of what is pinned here is what it refuses and
 * what it declines to share.
 */

import { describe, expect, it } from "vitest";
import { LobbyHost, LobbyPeer } from "../../src/net/lobby.ts";
import { loopback, PROTOCOL_VERSION } from "../../src/net/protocol.ts";
import { PeerTransport } from "../../src/net/peer.ts";
import {
  codeForPeerId,
  codeFromLink,
  isRoomCode,
  joinLink,
  newRoomCode,
  normaliseRoomCode,
  peerIdForCode,
} from "../../src/net/room.ts";
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

/** A table with `open` seats for guests to take. */
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

function room(openSeats = 1): { lobby: LobbyHost; started: LocalTransport[] } {
  const started: LocalTransport[] = [];
  const lobby = new LobbyHost("K7M2QP", hostingTable(openSeats), (t) => started.push(t));
  return { lobby, started };
}

async function guest(
  lobby: LobbyHost,
  name: string,
): Promise<{ peer: LobbyPeer; startedHere: () => boolean; channel: ReturnType<typeof loopback> }> {
  const channel = loopback();
  lobby.accept(channel.host);
  let started = false;
  const peer = new LobbyPeer(channel.peer, name, () => (started = true));
  await settle();
  return { peer, startedHere: () => started, channel };
}

describe("room codes", () => {
  it("leaves out the characters people mistype", () => {
    // A code exists to be read aloud and typed back, so 0/O and 1/I/L are
    // the pairs to avoid. 30^6 is still 729 million rooms.
    for (let i = 0; i < 200; i++) {
      expect(newRoomCode()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    }
  });

  it("forgives how a code was typed", () => {
    for (const typed of ["k7m2qp", "K7-M2-QP", " K7M2QP ", "K7M2QP"]) {
      expect(normaliseRoomCode(typed), typed).toBe("K7M2QP");
    }
    // ...including the substitutions someone makes for the missing letters.
    expect(normaliseRoomCode("K7M2QO")).toBe("K7M2Q0".replace("0", "O"));
    expect(isRoomCode("k7m2qp")).toBe(true);
    expect(isRoomCode("K7M2Q")).toBe(false);
    expect(isRoomCode("K7M2QPX")).toBe(false);
  });

  it("round-trips a code through a peer id", () => {
    const code = newRoomCode();
    expect(codeForPeerId(peerIdForCode(code))).toBe(code);
    // Somebody else's peer id on the shared broker is not one of ours.
    expect(codeForPeerId("some-other-app-1234")).toBeNull();
  });

  it("puts the code in the FRAGMENT of a join link", () => {
    // A fragment is never sent to the server, so on GitHub Pages the code
    // stays out of the access log — and the code is the whole of a room's
    // access control.
    const link = joinLink("K7M2QP", "https://example.com/vtes/");
    expect(link).toContain("#join=K7M2QP");
    expect(new URL(link).search).toBe("");
    expect(codeFromLink(link)).toBe("K7M2QP");
  });

  it("finds nothing in a link that has no code", () => {
    expect(codeFromLink("https://example.com/")).toBeNull();
    expect(codeFromLink("https://example.com/#join=nope")).toBeNull();
    expect(codeFromLink("not a url")).toBeNull();
  });
});

describe("joining a lobby", () => {
  it("gives an arriving player an open seat, named after them", async () => {
    const { lobby } = room(1);
    const { peer } = await guest(lobby, "Bob");
    expect(peer.state!.you).toBe("Bob");
    expect(peer.state!.code).toBe("K7M2QP");
    expect(lobby.seats.some((s) => s.name === "Bob")).toBe(true);
  });

  it("numbers a second player with the same name", async () => {
    // A seat name IS the engine's seat id, and without an account server
    // this is the only uniqueness rule there is.
    const { lobby } = room(2);
    await guest(lobby, "Bob");
    const second = await guest(lobby, "Bob");
    expect(second.peer.state!.you).toBe("Bob 2");
  });

  it("turns away a player when the table is full", async () => {
    const { lobby } = room(1);
    await guest(lobby, "Bob");
    const late = await guest(lobby, "Carol");
    expect(late.peer.closedReason).toContain("full");
  });

  it("turns away a different protocol version", async () => {
    const { lobby } = room(1);
    const ch = loopback();
    lobby.accept(ch.host);
    let bye = "";
    ch.peer.onMessage((m) => {
      if (m.type === "bye") bye = m.reason;
    });
    ch.peer.send({ type: "join", version: PROTOCOL_VERSION + 1, name: "Bob" });
    await settle();
    expect(bye).toContain(String(PROTOCOL_VERSION));
  });

  it("frees the seat when a player leaves", async () => {
    const { lobby } = room(1);
    const bob = await guest(lobby, "Bob");
    bob.peer.setDeck(deckFor(1));
    await settle();
    bob.peer.leave();
    await settle();
    // Open again, and WITHOUT Bob's deck — dealing a game from a deck
    // nobody at the table brought would be worse than refusing to start.
    const seat = lobby.seats.find((s) => s.kind === "open")!;
    expect(seat.deck).toBeNull();
    expect(lobby.seats.some((s) => s.name === "Bob")).toBe(false);
  });
});

describe("what the lobby shares", () => {
  it("shows that a seat has a deck, never what is in it", async () => {
    const { lobby } = room(1);
    const bob = await guest(lobby, "Bob");
    bob.peer.setDeck({ kind: "paste", text: "2x Blood Doll\n2x Ariane" });
    await settle();
    const mine = bob.peer.state!.seats.find((s) => s.name === "Bob")!;
    expect(mine.ready).toBe(true);
    expect(mine.deck).toBe("a pasted deck list");
    // The list itself is nobody else's business, and after the deal it is
    // hidden information.
    expect(JSON.stringify(bob.peer.state)).not.toContain("Blood Doll");
  });

  it("tells everyone why the game cannot start", async () => {
    // Nobody should have to ask why the button is greyed out.
    const { lobby } = room(1);
    const bob = await guest(lobby, "Bob");
    expect(bob.peer.state!.canStart).toBe(false);
    expect(bob.peer.state!.problems.join(" ")).toContain("no deck chosen");

    bob.peer.setDeck(deckFor(1));
    await settle();
    expect(bob.peer.state!.canStart).toBe(true);
    expect(bob.peer.state!.problems).toEqual([]);
  });

  it("reports a bad deck against the player who brought it", async () => {
    const { lobby } = room(1);
    const bob = await guest(lobby, "Bob");
    bob.peer.setDeck({ kind: "paste", text: "2x Sword of Nuln" });
    await settle();
    expect(bob.peer.state!.canStart).toBe(false);
    expect(bob.peer.state!.problems.join(" ")).toContain("Bob");
  });

  it("marks which seat is yours, per recipient", async () => {
    const { lobby } = room(2);
    const bob = await guest(lobby, "Bob");
    const carol = await guest(lobby, "Carol");
    await settle();
    expect(bob.peer.state!.seats.filter((s) => s.mine).map((s) => s.name)).toEqual(["Bob"]);
    expect(carol.peer.state!.seats.filter((s) => s.mine).map((s) => s.name)).toEqual(["Carol"]);
  });
});

describe("starting the game from the lobby", () => {
  it("refuses to start until every seat has a deck", async () => {
    const { lobby } = room(1);
    await guest(lobby, "Bob");
    expect(lobby.canStart).toBe(false);
    expect(lobby.start()).toBeNull();
  });

  it("hands the SAME channel to the game, with no reconnect", async () => {
    // One connection, two phases: there is no window in which a player is
    // connected to neither the lobby nor the game.
    const { lobby, started } = room(1);
    const bob = await guest(lobby, "Bob");
    bob.peer.setDeck(deckFor(1));
    await settle();

    expect(lobby.canStart).toBe(true);
    const game = lobby.start()!;
    await settle();
    expect(bob.startedHere()).toBe(true);
    expect(started).toHaveLength(1);

    // The lobby channel becomes the game channel.
    const transport = new PeerTransport(bob.channel.peer, "Bob");
    await settle();
    expect(transport.connected).toBe(true);
    expect(transport.view().seats).toHaveLength(game.transport.view().seats.length);
    // Bob sees his own hand and nobody else's, as ever.
    const mine = transport.view().seats.find((s) => s.id === "Bob")!;
    expect(mine.hand.every((c) => c.name !== "")).toBe(true);
  });

  /**
   * MID-GAME ARRIVALS (owner request). They used to be hung up on, which
   * made an accidental back-button permanent: the seat went to a bot and
   * there was no way back in.
   */
  it("lets a stranger arriving mid-game WATCH rather than turning them away", async () => {
    const { lobby } = room(2);
    const bob = await guest(lobby, "Bob");
    bob.peer.setDeck(deckFor(1));
    const carol = await guest(lobby, "Carol");
    carol.peer.setDeck(deckFor(2));
    await settle();
    lobby.start();
    await settle();

    const late = await guest(lobby, "Dave");
    await settle();
    // Not hung up on, and holding no seat — a spectator.
    expect(late.peer.closedReason).toBeNull();
    expect(late.peer.state?.you ?? null).toBeNull();
  });

  it("gives a player their OWN seat back when they rejoin", async () => {
    const { lobby } = room(2);
    const bob = await guest(lobby, "Bob");
    bob.peer.setDeck(deckFor(1));
    const carol = await guest(lobby, "Carol");
    carol.peer.setDeck(deckFor(2));
    await settle();
    lobby.start();
    await settle();
    // Bob drops out, and his seat goes to a bot as usual.
    bob.channel.peer.close();
    await settle();

    const again = await guest(lobby, "Bob");
    await settle();
    expect(again.peer.closedReason).toBeNull();
    expect(again.peer.state?.you).toBe("Bob");
  });

  it("starts only once", async () => {
    const { lobby, started } = room(1);
    const bob = await guest(lobby, "Bob");
    bob.peer.setDeck(deckFor(1));
    await settle();
    expect(lobby.start()).not.toBeNull();
    expect(lobby.start()).toBeNull();
    expect(started).toHaveLength(1);
  });

  it("plays a real game end to end: lobby, deal, moves, over one channel", async () => {
    // The whole path the shell now wires: a guest joins a room, picks a
    // deck, the host starts, and the SAME connection carries the game —
    // dealt from real decks, not from a snapshot.
    const { lobby, started } = room(1);
    const bob = await guest(lobby, "Bob");
    bob.peer.setDeck(deckFor(1));
    await settle();
    lobby.start();
    await settle();

    bob.peer.detach(); // the lobby stops reading; the transport takes over
    const remote = new PeerTransport(bob.channel.peer, "Bob");
    await settle();
    const host = started[0]!;

    // A dealt game, not a mid-game fixture — but NOT asserted as "everyone
    // has 30 pool": the bots are stepped the instant the game exists, so
    // by the time anyone can look, one of them may already have spent
    // some. What is still true is the shape of the deal, and the p. 14
    // opening itself is pinned in fresh-game.test.ts.
    for (const s of remote.view().seats) {
      expect(s.hand.length + s.library.length).toBeGreaterThan(50);
      expect(s.pool).toBeLessThanOrEqual(30);
    }
    // Bob sees his own hand and nobody else's, over the wire, as ever.
    const mineNow = remote.view().seats.find((s) => s.id === "Bob")!;
    expect(mineNow.hand.every((c) => c.name !== "")).toBe(true);

    // And it plays: the host answers its own seats, Bob answers his.
    let steps = 0;
    for (let i = 0; i < 200; i++) {
      const dp = host.decision();
      if (!dp) break;
      steps++;
      if (dp.seat === "Bob") {
        await settle();
        const mine = remote.decision();
        expect(mine, "Bob was not sent his own decision").not.toBeNull();
        await remote.choose(mine!.options[0]!.id);
        await settle();
      } else {
        await host.choose(dp.options[0]!.id);
      }
    }
    expect(steps).toBeGreaterThan(20);
    expect(remote.view().commandLog.length).toBe(host.view().commandLog.length);
  });

  it("tells everyone when the table closes", async () => {
    const { lobby } = room(1);
    const bob = await guest(lobby, "Bob");
    lobby.close("goodnight");
    await settle();
    expect(bob.peer.closedReason).toBe("goodnight");
  });
});

describe("a guest's own name and face", () => {
  function lobby(): { host: LobbyHost; table: TableConfig } {
    const table = defaultTable("Aaron");
    table.seats[1]!.kind = "open";
    table.seats[1]!.deck = null;
    table.privateGame = false;
    return { host: new LobbyHost("K7M2QP", table, () => {}), table };
  }

  it("starts from the profile name, and can be changed in the lobby", async () => {
    const { host } = lobby();
    const ch = loopback();
    host.accept(ch.host);
    const bob = new LobbyPeer(ch.peer, "Bob", () => {});
    await settle();
    // The name arrived from their profile — that is the default.
    expect(bob.state!.you).toBe("Bob");

    bob.setName("Roberta");
    await settle();
    // The HOST decides, and says so: a seat name IS the engine's seat id.
    expect(bob.state!.you).toBe("Roberta");
    expect(bob.state!.seats.some((s) => s.name === "Roberta")).toBe(true);
    expect(bob.state!.seats.some((s) => s.name === "Bob")).toBe(false);
  });

  it("numbers a name that clashes, rather than making two seats one", async () => {
    const { host, table } = lobby();
    const ch = loopback();
    host.accept(ch.host);
    const bob = new LobbyPeer(ch.peer, "Bob", () => {});
    await settle();

    bob.setName(table.seats[0]!.name); // the host's own name
    await settle();
    // Not taken as-is, and the host's seat is untouched.
    expect(bob.state!.you).not.toBe(table.seats[0]!.name);
    expect(table.seats.filter((s) => s.name === table.seats[0]!.name)).toHaveLength(1);
  });

  it("keeps their deck when they rename", async () => {
    const { host } = lobby();
    const ch = loopback();
    host.accept(ch.host);
    const bob = new LobbyPeer(ch.peer, "Bob", () => {});
    await settle();
    const playable = supportedPrecons().filter((p) => p.playable);
    bob.setDeck({ kind: "precon", set: playable[1]!.set, name: playable[1]!.name });
    await settle();
    const before = bob.state!.seats.find((s) => s.name === "Bob")!.deckHash;

    bob.setName("Roberta");
    await settle();
    const after = bob.state!.seats.find((s) => s.name === "Roberta")!;
    expect(after.deck).not.toBeNull();
    // The deck did not merely survive — it is the SAME deck. (The hash is
    // taken over the deck's contents, which do not depend on the seat.)
    expect(after.deckHash).toBe(before);
  });

  it("refuses a name that would break something downstream", async () => {
    const { host } = lobby();
    const ch = loopback();
    host.accept(ch.host);
    const bob = new LobbyPeer(ch.peer, "Bob", () => {});
    await settle();

    bob.setName("   ");
    await settle();
    expect(bob.state!.you).toBe("Bob");
    bob.setName("x".repeat(200));
    await settle();
    expect(bob.state!.you).toBe("Bob");
  });

  it("carries their avatar to the table, and refuses one that is not an image", async () => {
    // TWO open seats: with only one, the second guest is turned away as
    // "table full" and their avatar would be null for the wrong reason.
    const table = defaultTable("Aaron");
    for (const i of [1, 2]) {
      table.seats[i]!.kind = "open";
      table.seats[i]!.deck = null;
    }
    table.privateGame = false;
    const host = new LobbyHost("K7M2QP", table, () => {});

    const a = loopback();
    host.accept(a.host);
    const tiny = "data:image/png;base64,AAAA";
    new LobbyPeer(a.peer, "Bob", () => {}, false, tiny);
    await settle();
    expect(host.seats.find((s) => s.name === "Bob")!.avatar).toBe(tiny);

    const b = loopback();
    host.accept(b.host);
    // Not an image data URI — a client on the far side is not trusted to
    // send only what it should.
    const liar = new LobbyPeer(b.peer, "Eve", () => {}, false, "javascript:alert(1)");
    await settle();
    expect(liar.state, "Eve was turned away — the fixture is wrong").not.toBeNull();
    expect(host.seats.find((s) => s.name === liar.state!.you)!.avatar).toBeNull();
  });
});
