# The pass clock — a timeout for a player who will not pass

**Owner request, 2026-09-21:**

> *"Add an option in the moderation settings during a game to have a
> timeout for players that are talking too long to pass. This should only
> be for when players are given a choice to play card from their hand or
> pass during other player's turn, not on their turn, and they don't do
> anything for a while, it should auto pass for them. Let it be an option
> for off, then increments of 5 seconds all the way up to 1 minute. This
> should work on every non-bot player, including the host."*

Built in **0.11.03**. Off by default; a host turns it on in Moderation.

---

## 0. The rule it has to live beside

There is a standing owner decision on record in CLAUDE.md:

> **Never auto-skip a player** — per-seat auto-pass toggle, default off,
> applied outside the engine core.

This feature is the same shape and does not weaken that rule, for four
reasons that are all enforced rather than argued:

1. **It is off by default**, and a table that never turns it on behaves
   exactly as one did before this existed.
2. **It never answers a decision on the player's own turn.** That is
   where the real decisions are, and it is what the request says
   explicitly.
3. **It only ever takes an answer the engine was already offering** —
   specifically `pass`. It does not choose between options and it cannot
   reach a decision that must be answered, because a mandatory decision
   enumerates no `pass` at all.
4. **It is outside the engine**, like auto-pass and the AI pacing. It
   answers through the same `choose` a click does, so the command log is
   the only trace and a replay reproduces the game exactly.

`tests/ui/pass-timeout.test.ts` pins all four.

---

## 1. Where the clock lives: on the authority

**In `LocalTransport`**, beside the AI pacing and the auto-pass table, and
for the same reason the agents and the game log are there: **only the
authority sees every seat's decision.**

The alternative — a clock on each client, each passing for its own player
— was rejected on three counts:

- **It would be five clocks with five different ideas of when the
  decision was raised.** The host raises the decision; a guest learns of
  it a message later, and only if its browser is awake.
- **A guest's browser has no reason to cooperate.** The same argument the
  chat ban is enforced at the relay under (`lobby-rework-2026-09-06.md`
  §15): a client-side clock is a request, not a rule.
- **The setting is host-only anyway.** It belongs in Moderation, which is
  the panel about *who answers for a seat*, and Moderation exists only on
  a client that runs the engine (`LocalTransport`). A guest's stored copy
  of the setting would decide nothing, and in fact never reaches a
  transport at all.

So: the host runs one clock, for whichever seat is being asked, whoever's
machine that seat is on. **That is also what makes "including the host"
true for free** — the host's own seat is a seat like any other to the
transport, and nothing in the clock asks whose screen it is.

## 2. Which decisions it applies to

`passClockApplies` in `src/ui/transport.ts`, four conditions:

```
the clock is on            (passTimeoutMs > 0)
a PERSON is being asked    (no agent on dp.seat)
it is somebody else's turn (turnSeatOf(state) !== dp.seat)
PASS IS ALREADY LEGAL      (some option has kind "pass")
```

**The window is deliberately not part of the test.** The request
describes the window as *"a choice to play card from their hand or
pass"*, which is the reaction-and-block window, and that is by far the
commonest case — but keying on `WindowId`, or on a `playCard` option
being present, would make the feature erratic rather than narrower. It
would not fire on the same window when the only thing offered is a block,
or a wake, or a vote.

Measured on the default playtest table, a whole game with the walker in
the test file reaches **338 off-turn decisions where pass is legal**, in
these windows:

| window | count |
| --- | --- |
| `action.announce` | 102 |
| `action.effects` | 200 |
| `combat.beforeRange` | 8 |
| `combat.range` | 4 |
| `combat.beforeStrikes` | 8 |
| `combat.damageResolution` | 4 |
| `combat.press` | 4 |
| `combat.endOfRound` | 8 |

Every one of them is a voluntary *"do you want to do something about
this?"*, which is the class the request describes. The same walk reaches
**4 off-turn decisions with no pass in them** — all `combat.chooseStrike`,
a blocked minion's controller choosing a strike — and those are the ones
condition 4 exists for. There is no pass to take, so the clock would have
to invent an answer; it never runs on them.

**A referendum's polling is in scope**, and that is worth saying out loud
because it is the one case where a timed pass costs something real: the
player abstains. It is still a voluntary off-turn decision where the
engine offers `pass`, p. 28 makes not voting legal, and a player sitting
on a vote is exactly the stall the request is about. If the owner wants
politics exempted, the change is one clause in `passClockApplies` and
one line in the panel's note.

## 3. Arming is idempotent on the decision

The subtle bug, and the one a future change is most likely to
reintroduce.

