# Debug hotseat UI — design

Status: **design, awaiting owner review** (2026-08-29). Phase 4, pulled
forward ahead of the rest of the phase-3 card sweep by owner decision:
226 library cards is a long time to build with only unit tests as
validation, and the fuzz harness finds *crashes*, not *wrong outcomes*.

## 1. What this is, and what it is not

A **debug tool for playtesting the engine**, not the shipping table UI.
It is omniscient by default, dense rather than pretty, and optimised for
answering "why did the engine offer me that?" — not for atmosphere.

Non-goals for v1: card art as the primary display, animation, AI seats,
networking, deck building. Each is additive later and none changes the
structure below.

## 2. The core loop (and why it does not use `Agent`)

`Agent.decide(dp, options, view)` is **synchronous** — it returns an
option id. A human cannot answer synchronously, so the UI does **not**
implement `Agent`. Making `Agent` async would ripple `await` through the
whole engine for no gain.

Instead the UI drives the engine as a pull loop, which is what
`VtesEngine` already exposes:

```ts
function step(): void {
  const dp = engine.decision();
  if (!dp) return render();          // game over
  const agent = agents[dp.seat];     // null for a human seat
  if (agent) {                       // AI / PassAgent seat
    engine.choose(agent.decide(dp, dp.options, viewFor(engine.state, dp.seat)));
    return step();                   // keep stepping while nobody human is asked
  }
  render(dp);                        // human seat: stop, wait for a click
}
```

Clicking an option calls `engine.choose(id)` and re-enters `step()`. This
one loop covers hotseat (every seat human), solo testing (one human, the
rest `PassAgent`), and phase 5's AI seats with no change.

## 3. Rendering model

**Vanilla TypeScript and DOM, full re-render, no new dependencies.**

The whole screen is a pure function of `(GameState, DecisionPoint | null)`.
There is at most one decision per few hundred milliseconds of human time,
so re-rendering everything on each step is free, and it removes an entire
class of stale-view bugs. React would save perhaps forty lines and cost a
new toolchain for someone new to TypeScript. Not worth it here.

The renderer reads `engine.state` **directly**, not `viewFor()` — this is
a debug tool and hidden information is exactly what we want to inspect.

## 4. Layout

