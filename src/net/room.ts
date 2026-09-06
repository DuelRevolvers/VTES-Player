/**
 * Room codes and join links (docs/lobby-design.md).
 *
 * A room needs a name two people can agree on: one types it, or clicks a
 * link. Everything here is a pure string function, so the part that has to
 * be exactly right is testable without a network.
 *
 * WHAT A ROOM CODE IS: the host's PeerJS id, in a form a person can read
 * over a voice call. There is no directory and no server holding a list of
 * rooms — the code IS the address, which is what lets the whole thing work
 * with no backend (docs/shell-design.md §1).
 */

/**
 * The alphabet a code is drawn from.
 *
 * No 0/O, no 1/I/L: a code exists to be read aloud and typed back, and
 * those are the pairs people get wrong. Dropping six characters costs
 * almost nothing — 30^6 is still 729 million rooms.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;

/** The PeerJS id namespace. Every client on the public broker shares one
 *  id space, so an unprefixed six-character code would collide with
 *  whatever else is using it. */
const PREFIX = "vtes-";

/** A fresh room code, e.g. "K7M2QP". */
export function newRoomCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Tidy up a code as typed: case, spaces, and the characters people
 * substitute for the ones this alphabet leaves out. Someone who hears
 * "K7M2QP" and types "k7m2qp" or "K7-M2-QP" means the same room, and being
 * strict about it would just make the feature annoying.
 */
export function normaliseRoomCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/0/g, "O")
    .replace(/1/g, "I");
}

/** Is this a code this client could dial? */
export function isRoomCode(code: string): boolean {
  const c = normaliseRoomCode(code);
  return c.length === CODE_LENGTH && [...c].every((ch) => ALPHABET.includes(ch));
}

/** The PeerJS id a room code addresses. */
export function peerIdForCode(code: string): string {
  return PREFIX + normaliseRoomCode(code).toLowerCase();
}

/** The code behind a PeerJS id, or null if it is not one of ours. */
export function codeForPeerId(id: string): string | null {
  if (!id.startsWith(PREFIX)) return null;
  const code = id.slice(PREFIX.length).toUpperCase();
  return isRoomCode(code) ? code : null;
}

/**
 * A link that opens this client straight into a room.
 *
 * The code goes in the FRAGMENT, not the query string. A fragment is never
 * sent to the server, and on GitHub Pages that means the room code stays
 * out of the host's access logs — which matters a little for a code that
 * is the whole of a room's access control.
 */
export function joinLink(code: string, base: string): string {
  const url = new URL(base);
  url.hash = `join=${normaliseRoomCode(code)}`;
  return url.toString();
}

/** The room code in a link, if there is one. */
export function codeFromLink(href: string): string | null {
  let hash: string;
  try {
    hash = new URL(href).hash;
  } catch {
    return null;
  }
  const m = /[#&]join=([^&]+)/.exec(hash);
  if (!m || !m[1]) return null;
  const code = normaliseRoomCode(decodeURIComponent(m[1]));
  return isRoomCode(code) ? code : null;
}
