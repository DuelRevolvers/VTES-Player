# Richer options — what the engine already knew and threw away

2026-09-03. A follow-on from phase 5.

**The principle: the engine is the only thing that actually knows what an
option does. When it does not say, every consumer re-derives it — the UI
by leaving the number off the screen, an agent by building a second,
drifting model of the card pool.**

Both new fields are things the enumerator **already computed in order to
decide the option was legal**, and then discarded.

---

## 1. `declareBlock` now carries its own arithmetic

Before: `{ id, kind, label, minion }`. The enumerator had just called
`blockTollFor` (to know the minion could pay at all) and
`blockWouldSucceed` sits in the same module — neither number survived.

Now it also carries **`intercept`**, **`stealth`**, **`wouldSucceed`** and
**`toll`**, and the label reads *"W: attempt to block (2 vs 1) (burn 1)"*
or *"…(0 vs 1, would fail)"*.

Three consumers, one source:

- **The UI** dims a block that would fail. It is **marked, never hidden**
  — p. 25 makes the attempt legal and either side may still play a card,
  so it stays the player's call; they simply should not have to find two
  numbers elsewhere on the screen to make it.
- **The AI** reads `wouldSucceed` instead of cross-referencing
  `PlayerView`, and now subtracts the toll from the value of blocking.
- **The tests** in `block-tax.test.ts` assert `toll` rather than parsing
  the label, which is what they were always about — and the label is now
  free to change without breaking them.

`wouldSucceed` is deliberately **"right now", not a promise.** Cards are
still to come.

---

## 2. `playCard` now carries what it costs

Before, the button could not show a price and an agent could not weigh
one play against another, even though `playCostFor` had just run to
decide affordability.

Now every `playCard` option carries `cost: { blood, pool }` — the **LIVE**
cost, with every modifier in force already in the number
(docs/play-cost-design.md), not the printed one.

**Done in ONE place, not at the forty `makeOption` call sites.**
`compileSpec` wraps the handler's `options` and fills the field in.
Forty sites are forty chances to forget, and — the important part — **a
cost that appears on some cards and not others is worse than none**: the
UI would price half its buttons and an agent would read the unpriced half
as free.

### 2.1 The hand-rolled gap, for the third time

Wrapping `compileSpec` covers spec-compiled cards. A **hand-rolled**
handler builds its own options and reported nothing — and this is exactly
the failure `docs/last-equipment-modifiers-design.md` records twice
already: `costTypes` was undefined on Blood Doll and .44 Magnum, so a
play-cost modifier keyed on "master cards" silently skipped them.

So the fallback lives in **`backfillCentralQueries`**, beside the others:
any `playCard` option still lacking a cost gets the handler's own
declared price. Precise where the compiler can be precise, honest
everywhere else, and **never absent**.

`tests/cards/central-queries.test.ts` walks a real game and asserts no
`playCard` option is ever missing a cost.

---

## 3. A test that was asserting the wrong thing

The AI test "refuses a master card that would spend it down to nothing"
was written with **Blood Doll**, and it failed the moment the AI started
reading real costs.

**Blood Doll costs nothing.** The registry says `poolCost: null` and the
card text confirms it — it is a free master. The AI played it and was
*right* to; the test had assumed a price that was never there, and the
guard it was checking would only have looked correct because the old
policy refused every master at low pool regardless of cost.

Rewritten with **Channel 10** (2 pool), which is what the assertion was
always trying to say. Recorded because it is the same shape as every
"empty for the wrong reason" bug in this project, one level up: a test
can pass for the wrong reason too.

---

## 4. What this does not do

The AI still **does not read card text**, and should not: that would be
the second, drifting model this whole change exists to avoid. What
improved is that the option now answers *"what does this cost me"*, which
is a question the engine can answer authoritatively and the AI cannot.

The obvious next candidates, all the same shape — a number the enumerator
computes and drops:

- **`takeAction` for a bleed** could carry the bleed amount (`currentBleed`
  is right there), so the button reads "bleed Bob for 2" and the AI stops
  reading `bleedAmount` off the minion and missing every modifier.
- **`castVote`** already carries `count`, which is why the vote scoring is
  the least guessy part of the policy — a worked example of the payoff.
- **`chooseStrike`** could carry the damage it would inflict.

---

# 4. A bleed says what it is worth (2026-09-06)

The first item this doc predicted, built once the decision profile
(`docs/ai-bench-design.md` §10) showed `takeAction` is **12.6% of every
real choice** the AI makes — its second-largest class, and its single
biggest scoring term.

**The gap.** A `takeAction` bleed carried only the minion id, so every
reader had to work out what the bleed was worth. The AI used
`MinionState.bleedAmount` — the **printed** field — so a card in play that
made a bleed worth three looked like a bleed worth one. The screen could
not say either: the button read "Andi Liu: bleed".