Each seat gets a **player mat** with the same dedicated zones a physical
table has, in the same reading order, rather than one undifferentiated
column of minions.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ DECISION   Bob · action.effects · seq 47             [undo] [save] [load]  │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ [ M: attempt to block (burn 1) ]  [ W: attempt to block ]           │  │
│  │ [ play Eyes of Argus (superior) ]  [ Pass ]                         │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────┬──────────────────────────┤
│ ┌─ Alice ◆edge ──────── pool ●27 · VP 0 ─────┐ │ FRAME STACK              │
│ │ READY   ┌─────────┐ ┌─────────┐            │ │  turn   Alice / minion   │
│ │         │Trung Ch.│ │ V2   🔒 │            │ │  action bleed V1→Bob   A │
│ │         │ 🩸●●●   │ │ 🩸●●    │            │ │  blockAttempt  M         │
│ │         │ cap 5   │ │ cap 4   │            │ ├──────────────────────────┤
│ │         │ Anarch  │ │ +Scope  │            │ │ EVENT LOG      [filter…] │
│ │         └─────────┘ └─────────┘            │ │  MinionLocked V1         │
│ │ TORPOR  (empty)                            │ │  ActionAnnounced bleed   │
│ │ UNCTRL  [▧ ●●] [▧ ●] [▧]                   │ │  StealthModified +1      │
│ │ IN PLAY  The Barrens (2)                   │ │  BlockCostImposed 1      │
│ │ CRYPT 8  │ LIBRARY 42 │ HAND 7 │ ASH 3     │ │  BlockDeclared M         │
│ └────────────────────────────────────────────┘ │  BloodBurned M 1         │
│ ┌─ Bob ─────────────── pool ●24 · VP 0 ──────┐ │  …                       │
│ │ …same zones…                               │ │                          │
│ └────────────────────────────────────────────┘ │                          │
├────────────────────────────────────────────────┴──────────────────────────┤
│ COMBAT  round 2 · close range          V1 🩸●●●●  ⚔  M 🩸●●                │
│         strikes: V1 hand · M —         pending: M 2 dmg                    │
├───────────────────────────────────────────────────────────────────────────┤
│ HAND (Bob)  [Eyes of Argus] [Deflection] [Wake…] [Govern the Unaligned]    │
└───────────────────────────────────────────────────────────────────────────┘
```

**Zones on each player mat**, every one already backed by `SeatState`:

| Zone | Engine source | Shown as |
|---|---|---|
| Pool | `pool: number` | counter pips + number |
| VP / ousted | `victoryPoints`, `ousted` | header |
| Edge | `GameState.edge` | ◆ marker on the holding seat |
| **Ready region** | `minions.filter(m => !m.inTorpor)` | minion tiles |
| **Torpor** | `minions.filter(m => m.inTorpor)` | dimmed tiles, own row |
| **Uncontrolled** | `uncontrolled: UncontrolledEntry[]` | face-down tiles + counters |
| **Cards in play** | `permanents: PermanentInPlay[]` | name + counters + locked |
| **Crypt deck** | `crypt.length` | back-of-card tile + count |
| **Library deck** | `library.length` | back-of-card tile + count |
| Hand | `hand.length` (full list for the deciding seat) | count + bottom strip |

A **minion tile** carries name, blood/life pips, capacity, locked /
torpor / awake badges, disciplines, title, clan, sect, and its attached
cards with their counters — the same information the physical card plus
its counters and equipment carries.

**Uncontrolled** gets its own row rather than being folded into ready,
because influencing is a whole phase and you need to see the counters
accumulating on each vampire to play it.

**The battlefield** is the `COMBAT` strip, which appears only while a
`CombatFrame` is on the stack: round, range, both combatants with their
blood, the chosen strikes, and the pending damage queue. Combat in VTES
is between two minions rather than on a shared board, so a strip that
appears on demand beats a permanently reserved area — and the pending
damage queue is exactly the thing that is invisible today.

The other three regions are as before:

1. **Decision bar.** The point of the whole tool: the deciding seat, the
   `WindowId`, the decision `seq`, and every legal option as a button
   using the engine's own `label`. Options grouped by `kind` (actions,
   card plays, blocks, pass) so a twenty-option minion phase stays
   readable. The raw option `id` goes in a `title` tooltip — that is what
   trace tests match on, so writing a regression test from a live game
   becomes copy-and-paste.

2. **Frame stack.** The sequencing debugger, and the panel I expect to
   earn its keep fastest: every genuinely hard bug in this engine so far
   has been a sequencing bug. Each frame's kind plus the fields that
   matter for it (action: kind/target/step; blockAttempt: blocker;
   combat: round/range/step), innermost last.

3. **Event log.** Newest at the bottom, scrolled to the end, filterable
   by substring.

### 4.1 The ash heap — the one zone with no engine field

A physical table has a discard pile per player; `SeatState` has no
`ashHeap`. Burned cards emit `CardBurned` and then simply cease to exist.

The UI can show one anyway, **read-only, derived from the event log** —
`eventLog.filter(ev => ev.type === "CardBurned")` is already the complete
record of everything ever burned, the same trick that gave us game-wide
uniqueness for Open War. That is display only: it adds no engine state
and does not prejudge the real ash-heap *region* (cards that can be
retrieved and interacted with), which stays **BLOCKED pending owner
review** per CLAUDE.md. If the region is ever built, the panel is already
there to point at it.

Caveat worth stating: `CardBurned` does not currently record whose card
it was, so a derived ash heap is a single shared pile, not per-seat.
Splitting it per owner would need a field on the event — a one-line
change, but an engine change, so it is not in v1.

## 5. Undo, save, load

`GameState.commandLog` records `(seq, optionId)` pairs and the state
carries `rngState`; the header comment already promises that replaying
them reproduces a game exactly. So:

- **Undo** = rebuild a fresh engine from the saved setup and replay the
  command log minus the last *n* entries. Not a state diff, not a
  snapshot stack — a replay. Undoing "one decision" is `n = 1`; undoing
  back to the start of the current action is a search backwards through
  the log for the `ActionAnnounced` boundary.
- **Save** = `JSON.stringify({ setup, commandLog })` to a file and to
  `localStorage`.
- **Load** = replay it.

This is the feature that makes the remaining card sweep faster: when a
card resolves wrongly, you save, and the file reproduces it exactly for a
regression test. It is cheap only because principle 2 (deterministic +
event-sourced) was settled up front — this is that decision paying out.

## 6. Decks

A new `config/playtest-decks.json`: per seat a name, a crypt list, and a
library list of card names. Loading validates every name against
`src/cards/registry.json` **and** `config/supported.json`, and refuses to
start with a clear list of offenders rather than silently dropping them
(the same rule the real deck importer must follow).

**Fixture vampires for v1, real crypt next.** The crypt importer is one
parser away from unlocking 118 of 217 crypt cards (those whose entire
card text is `"Anarch."` or `"Camarilla Prince of Melbourne."` — pure
capacity/disciplines/clan/sect/title, all already fields on
`MinionState`). But the UI reads `MinionState` either way, so swapping
fixtures for imported vampires later changes **no UI code at all**. Ship
the UI on fixtures, then do the parser — that ordering gets to a playable
screen soonest and costs nothing in rework.

## 6.1 Real cards, real scans (2026-08-29)

Owner call: play with **actual cards**, not text stand-ins. Every card on
the table now renders as its official KRCG scan, from the `image` URL the
phase-1 pipeline already recorded — same source, same permission as the
card data (static.krcg.org, VEKN data used with permission). Nothing is
fetched at build time; the browser loads them.

Scans appear for minions, uncontrolled vampires, cards in play, attached
equipment/retainers, both combatants, and the hand. State that a physical
table shows with counters and orientation is laid **over** the card:
blood pips bottom-left, capacity top-right, counter badges on the corner,
and a **locked card is rotated 90°**, the way it actually sits. Hovering
any scan opens a full-size magnifier with the card's rules text.

**Graceful degradation matters here.** The card name is rendered *behind*
every scan; if the image 404s or there is no network, `onerror` hides the
`<img>` and the name shows through. An offline session degrades to the
text tile this design started with rather than a wall of empty boxes.

### The crypt had to become real first

A scan of a vampire requires the vampire to *be* a card, and the fixtures
were invented. So `src/ui/cardinfo.ts` now does the crypt read that phase
7 needs, minus the abilities: deck entries are **KRCG ids**, and name,
capacity, clan, disciplines, sect, title and image all come from the
registry. Two things it taught us, both of which phase 7 will want:

- The registry stores crypt disciplines **capitalised** (`"Dom"`) while
  every card spec and the engine use `"dom"`. The import lowercases them.
- Sect and title parse off the card-text prefix — `"Camarilla Prince of
  Melbourne:"`, `"Sabbat bishop:"`, `"Anarch Baron of Columbus."` — and
  every title in the V5 crypt maps onto `VampireTitle` (`"Assamite
  Justicar"` → `justicar`).

