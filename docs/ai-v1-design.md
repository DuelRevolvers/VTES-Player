# AI v1 and batch simulation — phase 5

2026-09-03. AI players that fill empty seats, and a harness that plays
hundreds of games headlessly.

**Status: BUILT.** `npm run simulate` plays 200 games in 5.5 seconds with
no errors, and a ⚙ Settings toggle hands any seat to the AI.

---

## 1. What it is, and what it deliberately is not

`HeuristicAgent` is a **scoring policy**: one pass over the legal options,
a number for each, highest wins, ties broken on a seeded stream. No
lookahead, no simulation of its own, no cloning of the game state.

That is the honest v1. A searching agent needs the engine to be cheaply
clonable and needs a value function worth searching against; both are
real work, and neither is needed to prove out the seam. What this agent
establishes is that **an `Agent` can play a complete game of VTES through
the same interface a human uses**, which is what phase 5 was for.

Three rules govern the file, and they are not style preferences:

1. **It sees only the `PlayerView`.** No `GameState` import, no
   `redactFor`. An agent that reached around the masking would be
   cheating *and* would stop working the moment it ran as a remote seat
   in phase 6. A test asserts the import list, not the prose.
2. **It is deterministic.** Tie-breaking uses a seeded xorshift — the
   engine's own generator — never `Math.random`. Principle 2 says a game
   is its seed plus its command log; an AI rolling its own dice would
   make replays a lie. A test plays the same game twice and compares
   command logs, with a different-seed control so "reproducible" is not
   trivially true.
3. **It only ever returns an offered id.** It scores the list it is
   handed. The legal-move generator stays the single source of legality
   (principle 4), and the AI never reasons about whether a move is
   allowed — only about whether it is good.

All of the policy's knowledge lives in one `Weights` object, so it can be
read and argued with without reading the code.

---

## 2. The batch harness

`runBatch` drives the engine's own pull loop — decision, ask the agent,
apply, repeat — with no transport and no DOM. `npm run simulate` wraps it
with the real playtest decks.

Two design choices worth keeping:

- **`runGame` never throws; a crash is a result.** A harness that fell
  over on the first bad game would find one bug per run. Errors are
  counted, grouped by message, and reported *with a reproducing seed*.
- **A missing agent is a hard error, not a silent `PassAgent`.** A
  fallback would make the batch measure something other than the agents
  under test.

Everything is seeded: a run is reproducible from `{seed, games}`, so a
failing game can be replayed exactly and a batch that changes between
runs means the code changed, not the dice.

---

## 3. THE FINDING: `PlayerView` could not support a blocking decision

**The first batch run was 10 games and 10 stalls.** Every game ran out at
20,000 decisions with the same trace: Alice declaring the same block,
failing, and declaring it again.

The engine was right. p. 25 is explicit:

> "A minion can attempt to block as many times as they wish as long as
> another minion is not already blocking. **If one attempt to block
> fails, another can be made as often as the blocking Methuselah
> wishes.** Once a Methuselah decides not to make any further attempts to
> block, that decision is final."

So an unlimited retry is a *rule*, and the termination is a **judgement**
— the Methuselah choosing to stop. A judgement needs the numbers, and
**`PlayerView` did not carry them**: it had no notion of the action in
progress at all. A human reads stealth and intercept off the table; an
agent had nothing.

So `PlayerView` gained an optional `action` block: the acting minion, the
kind, the target, the current stealth, and the intercept each of the
VIEWER's own minions has against it. **All of it is open information** —
the acting minion is face up and both totals are sums of cards played
face up — which is why exposing it is not a leak, and phase 6's remote
seat will need exactly the same.

The policy then gained one line that matters more than all the weights:

```ts
if (intercept < act.stealth) return -Infinity;
```

**This is the kind of gap phase 5 exists to find.** Phase 4 was pulled
forward on the same logic — that a harness which only detects *crashes*
will not detect *wrong* — and this is the mirror image: a view that is
correct about what it hides can still be missing something a player
needs.

---

## 4. What the AI actually does

Measured over 30 games (20,937 decisions):

| chosen | count |
|---|---|
| pass | 16,284 |
| playCard | 1,116 |
| takeAction | 930 |
| transferToVampire | 627 |
| useAbility | 494 |
| chooseStrike | 480 |
| endMinionPhase | 368 |
| declareBlock | 315 |
| influenceOut | 120 |

**64 distinct cards played.** The heavy pass count is normal VTES — every
seat is cycled through every window — but the rest is a real game:
influencing vampires out, bleeding, blocking, fighting, using cards in
play.

Games end by **ousting**, not by the turn cap: total victory points
average 3.0 in a 3-seat game, which is exactly 2 ousts plus
last-standing, and `draws: 0` across every batch run.

---

## 5. Putting an AI in a seat

⚙ Settings → **AI players** → a checkbox per seat. The transport needed
**no new machinery**: `stepAutomatic` has always played agent seats, and
`setAgent` just adds or removes one. That is the transport seam paying
out exactly as designed.