**The option now carries `bleed`**, the number the action would announce
at, with statics, auras and conditionals already in it. The engine
computed exactly that to build the option.

## Pricing an action that has not happened yet

`currentBleed(state, af)` needs an `ActionFrame`, and before announcement
there is none. The temptation is a second, simpler calculation for the
option list — which is exactly the drift this project keeps finding.

So `currentBleed` was **factored, not copied**: its body is `bleedOf`, and
`prospectiveBleed(state, minion, target)` calls the same body with the
announcement **synthesized rather than looked up**. That is honest because
everything the calculation reads — the kind, the target, the actor,
directedness — is fixed at announcement anyway (p. 25); the synthesized
event says only what announcing would make true. `conditionalStatic` grew
a sibling that takes the announcement instead of finding it, so the
condition rules stay in one place.

`actionId` is null for a prospective bleed, which correctly contributes
nothing from the event-log fold: **no modifier has been played on an
action that does not exist**.

The test that matters is the third one — the offered number and
`currentBleed` after announcement must agree, so no card can make them
disagree.

## How much it matters

Measured across four precon mirrors: the live bleed differs from the
printed one in **2.4%–7.6%** of bleed options, always by 1. Small, but the
AI's score is `bleedPrey + amount × bleedPerPoint`, so a difference of one
moves it by 4 — enough to change **which minion bleeds**.

**Not A/B-measurable, and stated as such.** This is a code path rather
than a weight, so `--against` cannot express it without a toggle built only
for the test. It ships as a **correctness** fix with a measured frequency,
not as a proven VP gain — the same standard applied to `influenceCapacity`.
The bench confirms no regression.

**The UI gets it for free**, which was half the argument for putting the
number on the option: the button now reads "Andi Liu: bleed Bob for 3".

## Next of the same shape

`chooseStrike` could carry its damage, the last of the three this doc
named. Beyond that the profile points at `playCard` (11.7% of real
choices), which is the harder one: it needs an option to say what a card
*does*, in the `CardSpec`'s own vocabulary rather than in prose.

---

# 5. A play says what it would DO (2026-09-06)

The largest item on the list at the end of §4, and the one the decision
profile pointed at: **`playCard` is 11.7% of every real choice**, and the
policy scored a play by its live cost and the window it was offered in and
by nothing else. A 4-pool master that wins the game and a 4-pool master
that does nothing scored identically. Read plainly, the AI's card play was
"prefer the cheapest thing in hand", which is close to the opposite of how
the game is played.

The alternative — teaching the policy to read card text — is the thing
this project has refused since the first card wave, and for the same
reason each time: it would be a **second model of the card pool**, drifting
from the first from the day it was written. So the engine says.

## What it reports

`LegalOption.playCard.effects` is a list of `{ tag, amount? }`, from a
closed vocabulary of sixteen families (`PlayEffectTag` in `options.ts`):
bleed, stealth, intercept, poolGain, poolDrain, bloodGain, damage,
prevent, combat, votes, unlock, wake, deny, steal, board, search.

It is deliberately a **summary and not a description**. It answers "what
family of thing does this do, and how big" — roughly what a player reads
off a card at a glance, and exactly what a scoring policy can weigh. It is
not enough to simulate a play and is not meant to be: a search agent
evaluates by applying the move, not by reading this.

Two rules the vocabulary carries, both of which a reader can get wrong:

- **An absent amount is not zero.** A cancel, a wake, a card put into play
  has no natural size. A reader that defaults the amount to zero prices
  exactly the cards whose whole point is not numeric as doing nothing.
- **A negative amount is a reduction and keeps its sign.** Taking two
  bleed off an opponent's action is worth about what adding two to your
  own is.

## The mapping, and why one half is exhaustive and the other is not

`EFFECT_TAGS` in `src/cards/effects/summary.ts` is
`Record<EffectPrimitive["kind"], PlayEffectTag | null>` — **exhaustive by
type**, so TypeScript refuses to compile when a 136th primitive is added
without classifying it. A `default:` case would have been shorter and
would have let a new primitive be silently worth nothing, which is this
project's oldest failure shape: a value that is empty for the wrong reason
looks exactly like one that is correctly empty. Classifying a new
primitive is one line; noticing that a card silently scores as furniture
is an afternoon.

**It earned that immediately**: the first compile failed on
`playFromHand`, which the survey grep had missed because it is spelled as
an intersection (`({ kind: "playFromHand" } & PlayFromHandFilter)`).

