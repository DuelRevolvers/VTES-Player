# Pool preservation — the bots want to survive

*Owner request, 2026-09-22. Built the same day, 0.11.06.*

> "We need to make it so when the bots are low health, maybe like 8 or
> so, they favor not performing actions that use pool as much unless it is
> absolutely necessary. As they are they will oust themselves without
> thinking about it in order to play something. They should want to
> survive. Make this work for all playstyles and maybe the limit and how
> it works is different for each playstyle due to the nature of that
> playstyle."

## 1. What was actually wrong

Pool is life (p. 4) and the policy did not price it that way. It had
**one** brake, in `scorePlay`:

```ts
if (cost.pool > 0 && pool - cost.pool <= 2) return w.selfOustGuard;
```

A cliff at 2, and **nothing between that and "comfortable"**. `poolCost`
is a flat −2 per point, so a 3-pool master cost the same at 30 pool as at
6. The bot therefore played down to 3 and waited to be bled out, which is
the behaviour the owner reported.

Two things made it worse than one bad number:

- **The cliff only existed on the PLAY path.** A **transfer is a pool
  spend** (p. 35) and `scoreInfluence` had no idea: every transfer scored
  `influenceTransfer` (6) plus progress, against a `pass` of 0.5. A seat
  on 4 pool moved all four transfers onto a 7-capacity vampire it would
  never finish and handed its predator a one-bleed oust. This is the
  worst of the sites because it is the one a bot reaches **every single
  turn** — influence is 39.6% of all real choices
  (`richer-options-design.md` §7).
- **The cliff read the GROSS cost**, so a seat on 5 pool refused the
  blood-to-pool master that would have put it back on 7. It refused the
  cure because it had the disease.

## 2. Three weights, not one

They answer three different questions, and the playstyles want to answer
them differently — which is the whole reason the owner asked for it.

| weight | question | default |
| --- | --- | --- |
| `poolFloor` | what will you never spend below? | 2 |
| `lowPoolThreshold` | when do you start counting? | 8 |
| `lowPoolCaution` | how much do you care once you do? | 1 |

`poolFloor` defaults to **2 — exactly the number that was hard-coded** —
so `balanced` keeps its measured behaviour at the cliff and the four
rounds of tuning behind `poolCost` and `effectValue` still describe the
policy. `lowPoolThreshold` is the owner's 8.

**`lowPoolCaution: 0` switches the whole gradient off**, so the claim is
falsifiable with `npm run bench -- --weights lowPoolCaution=0` rather than
by editing code — the `huntFutile` precedent. The **cliff is not part of
the gradient** and does not switch off with it: a weight of 0 means "do
not be thrifty", never "oust yourself".

Two derived helpers, and **one** of each, because a price asked in two
places drifts:

- `poolPressure` — 0 at the threshold, 1 at the floor, linear. Linear on
  purpose: the only claim being made is that a point of pool is dearer
  the less of it there is, and a curve would be a second claim nobody has
  measured. Total over silly weights, so a style whose threshold sat
  below its floor cannot get a policy that spends *harder* near death.
- `poolUrgency` = `min(1, pressure × caution)`, and `poolBite` =
  `1 + 2 × urgency`, i.e. ×1 comfortable and ×3 at the floor.

Each site scales the urgency by **its own local price**; none of them
re-derives how pressed the seat is.

## 3. The five sites

1. **`scorePlay` — the cliff, now on the NET spend.**
   `netPool = cost.pool − poolGainOf(effects)`; refuse if
   `pool − netPool <= poolFloor`. A card that pays for itself is not a
   spend, and keeps the ordinary price (`bite` is 1 for it) — the bite
   brakes *spending*, and `effectValue.poolGain` already prices the
   *gain*, which is a different question.
2. **`scorePlay` — the gradient.** `cost.pool × poolCost × bite`. Above
   the threshold `bite` is 1, so this is **arithmetically the line it
   replaced**. Under it, an expensive card loses to a cheap one and, when
   the price outweighs what the card does, loses to `pass` at 0.5.
3. **`scoreInfluence` — a cliff, and deliberately not a gradient.** By
   the §8 law (`richer-options-design.md`): the pool is *identical for
   every candidate* in an influence decision, so a smooth discount cannot
   choose between them, and it cannot beat `pass` either without being
   large enough to stop the bot building a board at all. What a cliff can
   do is **stop the phase**. It refuses a transfer that would take the
   seat to `poolFloor`.