Which seats are AI-driven is a **client preference**, like auto-pass and
the hand sort: it never enters the command log, so a save replays the
same game whether or not the loading client hands the seat back to an AI.
Each seat gets a seed derived from its name, so two AI seats do not make
identical choices in identical spots, and a reload keeps a seat playing
the same way.

---

## 6. Known limits, honestly

- **The policy does not read card text.** It scores a play by what the
  play costs and which window it is in. Teaching it what individual cards
  do would mean a second, drifting model of the card pool; the right
  answer is for the *option list* to carry more, not for the AI to
  reimplement `cards.ts`.
- **Answers to ChoiceFrames and referendum terms are taken in offered
  order**, deterministically. Reading them properly needs the same thing.
- **Seat results are lopsided** — Carol wins roughly two thirds of games.
  That is a real measurement and **not evidence about the AI**: the
  playtest decks are a hand-made mid-game snapshot with different pools
  per seat (Alice 15, Bob 18, Carol 18) and no attempt at balance. A
  balanced comparison needs identical decks in every seat, which is a
  deck-building job, not an AI one.
- **Revelations' memory gap is still open** (docs/partial-support.md): an
  AI seat that looks at a hand has no way to remember what it saw. No
  card in the current playtest decks reaches it.

---

## 7. Next

The obvious v2 is a **search** agent, and the obvious prerequisite is
making the engine cheap to clone and roll back. `replay(setup, commands)`
already reconstructs any position from the command log, which is a
correct-but-slow version of exactly that — a good starting point, and a
measurement worth taking before designing anything faster.

Before that, though, the cheaper win is **better option information**:
several of the policy's weakest spots are places where the option carries
less than a human sees on screen. That is a change to the legal-move
generator, benefits the UI too, and needs no AI work at all.

---

# 8. AI v2 — the prerequisite measured, and it was the wrong prerequisite

§7 said a searching agent needs cheap cloning, and that `replay(setup,
commands)` is a correct-but-slow version of it to **measure before
designing anything faster**. Measured on 2026-09-06, at a mid-game
position (400 decisions in, 263 events):

| | cost |
|---|---|
| `replay(setup, commands)` | 4.99 ms |
| `structuredClone(state)` | 0.50 ms |
| **JSON round trip** | **0.34 ms** |
| `engine.decision()` (enumerate) | 0.004 ms |

And the number that actually decides it — **a full 1-ply lookahead, trying
every legal option on a fresh copy and settling each**, across 218 real
choices in a whole game:

- mean **6.9** options per real choice
- mean **3.11 ms** per ply, worst case 45 ms
- **zero** options failed on a clone

So cloning is a solved problem: a JSON round trip is 15× cheaper than
replay, and 3 ms per decision is free against the 0.9 s AI pace. The zero
failures are the part worth keeping — every option legal on the original
was legal and applicable on the copy, which is architecture principle 2
("state fully serializable") verified rather than assumed.

## The real blocker is that an agent cannot legitimately have a state

**`Agent.decide(dp, options, view)` is handed a `PlayerView` and never a
`GameState`.** That is principle 5 doing its job: an AI that could clone
the real state would be reading every opponent's hand, which is cheating
and would also stop working the moment it ran as a remote seat. The
architecture prevents it by construction, which is right.

So a search agent needs to build a *plausible* state from the masked view
— determinization, the standard move for imperfect-information games. Two
things make that harder here than usual:

1. **`PlayerView` carries no frame stack.** It has seats, minions, cards in
   play, pools, hands and counts — the board — but nothing about the
   impulse cycle, the action in flight or the combat. A state rebuilt from
   it could not be handed to the engine to apply a move at all, which is
   the whole point of the exercise.
2. **Deck lists are private in VTES.** Even a full determinization could
   not draw a plausible opponent hand, because it does not know what is in
   their deck — only what has been played. So the model of what an
   opponent might react with is weak no matter how much work goes in.

## The decision this leaves for the owner

Three routes, and they differ in kind rather than in effort:

- **Widen `PlayerView`** to carry enough sequencing state to be replayed
  from. Correct, keeps the no-cheating boundary, and is a careful piece of
  work on the one interface where a mistake leaks hidden information.
- **Give the search agent the real state through an explicitly privileged
  path.** Cheap and effective, and it is *cheating* — defensible only for
  a local bot the player has opted into, never for an opponent in a
  networked game. It would need to be impossible to enable in phase 6.
- **Stay with a policy and improve it.** Honest about what it is; the
  measurements above say the remaining policy gains are small.

Nothing is built here beyond the measurement, because which route to take
is a design decision about the hidden-information boundary, and that is not
one to make silently.

### RULED, 2026-09-06 — the owner answered

> "The AI should work like a player and only work off of the information a
> normal player would possibly know or can see/read from the table."