**Crypt ABILITIES are still unimplemented (0/217).** To keep a playtest
honest, all three decks are built from the **118 crypt cards whose ability
text is empty** — a bare sect/title line — so nothing on the table is
silently doing nothing. `validateDecks` reports `inertAbilities` for any
vampire with real card text, a test asserts the list is empty, and the app
logs a console warning rather than failing (the vampire is a real card and
the game plays fine; the player just must not assume its text works).

## 6.2 Playtest feedback, 2026-08-29 — it stopped being debug-only

Four changes after the first real play session. The first is the important
one: it reverses a decision this document made.

**Hidden information is now ON by default.** §3 said the renderer reads raw
`GameState` because "this is a debug tool and hidden information is exactly
what we want to inspect". True for debugging, wrong for playing: in hotseat
everyone shares a screen, and the owner could read the other seats’
uncontrolled vampires. `redactFor(state, seat)` in `engine/agent.ts` is now
THE masking rule — `viewFor` is defined in terms of it, so there is exactly
one set of rules to get right — and `LocalTransport.view()` masks to the
deciding seat. A card the viewer may not see renders as a **card back**, not
a blank. The old behaviour survives as a **Show all** checkbox, which also
reveals the frame-stack panel; that panel is debug-only now.

**The hand is the interface.** Card plays no longer appear as buttons in the
decision bar. A hand card with at least one legal play is lit, lifts on
hover, and is clickable and draggable; one legal play resolves on click,
several open a chooser on the card. Dragging highlights **only the legal
targets** for that card and dropping plays the option aimed at it. This is a
pure indexing layer over the option list (`playsByCard`) — the engine did
not change, because option ids already carry their card instance and target.

