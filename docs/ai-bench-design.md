# Measuring whether one AI policy beats another

Written 2026-09-06, in answer to "how do we make the AI better?" — and the
honest first answer was **we cannot currently tell**.

## 1. Why the existing harness could not answer it

`npm run simulate` plays `config/playtest-decks.json`: a hand-authored
MID-GAME snapshot where the seats hold **different decks and different
pools** (Alice 15, Bob 18, Carol 18). CLAUDE.md already warns that the
lopsided seat results there are not evidence about the AI. Any tuning done
against it would be measuring the decks.

Two things landed since the AI was written that fix this, and neither
existed at the time: the **fresh-game deal** (p. 14 — shuffle, seven cards,
four crypt face down, 30 pool) and **`preconDeck()`**, 18 complete decks
straight from the card data. Between them, a fair table is now one call.

## 2. What makes a match fair

Three things would each make a result meaningless, and each is dealt with:

**Different decks** → a **mirror**: the same precon in every seat. The only
thing that differs is who is deciding.

**Seat position** → **rotation**. Your prey and your predator are fixed by
where you sit, so every deal is replayed once per rotation of the policy
assignment, with each policy sitting in each seat the same number of times
against **the same shuffle**. That pairing is what makes a few hundred
games enough.

**Noise** → a **margin**. A difference smaller than its own margin is
printed as "NO DIFFERENCE PROVEN", not as a small win.

The metric is **victory points**, not wins: VTES is multiplayer, so a win
is one seat out of four and throws away most of what happened, while VPs
are the game's own measure and every oust shows up in them (p. 43).

## 3. Two bugs in the harness, both found by its own controls

**The rotation produced duplicate games.** The base assignment ALTERNATED
— `[0,1,0,1]` — and rotating that by one gives `[1,0,1,0]` and then
`[0,1,0,1]` again. A four-seat table therefore had **two** distinct
assignments and played each twice: half the games were exact duplicates,
same deal, same seating, same dice. That wasted the time and, far worse,
told the margin it had twice the sample it really did. It is a **block**
now (`[0,0,1,1]` rotated), which gives four distinct seatings.

**The margin was computed as if the samples were independent.** They are
not: both policies' scores come out of the **same game**, and the victory
points in a game are close to a fixed total (an oust each plus one for the
last standing, p. 43), so one policy scoring more forces the other to score
less. `Var(A−B) = Var(A) + Var(B) − 2·Cov(A,B)`, and a **negative**
covariance makes the true variance **larger** than `Var(A)+Var(B)` — so the
first version reported margins that were too **narrow**, which is the
dangerous direction: it would have called noise a finding. The margin now
comes from the **per-game paired difference**, which measures the thing
directly and needs no covariance term.

The first was spotted because the control run returned *exactly* 0.000,
which is the kind of number worth being suspicious of.

## 4. The two controls, and why both are needed

- **Negative control** — a policy against itself must show no difference.
  With identical policies, complementary rotations cancel exactly, so
  0.000 here is the pairing working rather than a coincidence.
- **Positive control** — a deliberately crippled policy must lose by a
  margin. Without this, the negative control passes just as happily on a
  harness that always answers zero.

`--weights bleedPrey=-100,bleedPerPoint=-100` (never bleed) loses by
**0.96 VP against a margin of ±0.20** — decisive, and in the right
direction. Both are pinned in `tests/ai/bench.test.ts`.

**A measuring instrument has to be measured first**, and the positive
control is the half that is easy to skip. It is this project's oldest
failure shape — a result that is empty for the wrong reason — applied to a
measurement rather than to an option list.

## 5. Calibration

320 games (80 deals × 4 rotations) run in **10 seconds** and resolve a
difference of about **±0.17 VP**. Mean VP per seat is 1.0 on a four-seat
table, so that is roughly a **17% effect**. Smaller changes need more
deals: the margin narrows with the square root, so ±0.08 costs about 1300
games, or 40 seconds.

## 6. A live engine bug it found on its first real run

Four games in 160 died on **`card not in hand`**, thrown from
Garibaldi-Meucci Museum's and Lenelle's ash-heap exchange.

Both cards of the exchange are named **at announcement** (p. 25) and moved
**at resolution**, and the hand card can be gone in between — the action's
own impulse cycle is a window in which its owner may play it.
`stealEquipment`, four cases up in the **same switch**, had guarded against
exactly this since it was written; this clause had not.

