# What to learn from Cockatrice (and what not to)

Reference read of `Cockatrice-2026-08-25-Development-3.1.0-beta.9/`
(2026-08-29). C++/Qt, **GPL-2.0**.

## 0. Licence — read it, do not port it

Cockatrice is GPL-2.0. Studying its architecture is fine and is the point
of having it here. **Copying code — including hand-translating a file into
TypeScript — would put this project under the GPL.** For a Dark Pack fan
project that may want its own licensing choices later, that is a door to
leave shut. Everything below is a *pattern*, described from the outside;
nothing in `src/` is derived from their source.

## 1. The headline finding: Cockatrice has no rules engine

Its entire in-game command vocabulary is manual tabletop manipulation:

```
shuffle · mulligan · draw_cards · undo_draw · move_card · flip_card
attach_card · create_token · create_counter · set_card_attr · set_counter
roll_die · next_turn · reverse_turn · set_active_phase · reveal_cards
dump_zone · create_arrow · concede
```

There is no "cast this spell", no stack, no priority, no legality check.
Players move cards by hand and agree on what happened. The server enforces
**zone integrity and information hiding** — you cannot peek into a library,
you cannot move a card you do not control — and nothing else. That is what
their README means by "prevents users from manipulating the game for unfair
advantage": it stops cheating, not rules errors.

**Two consequences, and they point in opposite directions.**

- It is why Cockatrice supports every MTG card ever printed with **zero
  card implementations**, and why our 218/444 grind has no counterpart
  there. We should not read their card coverage as a benchmark; it is a
  different quantity.
- It is why Cockatrice **cannot have AI opponents**, which is this
  project's headline feature. An AI needs a legal-move generator; a
  virtual tabletop has none. Their model cannot be extended to give us
  what we want.

So: **do not copy the core model.** The rules-authoritative engine
(architecture principles 3–5) is the right call precisely *because* of the
AI requirement, and it is a harder product than theirs by design. This
document is about everything *around* that core, which is where the real
reference value is.

## 2. Take this: one Server, two transports — **BUILT 2026-08-29**

Implemented as `src/ui/transport.ts`; see §2.1 below for what shipped.


```cpp
class LocalServer : public Server        // single-player
class RemoteClient : public AbstractClient
class LocalClient  : public AbstractClient
```

Single-player is **not a special code path**. `LocalServer` *is* the real
server, running in-process, spoken to over a loopback transport. The client
cannot tell which it is connected to.

**Action for us, and it is cheap now and expensive later.** Phase 6 is
"PeerJS, host browser authoritative". Today `DebugApp` reaches straight
into `this.engine.state` and `this.engine.decision()` everywhere. Every one
of those is a synchronous, in-process assumption that a network transport
will break. Before the UI grows further, the loop should talk to a small
interface — "give me the current decision", "submit this option", "tell me
when state changed" — with two implementations:

- **local**: calls the engine directly (hotseat, AI batch, tests)
- **peer**: sends the option id to the host and awaits the new state

The engine already generates every legal option and validates any submitted
id, so the host-authoritative half is done. What is missing is only the
seam. Retrofitting it after the UI has grown is the expensive version.

### 2.1 What shipped

`src/ui/transport.ts`:

```ts
interface GameTransport {
  decision(): DecisionPoint | null;
  view(): GameState;
  choose(optionId: string): Promise<void>;
  onChanged(cb: () => void): () => void;
  readonly history: GameHistory | null;
}
```

`LocalTransport` is the only implementation today: the engine in this
browser, used by hotseat, agent-driven testing, and — unchanged — the
phase-6 **host**. A peer transport swaps in with no change to `DebugApp`,
which no longer imports the engine at all.

Four decisions worth keeping:

- **`choose()` is async even though the local answer is immediate.** That
  is the whole point: the call site already handles a result that arrives
  later, so a network round trip changes nothing. The option buttons
  disable while a submission is in flight, because over a network a second
  click would be answering a stale decision.