**The privileged-state route is out**, whatever it would cost to build,
and it is out permanently rather than "for now" — the ruling is about what
an AI opponent *is*, not about what is convenient. So the live routes are
**widen `PlayerView`** and **stay with a policy**, and any search agent
built later must reason from the same projection a human seat gets.

Two consequences worth writing down before anyone designs against them:

1. **A search agent will have to DETERMINIZE**, and that is not a
   workaround — it is what the ruling asks for. A player at the table
   reasons about what an opponent *probably* holds; deck lists are private
   in VTES, so even a perfect determinization is a guess. An agent that
   guesses well is playing the game; an agent that reads the hand is not.
2. **Widening the view is now the risky half of v2**, because every field
   added to `PlayerView` for the sake of replayability is a chance to leak.
   That risk is why `tests/ai/information-boundary.test.ts` exists.

### The standing guard

`tests/ai/information-boundary.test.ts` turns the ruling into an enforced
invariant rather than a note. It walks **real dealt games** with AI seats
and, at **every decision**, checks the view handed to the agent against the
set of card instances that seat may not read — computed from the real state
out of the rulebook rules (another Methuselah's hand p. 7; every draw pile
*including your own* p. 14; another Methuselah's uncontrolled region p. 14,
face up only on reaching the ready region p. 36; a face-down store on
somebody else's card in play), less the two legitimate exceptions, which
are asked of the engine rather than assumed away: an **open hand** (Owl
Companion, Revelations superior) and a card this seat has been **shown** and
therefore remembers.

Three things about how it is built, each of which was a choice:

- **It matches per card INSTANCE, not by name.** A card can sit in one
  seat's hidden hand and face up on the table at the same moment, so the
  same string is legitimate in one place and a leak in another. Only the
  instance id tells them apart.
- **The walk is field-blind**, recursing over the whole view for any
  `{id, name}` pair. That is the entire point: it catches a field that does
  not exist yet, which is exactly the pressure widening the view applies.
- **The positive control is the load-bearing half.** Measured: one walk
  checks ~306,000 hidden instances and **none of them reaches the view at
  all**, not even face down — `viewFor` collapses a hidden zone to a count
  rather than to masked cards. So the walk alone cannot prove the detector
  works, and a test that only walked would be this project's oldest failure
  shape (*empty for the wrong reason*) wearing a new hat. The control feeds
  it two deliberately leaky views — another seat's hand, and the viewer's
  **own** library — and requires both to be caught.

---

# 9. The combat the seat is in

`PlayerView.action` exists because phase 5's first batch run stalled: an
agent asked to block had no numbers to judge it with. **The same gap sat
one frame along and went unnoticed for longer** — a seat asked to choose a
strike, spend a press, or use a prevention credit was told *nothing* about
the fight. Not who it was against, not their blood, not the range, not the
round.

The policy compensated by scoring strikes on **kind alone**, and by
approximating "are we losing" from the viewer's own **weakest ready
minion** — a guess about the wrong minion, since the one in the fight may
be neither the weakest nor in any danger.

`PlayerView.combat` now carries the round, step, range, both combatants,
which side the viewer is on, and the minion opposing them. **Every field is
open information**: both combatants are face up, the range is known to the
table (p. 29), and the round is something everyone has been watching. The
same argument that made `action` safe.

**`side: null` is a real case, not an edge case.** p. 28 lets a minion
controlled by *any* Methuselah play into a combat it is not in, and
measurement says **573 of 2,341 combat decisions** — a quarter — are taken
by seats that are not fighting. The old approximation answered them with a
fact about the viewer's own minions elsewhere, which was meaningless.

## What it bought, honestly

The policy now scores a strike as lethal when it meets the opposing
minion's remaining blood (p. 31: a vampire with no blood left to mend goes
to torpor), dodges only when *the minion in the fight* is the one at risk
and its own strike would not end it first, and presses when it is close to
finishing rather than when its unrelated vampires look healthy.

**Verified live and not measurable.** `view.combat` is populated at all
2,341 combat decisions in 30 games; but strike and press decisions are only
**252** of them, of which about **40** fall in the cases the new logic
changes. Four mirror matches at 600 games each returned 0.000, 0.005,
−0.001 and −0.018 VP. It ships as a **correctness** fix with a measured
frequency, the standard `influenceCapacity` and the live bleed already set.

**It is also a step on the v2 path.** §8 named "widen `PlayerView` so it
can be replayed from" as the honest route to a searching agent; this is the
first piece of sequencing state to cross that boundary, and it crossed it
without leaking anything — which is the argument that the route is
workable.

## The pattern this round establishes

Four policy changes in a row have come out **correct, live, and
unmeasurable**: the block kinds, the optional-choice ordering, the live
bleed, and now combat awareness. That is not four failures — each fixed a
real defect, and three of them were the AI reasoning from the wrong number
entirely. It is evidence about **where the remaining value is**: not in
what the policy does with a decision, but in how many decisions it can see
far enough ahead to get right. That is v2.
