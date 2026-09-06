# The lobby, room codes, and PeerJS

2026-09-04. The room people gather in before a game, the code they use to
find it, and the one file that knows a network exists.

`src/net/room.ts` (pure), `src/net/lobby.ts`, `src/net/peerjs.ts`.

---

## 1. The thing the spec asks for that cannot be built

The spec says: *"After you press Join, there should be a list of all of
the rooms people have created and are looking for players to join."*

**A list of all rooms needs a directory** — a server that every host
registers with and every joiner queries. There is no such thing here, by
the owner's own decision that profiles and everything around them stay
local (docs/shell-design.md §1). A peer-to-peer client can be *told* an
address; it cannot enumerate addresses nobody published.

So what is built is **room codes and join links**: the host gets a code,
sends it however they like, and the joiner types it or clicks it. That
covers "play with friends" completely and does not cover "find a stranger's
open game" at all. A public room list is a backend feature, and if the
owner wants it, it is the same decision as accounts and a shared
leaderboard — flagged, not decided here.

## 2. A code is an address, not a lookup

`newRoomCode()` draws from a 30-character alphabet with **no 0/O and no
1/I/L**: the code exists to be read aloud and typed back, and those are
the pairs people get wrong. Six characters is still 729 million rooms.
`normaliseRoomCode()` then forgives case, spaces, dashes and exactly those
substitutions, because being strict about them would only make the feature
annoying.

The code *is* the host's PeerJS id (`vtes-` prefixed, since the public
broker is one shared id space). There is no lookup step and nothing to be
out of date.

**The code goes in a link's FRAGMENT, not its query string.** A fragment is
never sent to the server, so on GitHub Pages the room code stays out of
the access log — which matters, a little, for a string that is the whole
of a room's access control.

## 3. One connection, two phases

A guest joins a `LobbyHost`, takes a seat, says what deck they are
bringing; the host starts; and **the very same channel** carries the game
from then on. No reconnect, so there is no window in which a player is
attached to neither the lobby nor the game. `LobbyHost.start()` sends
`started`, unsubscribes its own handler, and hands each channel to a
`HostSession`.

**What a guest is told is a summary.** Seat names, whether each seat has a
deck, and why the game cannot start — never a deck list. What is in a deck
is its owner's business before the deal and hidden information after it. A
test asserts a pasted card name does not appear anywhere in the lobby
state.

**The problems go to everyone, not just the host**, so nobody has to ask
why the start button is greyed out.

### 3.1 The bug the second guest found

`SeatKind` was `"you" | "ai" | "open"`, and a guest taking a seat only
*renamed* it. So the seat stayed open, the next arrival took the same one,
and renamed it out from under the first player — who then no longer
matched any seat and lost their own `mine` flag.

Adding **`"remote"`** fixed it, and needed no other change anywhere: a seat
held by a distant human behaves exactly like one held by the local human,
and only `open` (nobody yet) and `ai` (attach a bot) are ever asked about.
Three tests failed on this at once, which is the argument for having
written the "two players with the same name" test at all.

### 3.2 A rule that was right when written and wrong later

`buildTable` refused an online table with no open seat — sensible when
creating a room, and fatal at the moment of starting one, because by then
everybody has *arrived* and there are no open seats left. The test is now
"open **or already taken by a peer**", which is correct in both moments.

The general shape is familiar from the card waves: a condition written
against one instant, applied at another.

## 4. Leaving

A guest who leaves frees the seat and **their deck goes with them**.
Keeping it would deal a game containing a deck nobody at the table brought.

## 5. PeerJS, and the broker

`src/net/peerjs.ts` is the only file in `src/net/` that knows a network
exists. Everything above it is written against `Channel` and tested over
an in-memory pair, which is why the adapter can afford to be the one
untested piece — it is thin by construction.

**A decision the owner should see:** WebRTC cannot introduce two browsers
to each other by itself; something has to pass the first message. PeerJS
defaults to a **free public broker** (0.peerjs.com). It carries the
introduction only — once connected, game traffic is peer-to-peer and never
reaches it — and it stores nothing. But it *is* a third party this client
depends on to start a game, and it can be down. Self-hosting one is a few
lines of `PeerOptions` if that ever matters.

Two smaller decisions in there: a message that is not one of ours is
**ignored rather than thrown**, so a peer on a different build cannot crash
this one by sending nonsense; and `peer-unavailable` is translated to
"nobody is hosting room X", because that is by far the likeliest failure
and a library error code is not something a player can act on.

## 6. The screens