The permanent-side maps (`STATIC_TAGS`, `PERMANENT_TAGS`) are
**deliberately partial**, and the asymmetry is the point: an unclassified
primitive makes a card worth nothing, while an unclassified permanent
clause still reports `board` — coarse, but true, since the card really
does put something lasting on the table. A missing entry there loses
precision; a missing entry in the other loses the card.

## Coverage, measured at each step

With the primitive table alone, **63.8%** of the `playCard` options in real
games carried a summary. The empty 36% was dominated by masters, allies
and retainers — Vessel, the hunting grounds, Raven Spy, the Vozhd —
because a card whose work is done *from play* has no effects to
summarise. Reading `spec.permanent` / `ally` / `weapon` / `rush` took it to
**88.6%**.

The last 11% was the **hand-rolled tail**, which has no spec to derive
anything from: Vessel alone was 463 of 642. Those cards state their own
summary, exactly as they had to state their own `costTypes` — the same
silent gap, in the same place, for the third time. That took it to
**98.7%**, and what remains is Consign to Oblivion, whose entire content is
a play-cost modifier and is tagged `null` on purpose.

Attachment is done in **one place** — the `backfillCentralQueries` wrapper
that already attaches the live cost — for the reason recorded there:
forty `makeOption` call sites are forty chances to forget, and a summary
that appears on some cards and not others is worse than none, because a
reader prices the unsummarised half as doing nothing.

## THE MEASUREMENT, which did not say what I expected

The first weights priced all sixteen families on plausible reasoning: a
card on the table is worth having, combat advantage is worth having,
denial is worth about what it denies. Four mirror matches of 800 games:

| deck | full pricing vs effect-blind |
| --- | --- |
| Hecata | **+0.115** VP (±0.112) |
| Toreador | **−0.169** VP (±0.107), replicated at −0.141 on fresh deals |
| Brujah | −0.070 (inside ±0.108) |
| Nosferatu | no difference |

So the obvious version **fails this project's own bar** — "never
measurably worse" — and it fails it on a deck, not on noise: the Toreador
result replicated on a different set of 200 deals.

Pricing only what moves **pool** — the currency the game is won in
(p. 43) — clears the bar:

| deck | pool-only pricing vs effect-blind |
| --- | --- |
| Toreador | **+0.106** VP (±0.105) |
| Hecata | +0.056 (inside ±0.113) |
| Brujah | +0.045 (inside ±0.111) |
| Nosferatu | −0.099 (inside ±0.109) |

Never measurably worse, once measurably better. That is what ships:
`bleed`, `poolDrain`, `poolGain` and `steal` are priced and the other
twelve are **zero**.

**The zeroes are a result, not an omission**, and the honest limit of the
claim is worth stating: the twelve were only ever measured *together*, so
"board and combat are harmful" would be over-claiming. The plausible
reading is that this policy has no way to CONVERT board presence or combat
advantage into pool, so paying for them only diverts it from bleeding —
but that is a hypothesis, and isolating the twelve is a measurement
somebody can make with `--weights effectValue.<family>=N`. The tags stay
in the vocabulary regardless, because they are correct facts about the
option, wanted by the UI and by any search agent.

## And it found a live engine bug

On its first four-deck run the bench reported **5 errors in 800 Brujah
games**: `unknown minion: C-lib-62` — a LIBRARY card id looked up as a
minion, which is what an **ALLY** is, since an ally's `MinionId` is the id
of the card that became it. The ally had been burned while the block
attempt it declared was still on the stack, and **four** places read
`ba.blocker` with `getMinion`, which throws.

That is the engine's own recorded rule broken in four places at once: *a
minion can leave play at any point, so read it with `findMinion`*. Three
of the four are option enumerators, which must be **total** — a throw
there surfaces as a game with no answerable decision rather than as an
error anybody can act on, which is the exact shape of the frozen table
reported in the 2026-09-05 playtest.

The timing is the part worth keeping: `resolveBlockAttempt` already fails
an attempt whose blocker has gone, so the dangerous window is **before**
that — the attempt's own impulse cycle, where every seat is asked and
every card in hand is enumerated against a blocker that is no longer
there. Pinned in `tests/engine/blocker-left-play.test.ts`, and **verified
against the unfixed code**, where it fails with the bench's own message.

My first attempt at that regression **passed on the unfixed code**, which
is the "empty for the wrong reason" shape in a test rather than a card: it
used a leave-torpor, and the blocker-gone case fails the attempt before
reaching the branch it was aiming at. The regression targets Organized
Resistance's enumerator instead, which is the site that actually crashed.

Neither the fuzz nor `npm run simulate` could have found it: both play the
mid-game snapshot, which has no allies blocking.

## A stale assertion this shook out