Neither the fuzz nor `npm run simulate` could have found it: **both play
the mid-game snapshot**, and it took a game dealt fresh from a real precon
for a full hand and this ability to meet. That is the harness paying for
itself before it was used for its actual purpose.

Reading on record: it is **one exchange with one cost**, so a missing
give-card cancels both halves rather than handing over a free retrieval.
The regression is pinned, and was checked against the unfixed code — it
throws exactly `card not in hand: give1` without the guard.

## 7. What this unlocks

Every change to the policy can now be stated as a number with a margin.
The queue, in order:

1. **Influence targeting.** Every "put a counter on this vampire" option
   scores a flat 6, so ties break on the random stream — the AI picks
   which vampire to bring out by coin flip. The data to do better is
   already in `PlayerView`.
2. **Blocking**, which ignores the toll it pays and what locking that
   minion costs.
3. **Referendum terms**, which score 0 and are taken in offered order.
4. **The weights themselves**, which have never been checked against
   anything.

---

# 8. The first change measured: influence targeting

**The blind spot.** Every `transferToVampire` option scored a flat
`influenceTransfer`, so they all tied and the tie broke on the seeded
stream. **The AI chose which vampire to bring into play by coin flip** —
spreading counters across its whole uncontrolled region and taking far
longer to put anything on the table.

Nothing had to be plumbed for the fix: a seat's own uncontrolled region is
readable to its owner (p. 14), so `PlayerView` already carried each card's
capacity and counters.

**The scoring** is `influenceTransfer + influenceProgress / remaining +
influenceCapacity × capacity`, where `remaining = capacity − counters`.
The first term does two jobs at once — **finish what you started**, since
counters already spent buy nothing until the vampire is in play, and
**cheap first**, since a 4-capacity body arrives four turns before an 11.
It is always a bonus and never a penalty, so influencing can never score
below passing; a policy that stopped influencing would never build a board.

## The numbers, and they are not all flattering

Four mirror matches, 800 games each (200 deals × 4 rotations):

| Deck | Difference | Margin | Verdict |
|---|---|---|---|
| Hecata | **+0.471 VP** | ±0.107 | clear improvement |
| Nosferatu | +0.081 | ±0.110 | not proven |
| Toreador | 0.000 | ±0.104 | no effect at all |
| Brujah | −0.040 | ±0.107 | not proven |

On Hecata it is worth **+0.47 VP** — a seat averages 1.0, so that is a
large effect, and wins went from 328 to 458. On three other decks it does
nothing measurable, and on none of them does it measurably **hurt**.

**Shipped on that basis**: never worse, sometimes much better, and the
reasoning stands independently of the numbers. But the honest headline is
"helps on some decks", not "+0.47 VP".

**The mechanism is not established.** Capacity spread does not explain it
(Toreador's 3–8 is close to Hecata's 2–9, and Brujah also has a 2-drop),
and a single-deck result is exactly what a per-deck sweep exists to catch.
Worth understanding before the next change is tuned against Hecata alone.

**The lesson to carry: measure on more than one deck.** Had the first
result been the only one taken, this would have been written up as a 47%
improvement to the AI. It is not.

## Two of my own changes did not earn their place

**`influenceOut: 12 → 30` was a no-op.** Raising it looked obviously right
— moving a finished vampire into play costs no transfer, and a transfer
that would finish a different one now scores up to ~12.4 and outranks it.
The bench returned an *exactly identical* result over 240 games, because
the order does not matter: the AI adds the last counter first and then
moves **both** vampires out in the same phase. **Reverted** — a weight that
provably does nothing is noise in a table whose purpose is to be argued
with. The behaviour is pinned in `heuristic.test.ts` with that reasoning,
and my own first draft of that test asserted the preference I had already
measured away.

**`influenceCapacity` is unproven and kept knowingly.** Two runs put it at
+0.033 and +0.049 VP, consistently positive and consistently inside the
margin (±0.113 over 800 games); showing it would take some 4,000. Kept
because the reasoning stands — same price, more vampire — and because a
deterministic tie-break is better hygiene than the random one it replaces.
Not claimed as an improvement.

## A label that lied

The run header printed "CONTROL RUN: both sides are the default policy"
whenever the *challenger* was left at its default — which became wrong the
moment `--against` existed, since that is exactly how a new default is
measured against an old one. Fixed. A run labelled as its own opposite is
the sort of thing that poisons a reading weeks later, when only the
transcript survives.