`emit()` fires on every change and several paths re-enter the automatic
loop. If "arm a clock for this decision" restarted the count each time,
**a stalling player would be handed a fresh interval every time anybody
else's screen repainted** — and at a busy table the clock would never
fire at all.

So the clock is keyed on `DecisionPoint.seq`, which is the identity of the
question being asked: same seq and a clock already running means leave it
alone. `syncPassClock` is the one entry point, and it arms, leaves, or
cancels so that the clock always matches what the loop left on the table.
It is called at the end of `pumpLoop` rather than at each of that loop's
four exits, and rather than in `stepAutomatic` — because the pacing
timers re-enter `pumpLoop` directly, and a clock armed only from
`stepAutomatic` would be missing after every paced AI move.

Two consequences worth knowing:

- **The clock is per decision, not per impulse cycle.** When it fires, the
  next seat asked gets its own interval in full. A clock that carried its
  remainder forward would pass for the second seat almost at once.
- **A change of interval, an undo, a load and a restart all drop the
  clock rather than adjusting it**, so nobody ever loses time they were
  already owed. An undo of a timed-out pass gives that player the whole
  interval back.

**Activity does not reset it.** The clock runs from when the decision was
raised, like a chess clock on that one question, not from the player's
last mouse movement. Selecting a card, opening a panel and reading a card
scan never reach the transport, so there is nothing for the host to
notice; and a clock a player could hold open by jiggling the mouse would
not answer the request.

## 4. Telling a guest

`SyncMsg.passIn` — **milliseconds remaining**, not a deadline. Two
browsers' clocks are not the same clock, so an absolute time from the host
would be read against the wrong one. The peer stamps the arrival and
counts down from there (`PeerTransport.passClockMs`), which is right to
within the latency of one message and cannot drift, because every sync
replaces it.

**Only the peer being waited on is sent one.** Same rule the option list
follows: a countdown on a decision you cannot answer is a countdown you
can do nothing about. The consequence is an asymmetry worth recording —
the host's screen shows a countdown while it waits on a remote player
(it has that clock already), but a guest watching *another* guest stall
sees none. Fixing that means sending every seat's clock to every peer,
which is more protocol for a strictly cosmetic gain.

A peer's countdown never goes negative. Once it reaches zero the pass has
either happened or the message saying so is in flight; a client arguing
with the authority about that would be showing a number it cannot act on.

## 5. Drawing it

**A feature that cannot be discovered is indistinguishable from one that
is absent** (CLAUDE.md), and an invisible clock is worse than that: the
pass would arrive as the table answering out of nowhere. So:

- A chip in the decision bar — `⏳ 14s`, gold, turning blood-red under
  five seconds. Drawn on the screen of the player being waited on **and**
  on the screens watching them (the `waitingFor` bar), because the clock
  belongs to the decision rather than to the viewer.
- Seconds are **rounded up**, so the last thing shown is `1s`. Rounding
  down would show `0s` for a second while the buttons still worked, which
  reads as broken.
- **A line in the game log** when it fires: *"Bea ran out of time, and the
  table passed for them."* It goes through `transport.note`, so it is
  stamped with where it happened, reaches every peer, and lands in the log
  file — not in the chat, which scrolls away.

**The countdown does not repaint the table.** A repaint is `innerHTML =`
on the whole screen and throws away every scroll position, the magnified
card and any open panel — costs this screen already pays on a real change
and has machinery to undo, but paying them once a second would make the
table unreadable while the clock ran. `DebugApp.tickPassClock` touches one
text node, four times a second, and the markup stays `render.ts`'s. It
stops itself when the chip is gone, so nothing has to remember to tear it
down.

## 6. What this cost elsewhere

- **`turnSeatOf(state)` is now exported from `src/engine/state.ts`**, and
  `VtesEngine.turnSeat` delegates to it. It was a private two-line method
  and the clock is its second caller; one question asked in two places
  drifts (CLAUDE.md). No behaviour change — the body moved verbatim.
- **`GameTransport.passClockMs?()`** joins `notices?()` and `botNames?()`
  as an optional member, so a transport with no clock satisfies the
  interface unchanged.
- **`pumpLoop` was split** into `pumpLoop` (the loop, then the clock) and
  `pumpBody` (the loop). Nothing about the loop changed.

## 7. What is not built

- **No per-seat exemption.** The request says every non-bot player
  including the host, so the clock is one table-wide interval. A per-seat
  override would be a second `autoPass` table with nothing asking for it
  yet.
- **No warning before it fires** beyond the chip going red at five
  seconds. A sound or a modal was not asked for and would be the kind of
  thing the owner has twice reported as noise.
- **No clock on a mandatory decision**, by design (§2). A table stalled on
  a strike choice has no automatic way out, and inventing one would be the
  auto-skip the owner ruled out.
