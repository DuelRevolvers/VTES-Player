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