Wired the same day. **Whether a table is online is DERIVED from its seats**
(`isOnlineTable`) rather than held in a switch beside them: a "play online"
checkbox and a set of seats are two facts that can contradict each other,
and this is one that cannot. Set a seat to *Open (online)* and Start opens
a room instead of dealing.

**One lobby screen serves both sides.** The host's has a Start button and
a guest's does not; everything else — the code, who is here, what is
missing — is the same information, because it *is* the same information.
A guest's deck picker is the new-game panel with one branch in the
handler: a guest **sends** their choice rather than writing it into a local
table, since the host is what validates it.

**A join link skips the menu.** `codeFromLink(location.href)` is read at
boot: someone who clicked a link has already said what they want. They
still meet the profile screen first if they have no profile, because a
seat is labelled with a name.

Copy feedback lives **on the button** ("Copied", for a moment). A toast
would need a timer and somewhere to live; this needs neither.

## 7. What the end-to-end test found

A test plays the whole path — join, pick a deck, start, and a real game
across one channel — and its first version asserted "every seat has 30
pool" right after the deal. It failed at 29: **the bots are stepped the
instant the game exists**, so by the time anything can look, one of them
has already played a master. The assertion was measuring the wrong moment,
not catching a bug; the p. 14 opening is pinned in `fresh-game.test.ts`,
where nothing is playing yet.

## 8. The host keeps editing while people arrive

`LobbyHost.update()` existed and nothing called it. The lobby's seat rows
are now the new-game controls for any seat the host still owns — change a
bot's deck, or turn a bot into another open seat — right up until Start.
**A seat a guest holds is not editable**: they brought that deck, and the
host reaching into it would be taking it off them.

Every such change re-broadcasts, because the other side of it is that
everyone waiting is being told *why the game cannot start*; a change that
only repainted the host's screen would leave that stale.

## 9. The deck fingerprint

Cockatrice's `DeckList` carries a hash and it earns its keep here for the
same reason: two players, one of whom pasted a list and one of whom picked
a precon, want to say "we have the same cards" without reading 90 lines to
each other. It is also what a bug report needs — "the deck was 7QK4-M2P8"
identifies a deck exactly, where "my Brujah deck" does not.

**A deck is a MULTISET**, so the hash is taken over a *canonical* form:
counts, sorted, one line each. Otherwise it would fingerprint the typing
rather than the deck. Crypt cards key by KRCG id and library cards by
name — the same keys `DeckList` itself uses, so the fingerprint cannot
describe a deck other than the one that gets dealt. It is computed through
`seatDeckHash`, which resolves the deck by the same path the game will.

**Plainly not a security device.** It is two 32-bit non-cryptographic
hashes, ~40 bits, in the room-code alphabet so it can be read aloud. It
catches a different deck; it would not stop somebody deliberately building
a collision. Nothing relies on it — the host validates every deck itself
and deals from the deck it was given, never from the hash. A test checks
the pool's 18 precons all differ, which is the real bar.

**The hash IS shared with the table, where the deck list is not** — and
that is the point of having one: it says two decks are the same without
saying what either contains.

## 10. Spectators

`hello`/`join` take a `spectate` flag. A spectator **takes no seat**, so
none of the seat rules apply — any number may watch, a full table can
still be watched, and a lobby with one open seat still has one open seat
after ten spectators arrive.

They are sent **`redactFor(state, NO_SEAT)`**: masked to nobody, so every
hand, crypt and uncontrolled region is face down *including the ones a
player at the table can read*. Public information stays public — pools,
victory points, cards in play, and the SIZE of each hand, all of which are
visible across a real table. Measured: a player sees 7 card names (their
own), a spectator sees 0.

That masking is the whole implementation, which is the payoff for
`redactFor` being a total function of the seat rather than a set of
special cases — and it exposed the one place it was **not** total.
`openHandsFor` called `getSeat(viewer)`, which throws for a viewer who
holds no seat. Both its rules are keyed on the viewer controlling
something, so the answer for a non-player is `[]`; "mask to nobody" is the
one call that has to be total, and now is.

A spectator is also **never sent a decision**, so there is nothing for
them to answer — and `PeerTransport` refuses locally before anything
reaches the wire.

## 11. Not done yet

- **The adapter is untested**, and cannot be tested here — it needs two
  browsers. Everything it feeds is covered.
- **No room list** (see §1) — it needs a server, and the owner has ruled
  that out.
- **A spectator cannot be kicked**, and the host is not told who is
  watching beyond a count.