`tests/ui/table-view.test.ts` asserted that `CardBurned` fires **exactly
zero** times in a whole game — true when written, and a fact about the AI
of the day rather than about the code under test. The effect-aware policy
plays a card that burns one. The test's real subject is that the ash-heap
count reads the ZONE and not the events, so it now says that: the two
numbers are not the same one. *An assertion about a total is a hostage to
every future change* — the keyword-test lesson, in a third costume.

---

# 6. Actions beyond the bleed (2026-09-06)

The queue's item after §5 was "`takeAction` is 12.6% of real choices and
only the bleed says what it is worth; hunts, rushes, diablerie and
political actions are scored by kind alone". **Surveying it first changed
what the item was**, which is the useful part of this entry.

## What `takeAction` actually contains

Measured over 32 real games on four precons — options OFFERED, by kind:

| kind | offered | chosen |
| --- | --- | --- |
| hunt | 1184 | 44 |
| bleed | 1093 | 735 |
| rescue | 56 | 0 |
| diablerize | 51 | 1 |
| leaveTorpor | 4 | 2 |
| **cardEffect** | **0** | **0** |

Two things fall straight out. **`cardEffect` never appears here at all** —
an action card is announced through a `playCard` option, so §5 already
covered it, and the queue entry naming it was wrong. And **rescue,
diablerie and political actions are rounding error**: 111 offers across 32
games, taken three times. Enriching them would be work whose payoff is
measured in single decisions per hundred games.

So `takeAction` is, in practice, **hunt versus bleed** — and the bleed half
was done in §4. That left the hunt, and a bug found while reading the
neighbouring code.

## The bug: the block decision was still reading the printed number

§4 put a bleed's live value on the OPTION, so the seat *choosing* to bleed
scores it correctly. `scoreBlock` — the seat deciding whether to **stop**
that bleed — still read the acting minion's printed `bleedAmount`, because
`PlayerView.action` carried the stealth and not the bleed. **The same wrong
number, surviving one decision along, and into the place it matters more:**
choosing which of your own minions bleeds is a preference, while choosing
whether to block is where pool is actually defended.

Measured: **236 of 269 block decisions are against a bleed, and in 17.8% of
them the live value differs from the printed one.** Nearly one blocking
decision in five was scored on a number the table could see was wrong.

`PlayerView.action.bleed` closes it — present only for a bleed, because a
`0` on a hunt would read as "a bleed worth nothing". It is open information
on the same argument as the stealth beside it: the amount is a fold over
face-up cards, and it is precisely what every seat can see they are about
to lose.

## The hunt says what it would gain

`LegalOption.takeAction.gain` is `huntGain(state, minion)` — the hunt
amount capped by what the vampire can still hold. **p. 6 is why the cap
belongs in the engine**: excess blood goes to the BLOOD BANK, not to the
Methuselah's pool, so a hunt at capacity puts nothing anywhere.

**Zero is a real answer, and a common one: 43.9% of hunt options in real
games gain nothing.** The option stays legal, because hunting triggers
cards that care about a successful hunt — the hunt is deliberately not
gated by `canGainBlood` (docs/futile-options-design.md) — so it is the
SCORE that changes, not the legality.

The old policy scored such a hunt at `hunt` (1), above `pass` (0.5), so it
would take it. That is a real cost: acting **locks** the vampire (p. 25),
trading the ability to block for no blood at all. `huntFutile` prices it
below passing.

## …and it is INERT, which the bench said and a probe explained

`huntFutile` is a weight rather than a hard-coded rule precisely so the
claim could be falsified, and it was:

| deck | fixing futile hunts vs pricing them as before |
| --- | --- |
| Hecata | 0.000 |
| Toreador | 0.000 |
| Brujah | 0.007 |
| Nosferatu | 0.000 |

Three exact zeros is a signal, not a result, so the follow-up probe asked
the obvious question: **a futile hunt is offered 425 times and CHOSEN
ONCE** under the old pricing. In 419 of those 425 decisions another action
— almost always a bleed, at a score four times higher — was on the table
and won anyway. The policy's other weights were already preventing the
mistake.

Kept, on the `influenceCapacity` standard: correct on its own terms, cheap,
and a guard for the case where bleeding is unattractive (a prey with pool
to spare and blockers up). **Not claimed as an improvement** — the 43.9%
figure is true and was costing nothing.

## What this entry is really evidence of

Three of the four action kinds the queue named are too rare to be worth
enriching, and the one behavioural fix available was already being made by
accident. The value in `takeAction` was **one bug in the blocking
decision**, which was found by reading the code next door rather than by
the profile that named the item.

The profile counts DECISIONS; it cannot see which of them were already
being got right. Frequency picks the place to look, and only reading tells
you whether there is anything there.