4. **`transferToPool` — the mirror.** At or below the floor, pulling a
   counter back off an uncontrolled vampire becomes worth
   `influenceTransfer` instead of `−influenceTransfer`. Counters in the
   uncontrolled region buy nothing until the vampire arrives, and a seat
   ousted first never gets there. The condition is the **floor rather
   than the gradient, so it is self-limiting**: each counter taken back
   raises the pool, and the moment the pool clears the floor this is the
   worst option on the list again. No unbounded stripping of the region.
5. **`scoreChoice` — the currency fork**, and `payToCancel`. Paying with
   pool lands at `base + (choicePayBloodEmpty − 1) × urgency`: `base`
   exactly when comfortable, and at full urgency **just below**
   `choicePayBloodEmpty`. That is the claim in one line — a pressed seat
   would rather send a vampire out to hunt (p. 21) than pay with its life
   — and it declines an optional frame that only takes pool. `base` stays
   untouched at a comfortable pool because **that fallback is
   load-bearing**: the last time it fell to 0 the AI turned down every
   optional payoff in the game (`ai-answer-choice-design.md`).
   `payToCancel`'s hard-coded "4 pool spare" is now `poolFloor + 2`.

## 4. "Unless it is absolutely necessary" — the two exemptions

Thrift that becomes paralysis is a different way of losing, so two cases
are exempt:

- **A card that pays for itself** (§3.1) — priced as though the pool were
  comfortable.
- **A seat with NOTHING in play** influences at full price. With no
  minion there is no bleed, no block and no hunt, so pool it keeps buys
  nothing; hoarding behind an empty table is a slower way of losing, not
  a way of surviving. `boardless()`.

## 5. Per style — the limit and the temperament

Every style now states all three. That is unusual for this set (most
weights appear in one or two styles) and it is deliberate: "how close to
death will you go for a card" is a question of temperament in a way that
`blockHunt` is not, and a style that left them out would read as *not
caring* rather than as *taking the default*.

| style | floor | threshold | caution | why |
| --- | --- | --- | --- | --- |
| balanced | 2 | 8 | 1.0 | the defaults; the owner's number |
| bruiser | 2 | 6 | 0.5 | in a race; pool held back is tempo it never spends |
| stalker | 2 | 7 | 0.7 | wins on the clock, but its cards are cheap |
| politician | 3 | 10 | 1.2 | a referendum can take four pool off the table in one resolution |
| builder | 3 | 11 | 0.8 | **high threshold, LOW caution** — watch early, charge lightly, keep building |
| turtle | 5 | 14 | 1.8 | the style this is for; the only one that stops influencing to stay alive |

**Builder is why `lowPoolCaution` is a separate weight from the
threshold.** A Builder spends pool by design — it is the style that pays
for permanents — so the two knobs have to be able to disagree: start
counting at 11, then charge yourself only 0.8 for what you spend.

Nothing here touches `selfOustGuard`, and the test asserts every floor is
at least 1 and every threshold above its floor.

## 6. What was measured

- **Strength: no change, and that is the result.** `npm run bench --
  --weights lowPoolCaution=0 --games 200` (160 games, Hecata mirror) puts
  the gradient-off challenger at **0.969 ±0.163** against the default's
  **1.031 ±0.167** — gap **−0.063, inside its own margin of ±0.252**. So
  the layer is not measurably better and, more to the point for this
  project's bar, **not measurably worse**. Ousts were 242 against 238.
  Treat it as the playstyles are treated: a **behaviour** feature with no
  strength claim (`ai-playstyles-design.md` §9.2).
- **The gate.** `npm run typecheck`, `npm test` (292 files, 3015 tests),
  `npx vite build`, `npm run simulate --games 60` (0 draws, 0
  errors) and `npm run simulate:politics --games 40` (0 draws, 0 errors)
  all clean.

### 6.1 The limit worth knowing

**`SearchAgent` still values pool linearly** (`search.ts`, `pool: 3`) and
has no threshold of its own. It inherits the layer only through the
candidate ordering it borrows from `HeuristicAgent.score`. That is
consistent with the search being guarded and not the default, and it is
the obvious follow-up the day it becomes one.

Two other things are honestly untested rather than settled:

- The **influence cliff cannot be isolated by a flag.** `poolFloor` moves
  the play cliff and the influence cliff together, so the bench above
  measures the *gradient* only. Isolating it needs a third knob nobody
  has asked for.
- **Sharpening `influenceProgress` under pressure** — "when poor, finish
  the vampire you started rather than begin another" — *would* be
  argmax-changing between candidates, unlike a flat discount, because
  `remaining` differs per candidate. It is not built: it is a second
  claim, and this change was asked for as a survival fix rather than as
  an influence-ordering one.