**The log is English.** `src/ui/narrate.ts` turns each `GameEvent` into a
sentence ("Alice’s Andi Liu bleeds Bob."), resolving minion ids to names
against the same redacted state the table renders from, so it cannot leak a
card the viewer may not see. Lines carry a weight (major/normal/minor) so
bookkeeping dims. Unnarrated events fall through to a readable last resort
rather than vanishing — a gap to fill, not a thing to hide.

**AI seats are still phase 5.** The playtest game is three human seats
because nothing else exists yet; `LocalTransport` already accepts `agents`
and steps them itself, so wiring one in is a constructor argument, not a
rework.

## 6.3 Second playtest pass, 2026-08-30 — the bottom of the screen is yours

Three changes, and they share one idea: the half of the screen nearest the
player's hands is the player's, and the top of the screen is for things that
are true about the game rather than things you are being asked to do.

**The action bar moved to the bottom, under the hand.** It was at the top,
which put the cards and the buttons that act on those cards at opposite
ends of the window. Now the layout is: a slim header (turn readout, undo /
save / load / restart, settings) → the table → **your hand → the action
bar**. The header keeps a `Turn 4 · Alice · minion phase` readout, which was
previously only inferable from the frame stack — a debug panel that is now
hidden by default.

One layout consequence worth recording: the chooser that opens on a
selected card grows *upward* out of the hand, so **`.hand` must not be a
scroll container** or it clips the menu. The cap and the scrollbar live on
`.decision` instead. A real hand is about seven cards, which wraps at most
twice, so nothing is lost.

**Sorting your hand is a client-side, non-game operation.** Every hand card
is now draggable — playable or not, because sorting is something a player
does constantly, including on decisions where nothing is playable at all.
Dragging therefore means two things, told apart by where the card lands:
onto a minion or a mat it **plays**, onto another hand card it **sorts**
(the pointer's side of the target card decides before-or-after, so a card
can be dropped at either end).

The order lives in `DebugApp.handOrder` — a per-seat list of card ids — and
**never reaches the command log.** That is the important rule: if a sort
were a command, undo would have to rewind past it, and a cosmetic
preference would be tangled up in the game's own history. `orderHand()` in
render.ts reconciles the remembered order against the real hand on every
render, and is total in both directions: cards no longer in hand fall out,
and a card the order has never seen (a fresh draw) lands at the end, which
is where a real player would put it.

**A settings menu, holding auto-pass and the debug reveal.** Auto-pass
answers for a seat when **Pass is its only legal option**, and it is
**per seat, off by default** — the standing rule is that a player is never
skipped, and the reconciliation is that a single-option decision is not a
decision being skipped, it is a question with one answer. A seat with any
real choice is always asked.