---

# 9. Why Hecata — answered, and it changes the reading

The influence change showed +0.471 VP on Hecata and nothing on three other
decks. A behavioural probe settles what happened, and it is not what the VP
numbers suggested:

| | first vampire in play | minions at turn 10 |
|---|---|---|
| Hecata, old | turn 7.2 | 0.93 |
| Hecata, **new** | **turn 3.0** | **2.70** |
| Toreador, old | turn 8.3 | 0.82 |
| Toreador, **new** | **turn 3.6** | **3.05** |

**The change works equally well on both decks.** It more than halves the
time to a first vampire and roughly triples the board by turn 10, on the
deck where VPs moved and on the deck where they did not.

So the deck-specific part is not the influence at all — it is **what the
policy does with the vampires once they are out**. On Hecata that converts
into ousts; on Toreador it does not. The bottleneck moved downstream.

**And a property of the metric worth writing down: in a mirror match the
total victory points are conserved** (an oust each plus one for the last
standing, p. 43), so mean VP per seat is 1.0 by construction and the bench
can only ever show how a fixed pie is SPLIT. It is the right tool for "is A
better than B" and it is blind to "both got better". Absolute improvements
need behavioural measurements like the table above.

# 10. Where the decisions actually are

Profiled over 30 Hecata games — 26,048 decisions, of which **72.4% are
forced** (a single legal option, no policy involved). Of the 7,189 real
choices:

| Decision | Share | State |
|---|---|---|
| transferToVampire | **39.6%** | fixed above |
| pass | 17.5% | — |
| takeAction | 12.6% | scores the base bleed, not the live one |
| playCard | 11.7% | scores cost only |
| influenceOut | 6.5% | fine |
| answerChoice | 5.3% | offered order |
| declareBlock | 2.3% | — |
| chooseStrike | 1.8% | crude |

**This is the map that should drive the next work**, and it immediately
retired two of my own instincts. Influence was 40% of every real choice —
by far the right first target, which was luck as much as judgement.
Blocking is 2.3%, so the effort spent on it below was mostly wasted, and
now provably so.

# 11. Two more changes, both correct and neither measurable

Kept, because both are right and neither is harmful; reported honestly,
because neither moved the number.

**Blocking, by what the action is.** A single `blockOther` priced stopping
a **diablerie** — a vampire destroyed for good, its blood and a Discipline
handed to the eater (p. 34) — the same as stopping a **hunt**, worth one
blood to its actor and costing the blocker a lock and a combat. Now split
by `ActionKind`. Measured across four decks at 600 games each: three exact
zeros and one +0.030. A probe explains why — of 26,048 decisions, a block
is offered in **256**, and those are 201 bleeds, 33 hunts and 22 card
effects. **A diablerie or rescue block never came up at all**, so the two
weights that carry the real reasoning are written against situations that
bots do not reach.

**Optional choices were all being declined.** `answerChoice` scored 0
against `pass` at 0.5, and declining an optional ChoiceFrame *is* a plain
pass — so the AI refused every optional payoff in the game. That diagnosis
was right and the frequency guess was wrong: measured at ~0.01 VP across
four decks, because the `answerChoice` frames that actually arise are the
**mandatory** ones (unlock tolls, the p. 7 discard-down, a search's "find
nothing"), which have no pass to lose to. The ordering is pinned as an
invariant rather than a number, since it is the relation that matters.

**A test whose premise was wrong, not whose subject was.** Pricing hunts
below `pass` broke the existing "…and TAKES the block when its intercept is
enough" control — which used a *hunt* only because a hunt's +1 inherent
stealth makes intercept meaningful. That made the control depend on hunts
being worth blocking. It uses a stealthed **bleed** now, which is what it
was always testing.

# 12. What this round establishes for the next one

1. **Weight-tweaking is close to exhausted.** Three changes: one large
   behavioural win, two correct and unmeasurable. The remaining big
   classes — `takeAction` and `playCard`, 24% of real choices between them
   — are limited by the same thing: **an option does not say what it is
   worth**. The AI scores a bleed by the minion's printed `bleedAmount`
   rather than the live value, and a card by its cost alone.
2. That is the **richer-options** step, and the profile is now the
   argument for it rather than a hunch.
3. **Measure on four decks from the start.** One deck told a story that
   three others contradicted, twice in one session.