- **`view()` is a snapshot to render, not a handle to reach into.** Local
  returns the raw `GameState` (the debug table is deliberately omniscient —
  Cockatrice's `omniscient` flag); a peer will return the masked view the
  host sent it.
- **Agents are stepped by the authority, not the UI.** `runAgents()` lives
  in the transport, so the UI is only ever asked about human seats. In
  phase 6 the host runs the agents and peers only see results.
- **`history` is a separate, nullable privilege.** A connected peer cannot
  unilaterally rewind a shared game, so its transport reports `null` and
  the UI omits the whole control group rather than showing it disabled.
  Undo, restart, save and load all live behind it.

`tests/ui/transport.test.ts` pins the contract a peer transport must also
satisfy: a full game played through `choose()`, an illegal id rejected
without mutating, change notification with working unsubscribe, agent seats
never surfacing to the UI, undo stepping back exactly one, and
snapshot/load round-tripping byte-identically.

## 3. Take this: per-recipient serialisation with an omniscient flag

```cpp
void Server_CardZone::getInfo(ServerInfo_Zone *info,
                              Server_AbstractParticipant *recipient,
                              bool omniscient);
```

Every zone serialises **differently per recipient**, with an explicit
`omniscient` escape hatch for spectators and judges. That is exactly our
`viewFor(state, seat)`, and `omniscient` is exactly the debug UI's choice
to read raw `GameState`. Good confirmation that the boundary is in the
right place.

Two gaps it exposes on our side:

- ~~**`PlayerView` omits `permanents`**~~ — **FIXED 2026-08-29.** While
  fixing it the rulebook settled a zone I had assumed was public and is
  not: the **uncontrolled region is dealt FACE DOWN** and only its owner
  may look at it (p. 14), turning face up only on the move to the ready
  region (p. 36). `viewFor` now carries `permanents` (public),
  `uncontrolled` with `card: null` for other seats but counters always
  visible (they sit on a face-down card in the real game), and
  `cryptCount`. `tests/engine/player-view.test.ts` pins it.
- **They track `isCardAtPosLookedAt` — per card, per player, "who has seen
  this".** We have no model for it, and VTES needs one: any effect that
  looks at a hand or the top of a library means that player now legitimately
  knows those cards, and a correct masked view has to remember it. Today
  our masking is purely structural ("your hand yes, theirs no"). This is a
  real gap for phase 6, not phase 4.

## 4. Take this: their card-picture loader is more careful than ours

Ours (`cardImage` in `src/ui/render.ts`) leans entirely on the browser:
request the URL, hide the `<img>` on error, show the name behind it. Theirs
adds four things we do not have:

- **Three placeholder states, not two**: normal card back, *loading in
  progress*, and *failed*. We only distinguish loaded from failed, so a
  slow connection looks identical to a broken one.
- **A failure cooldown** (`QHash<QString, QDateTime> failedAt`): a card
  that failed is not retried immediately, but *is* retried later. We never
  retry at all — one flaky load and that card is text for the session.
- **Two-level cache**: an in-memory pixmap cache in front of a
  disk/network cache, switchable (`NETWORK_CACHE` / `FILESYSTEM_CACHE`).
- **Bulk pre-warm** (`cacheCardPixmaps(QList<ExactCard>)`): fetch a whole
  deck's art up front rather than on first sight.

With 40-odd scans in a hand, the loading state and the pre-warm are the two
that would actually show. Worth doing when image loading next gets touched.

## 5. Do NOT take this: their replay format

```proto
message GameReplay {
    repeated GameEventContainer event_list = 3;   // the effects
}
```

They record the **event stream** and replay by re-applying it, because
there is no engine to replay *through*. We record the **command log** and
re-derive everything by replaying it into a fresh engine — smaller,
self-verifying, and it doubles as undo. That only works because the engine
is deterministic and authoritative, which is the payoff of principle 2.
Ours is the better model here; keep it.

## 6. Worth stealing for phase 7: the deck hash

`DeckList` carries name, comments, tags, `gameFormat`, a last-loaded
timestamp, sideboard plans — and a `cachedDeckHash`. The **hash** is the
interesting part: a short stable fingerprint of a decklist, used to confirm
two players hold the deck they claim and to identify a deck at a glance.
For us it is the thing to put in a bug report next to the save file.

## 7. Housekeeping

The folder sits **inside** the repo (52 MB) and was not ignored. It is now
in `.gitignore`: it is a GPL C++ tree, it should not be committed into a
project that ships to GitHub Pages in phase 9, and it is reference
material rather than a dependency. Nothing else about it affects the
build — `tsconfig.json` only includes `src`/`scripts`/`tests`, and the
test suite is unchanged at 84 files / 435 tests.

## 8. Summary of actions

| # | Action | When |
|---|---|---|
| 1 | ~~Transport seam between the UI loop and the engine~~ | **DONE** 2026-08-29 (§2.1) |
| 2 | ~~Add `permanents` to `PlayerView`~~ | **DONE** 2026-08-29 (§3) |
| 3 | Model "who has looked at this card" | Phase 6 |
| 4 | Loading/failed states, retry cooldown, deck pre-warm for scans | When images are next touched |
| 5 | Deck hash | Phase 7 |
| — | Do not adopt their rules-free tabletop model, or their event-stream replays | — |