Where it lives matters. It is in `LocalTransport`, beside `runAgents` —
renamed `stepAutomatic()`, since agent seats and auto-passing seats are the
same idea: decisions the authority can answer without a human. It is
deliberately **outside the engine**, which goes on offering that lone Pass
exactly as it always has; the pass still lands in the command log as an
ordinary decision, so a replay reproduces the game whether or not the
replaying client has auto-pass on. A test pins exactly that.

The one non-obvious consequence: **undo had to learn to rewind past its own
auto-passes.** Undo replays a shorter command log, and `stepAutomatic` then
re-answers anything automatic — so undoing onto an auto-passed decision
lands right back where it started and the button looks broken.
`rewindPastAutomatic()` keeps stepping back until a human is being asked
something. The same fix covers agent-driven seats, which had the bug
already and nobody had noticed.

Preferences persist in `localStorage` via `src/ui/settings.ts`, which is
explicitly *not* game state: nothing in it goes in the command log, nothing
in it changes what is legal, and a save file carries none of it. In phase 6
that separation is what lets a peer apply its own auto-pass locally without
touching the shared game.

## 7. Deliberate deferrals
- **Masked view toggle.** A "see it as this seat" switch that renders
  `viewFor(state, seat)` instead of the raw state, for checking the
  hidden-information boundary before phase 6. Noted here because it
  surfaces a real gap: **`PlayerView` currently omits `permanents`** —
  cards in play are missing from the masked projection entirely. That
  needs fixing before multiplayer regardless; it is not blocking a debug
  tool that reads raw state.
- **AI seats** — phase 5, and the loop in §2 already has the hook.

## 8. Build order — BUILT (2026-08-29)

1. `src/ui/decks.ts` — deck JSON, validation, initial `GameState`.
2. `src/ui/history.ts` — undo / save / load, all three as replay.
3. `src/ui/render.ts` — the regions above, full re-render.
4. `src/ui/loop.ts` — the pull loop, the human-seat wait, event wiring.
5. `src/ui/style.css`, `src/main.ts`; `npm run dev` opens a playable table.

Plus `config/playtest-decks.json` (three decks, 40–42 cards each, every
name validated) and `tests/ui/playtest-decks.test.ts` — headless proof
that the shipped decks build a legal game, play to completion with no
empty or duplicated decision, and replay byte-identically.

## 9. The one engine change it needed

The plan said engine changes expected **none**, and that any need for one
was a finding rather than a licence. One turned up, and it was worth
finding:

**`freshId` kept its counter in a module-level `let nextId = 0`, outside
`GameState`.** So a second engine in the same process — exactly what undo
does — continued numbering from where the previous game stopped: a replay
produced `action-17` where the original had `action-1`. Semantically the
same game, but not the same state, which contradicts the guarantee
written on `commandLog` itself ("replaying (seq, option) pairs through the
same engine version and RNG seed reproduces the game exactly").

Fixed by moving the counter into `GameState.idSeq` (optional, so every
existing fixture is untouched) and making `freshId` a method. It matters
beyond undo: phase 5 batch AI simulation runs many games per process, and
phase 6 multiplayer compares host and client state.

Worth noting **how** it was found: not by the fuzz harness, which plays
one game per process and so could never see it, and not by any card test.
It took building a feature that runs two engines at once. That is the
argument for pulling the UI forward, in miniature.

---

## 10. AI pacing — owner playtest finding, 2026-09-03

**"The AI responds too quickly. Make it a little slower for each action,
just so it feels a little more natural and non-AI players are able to
follow what's going on."**

An agent answers in microseconds. `stepAutomatic` was a `for (;;)` loop
that kept choosing until a human was asked, so an AI seat's entire turn —
influence, an action, a combat, a discard — landed between two repaints.
The human saw only the aftermath, with the game log as the sole evidence
that anything had happened.

### 10.1 Where it lives, and why not the engine

In the **transport**, beside auto-pass and the agents themselves, for the
reason `docs/ai-v1-design.md` §5 gives for those: **agents are stepped by
the authority, not the UI.** Phase 6's host runs the agents, so the host
owns their pacing too, and a peer watching the host's clock needs no code
of its own.

It is emphatically **not** in the engine. A pause is not a rule, reaches
no command log, and changes no decision — `LocalTransport.aiDelayMs` is a
client preference exactly like `autoPass` and `omniscient`. A test plays
120 human answers against the same seeded agents at 0 ms and at 1800 ms
and asserts the two command logs are **equal**, which is the whole claim
in one assertion.

### 10.2 Only a VISIBLE move is paced

The first design paused on every agent decision, and it is the wrong one.
An impulse cycle asks every seat in turn and most of those answers are
**Pass**; pausing on each would spend the delay budget on nothing
happening, and a player would learn to ignore the pause rather than read
it. So the option the agent actually chose is inspected — a `pass` is
applied instantly and the loop carries on — and what the pacing measures
out is **one beat per thing you can see**.

Two more properties fall out of stating it that way:

- The pause is taken **after** the move is applied: the table shows what
  happened, then holds. Pausing first would hold a table that has not
  changed yet.
- It never waits before **handing control back to a human**. A human sets
  their own pace, so a beat there is a beat spent on nothing.

`PassAgent` is not the pure control case it looks like, and finding that
out fixed the test rather than the code: a seat that MUST act (its own
turn) is offered no pass and it takes the first option instead. The test
therefore asks the agent what it answered rather than assuming — and also
asserts the agents passed at least 20 times, because without that a check
that "no pause followed a pass" would hold vacuously if no pass ever
occurred.

### 10.3 The pause is not a peek, and not the watcher's turn

Two things had to change with it, and both are the same fact: **during the
pause the current decision belongs to the AI.**

- **`view()` masks to the seat being asked**, so masking to the pending
  seat would put the AI's hand on a shared hotseat screen for the length
  of every pause. The pause is drawn through the **last human's** eyes
  instead; with no human yet asked (an all-AI table being spectated) it is
  drawn through `NO_SEAT`, which matches nobody and so hides everything.
- **Nothing on screen may offer to answer it.** The decision bar renders
  "⟨seat⟩ is deciding…" instead of the option buttons, the hand lights no
  card, `wireHand` does not attach, and `submit()` returns early. A human
  sharing the screen must not be able to play the computer's seat for it —
  which is exactly what would have happened, since the buttons are
  rendered from whatever `decision()` returns.

The animated dots exist for a smaller reason that matters anyway: a table
that stops for two seconds with no explanation reads as a client that has
frozen, not one that is working.

### 10.4 Cancelling

`stepAutomatic()` clears any pending timer before it does anything, which
makes it safe to call from anywhere. That matters most for **undo, load
and restart**: all three replay into a *fresh engine*, and a stale timer
would step a game that no longer exists. Pinned by a test that undoes out
of a pause and then advances the clock ten seconds expecting nothing.

Dropping the pace to **Instant** releases a pause already in progress
rather than making an impatient player sit out the interval they just
cancelled.

### 10.5 The setting

⚙ Settings → **AI players → Pace**: Instant / Fast 0.4s / **Normal 0.9s**
(default) / Slow 1.8s / Very slow 3.0s. Persisted in localStorage with the
other preferences, and clamped on load — a hand-edited or pre-existing
value must not be able to hang the table on a huge pause.

`LocalTransport`'s own default is **0**, deliberately: the batch harness,
the fuzz and every test drive this transport, and a pacing default would
make all of them wait on wall-clock time for something that only exists
for a person watching. The UI turns it on; nothing headless does.

---

## 11. Third playtest pass, 2026-09-05

Thirteen items from one session at the client, written up in
`docs/playtest-2026-09-05.md`: the seat grid, seat thumbnails, the play
strip, the ash heap (its count had been meaningless), card pickers that
show cards, a Leave button, card-text sizing, and two real bugs — an ally
that pays its last life mid-action, and a preview that got in the way of
the drag it was previewing.
