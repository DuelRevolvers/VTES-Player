/**
 * PeerJS as a `Channel` (docs/lobby-design.md §5).
 *
 * The ONLY file in `src/net/` that knows a network exists. Everything
 * above it — the protocol, the lobby, the host session, the peer transport
 * — is written against `Channel`, and is tested over an in-memory pair.
 * This is the adapter that makes a `DataConnection` one of those, and it
 * is deliberately as thin as it can be, because it is the one part that
 * cannot be tested without two browsers.
 *
 * ON THE SIGNALLING BROKER, which is a decision the owner should see:
 * WebRTC cannot introduce two browsers to each other by itself — somebody
 * has to pass the first message. PeerJS defaults to a free public broker
 * (0.peerjs.com). It carries the introduction only: once the connection is
 * made, the game traffic is peer-to-peer and never reaches it. It is not
 * "our backend" and stores nothing, but it IS a third party this client
 * depends on to start a game, and it can be down. Self-hosting one is a
 * few lines of config (`host`/`port`/`path` on the Peer options) if that
 * ever matters.
 */

import type { DataConnection, PeerOptions } from "peerjs";
import { Peer } from "peerjs";
import type { Channel, HostChannel, PeerChannel } from "./protocol.ts";
import { peerIdForCode } from "./room.ts";

/** Wrap a live PeerJS connection as a Channel. */
function wrap<In, Out>(conn: DataConnection): Channel<In, Out> {
  const subs = new Set<(msg: In) => void>();
  let open = true;
  conn.on("data", (data) => {
    // PeerJS hands over whatever was serialised. Anything that is not one
    // of our messages is ignored rather than thrown: a peer on a different
    // build must not be able to crash this one by sending nonsense.
    if (typeof data === "object" && data !== null && "type" in data) {
      for (const cb of [...subs]) cb(data as In);
    }
  });
  const shut = (): void => {
    open = false;
    subs.clear();
  };
  conn.on("close", shut);
  conn.on("error", shut);
  return {
    send: (msg) => {
      if (open) conn.send(msg);
    },
    onMessage: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    close: () => {
      shut();
      conn.close();
    },
    get open() {
      return open;
    },
  };
}

export interface RoomHandle {
  /** The room code others type or click a link to. */
  code: string;
  /** Stop accepting connections and drop the broker registration. */
  close(): void;
}

/**
 * Open a room under `code` and hand every arriving connection to `accept`.
 *
 * Resolves once the broker has confirmed the id, because until then the
 * code cannot be shared — showing a room code that nobody can dial yet is
 * worse than a moment's wait.
 */
export function hostRoom(
  code: string,
  accept: (channel: HostChannel) => void,
  options: PeerOptions = {},
): Promise<RoomHandle> {
  const peer = new Peer(peerIdForCode(code), options);
  return new Promise((resolve, reject) => {
    peer.on("open", () => {
      peer.on("connection", (conn) => {
        conn.on("open", () => accept(wrap(conn)));
      });
      resolve({
        code,
        close: () => peer.destroy(),
      });
    });
    peer.on("error", (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}

/**
 * Dial a room. Resolves with the channel once the host has accepted.
 *
 * `unavailable-id` from the broker means nobody is hosting that code —
 * which is by far the most likely failure and deserves a sentence a player
 * can act on rather than a library error.
 */
export function joinRoom(
  code: string,
  options: PeerOptions = {},
): Promise<PeerChannel> {
  const peer = new Peer(options);
  return new Promise((resolve, reject) => {
    peer.on("open", () => {
      const conn = peer.connect(peerIdForCode(code), { reliable: true });
      conn.on("open", () => resolve(wrap(conn)));
      conn.on("error", (err) => reject(asJoinError(err, code)));
    });
    peer.on("error", (err) => reject(asJoinError(err, code)));
  });
}

function asJoinError(err: unknown, code: string): Error {
  const type = (err as { type?: string }).type;
  if (type === "peer-unavailable" || type === "unavailable-id") {
    return new Error(`nobody is hosting room ${code}`);
  }
  if (type === "network" || type === "server-error") {
    return new Error("could not reach the connection broker — check your network");
  }
  return err instanceof Error ? err : new Error(String(err));
}
