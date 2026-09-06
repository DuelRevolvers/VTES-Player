# Multiplayer — the host/peer core

2026-09-04, phase 6. A game played across several browsers, with one of
them authoritative. `src/net/`: the protocol, the host session and the
peer transport, with the carrier left abstract.

---

## 1. The protocol sits ABOVE the carrier, and that is the whole design

`Channel<In, Out>` is four members — `send`, `onMessage`, `close`, `open` —
and knows nothing about PeerJS. A `DataConnection` satisfies it in a few
lines of adapter; so does a pair of in-memory queues.

That is not tidiness, it is the only way any of this gets tested. A
`loopback()` pair plays **a whole three-seat game to a finish with two
seats remote**, in 200ms, headlessly, in CI. Had the protocol been written
against PeerJS, none of the interesting behaviour — masking per recipient,
stale answers, reconnection, an in-flight submission when the table closes
— could have been asserted at all.

It is also the same move as `LocalServer : public Server` one level down
(docs/cockatrice-lessons.md §2), applied to the network instead of to the
engine.

**Deliveries are asynchronous even in the loopback** (a resolved promise,
so the microtask queue). A loopback that delivered synchronously would let
a re-entrancy bug through that a real network would find on day one.

## 2. What the host adds over a local game

The host runs a `LocalTransport` — the very one hotseat uses — and serves
everyone else from it. The engine needed no change at all: it already
enumerates every legal option and rejects anything else, so an intent from
a peer is validated by exactly the code that validates a click. Three
things are new, and all three exist only because there is a network:

**Masking per recipient.** `view()` masks to whichever seat is being
*asked*, which is right for a shared screen and wrong for a peer: a peer
must see their own hand all the time, whoever the game is waiting on. So
`LocalTransport.stateFor(seat)` masks to a *named* seat, and each peer is
sent their own. It deliberately ignores `omniscient` — that is a local
debugging switch, and a host flipping it must not start broadcasting the
table's hands. A test flips it and checks.

**Withholding decisions.** A peer is sent a `DecisionPoint` only when it is
theirs. Not because the UI would show it, but because a `DecisionPoint`
carries that seat's legal OPTIONS, and an option list says what is in
their hand.

**Refusing stale answers.** Covered below.

The strongest of the tests is the negative one: it takes every card name
in the other seats' decks and asserts none of them appears anywhere in the
JSON a peer was sent. Not "the UI does not show it" — **it is not on the
wire**. A peer cannot leak what it was never given.

## 3. A `choose` names the decision it answers

Over a network a click can arrive after the decision it was made against
has already been answered. So `ChooseMsg` carries `seq` — the
`DecisionPoint.seq` it is answering — and the host refuses a mismatch
rather than applying the option to whatever is current now.

This is the network's version of a rule the UI already had: the option
buttons disable while a submission is in flight, "because over a network a
second click would be answering a stale decision" (written into
`transport.ts` a month before there was a network).

**WHICH decision is checked before WHOSE**, and the order is deliberate. A
stale answer is usually stale *because* the game has moved on to somebody
else, so testing the seat first reports the symptom ("it is Carol's
decision") instead of the cause. The test found this by hitting the wrong
branch, and both are now pinned.

## 4. Reconnection needed no machinery

A `sync` carries the entire masked state, every time. So a peer that drops
and comes back does not need a catch-up log, a diff, or a replay — it
sends `hello` naming the seat it had and gets the next sync, which is the
whole game. `HostSession` re-attaches the seat if the old channel is gone
and refuses if it is still open.

Re-sending everything is affordable *because* the state is small and
already masked, and it removes an entire class of divergence bug. Sending
diffs would be the optimisation to reach for only if it is ever measured
to matter.

## 5. The seam paid out exactly as designed

`PeerTransport implements GameTransport`, so `DebugApp` renders a
networked game with **no change whatsoever**. The four properties written
into that interface on 2026-08-29 each land here:

| Written then | Pays out now |
| --- | --- |
| `choose()` is async | the answer genuinely arrives later |
| `view()` is a snapshot, not a handle | a peer only ever holds what it was sent |
| agents are stepped by the authority | a peer runs none and need not know which seats are AI |
| `history` is a nullable privilege | a peer cannot rewind a shared game; the UI omits the controls |

## 6. The bug the tests found, in the test harness

`close()` on the loopback dropped messages that had already been sent —
and every goodbye is "send `bye`, then `close`", so a turned-away peer
learned nothing and looked like it had silently vanished. Three tests
failed on it at once.

A message is now dropped only if the channel was **already closed when it
was sent**; once it is on the wire, a later close does not recall it.
Which is also how a real connection behaves.

## 7. Not done yet

- **No PeerJS adapter.** It is a `Channel` implementation and a signalling
  concern (room codes, join links), and it belongs with the lobby screen
  that needs it. Nothing above it changes.
- **No lobby.** Seat assignment is the caller's; `HostSession.accept` takes
  a channel and the peer names the seat it was given.
- **No spectators.** A connection must claim a seat. A spectator is a peer
  sent `redactFor(state, NO_SEAT)` and never a decision, which is a small
  addition once there is a UI for it.
- **"Who has looked at this card" is still unmodelled** (Revelations). It
  is not a wire problem — the masking is structural and correct — but an
  AI seat cannot remember a hand it was shown. Recorded in
  `docs/partial-support.md`.
- **No deck hash.** Worth copying from Cockatrice so two players can
  confirm they loaded the same deck.
