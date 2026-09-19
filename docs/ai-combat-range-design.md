# Combat — the AI has never read the range (2026-09-18)

**Status: designed, not built. Owner review before kernel code.**

Depends on nothing. Measured in `ai-decision-profile-2026-09-18.md`.

## 1. The defect, and how it was found

```
grep -n "\.range\|\.round\|combat\.step" src/ai/heuristic.ts src/ai/search.ts
(no output)
```

**Neither agent has ever read the range, the round, or the combat step.**
`view.combat` carries all three, and the doc comment on it says why they
are there:

> a seat asked to choose a strike, press, or spend a prevention credit
> was given nothing at all — not who it was fighting, not their blood,
> **not the range**, not the round.

The `who` and the `blood` halves were consumed when `view.combat` landed
(`scoreStrike` reads `c.acting`, `c.opposing`, `c.opponent`). The
**range** and **round** halves were projected and then never read. The
field is a measurement of intent that was not finished.

## 2. What it costs

`scoreStrike` in `src/ai/heuristic.ts`:

```ts
case "hand":
  return w.strikeDamage + (lethal ? w.strikeLethal : 0);
```

`strikeDamage` regardless of range. At **long range** a hand strike
cannot reach the opponent (p. 29, and the whole point of the range
mechanic), so this is the policy's highest-scoring combat option being,
in that position, nothing at all. `lethal` is computed from
`power(mine) >= foe.blood` with no reachability test, so the bot can
score a strike as the killing blow that will not land.

Worse, the option that fixes it is priced as filler:

```ts
case "useManeuver":
case "preventCredit":
case "burnForIntercept":
case "burnForUnlock":
  // Credits already paid for: spending them is free value.
  return w.playCard;
```

A **maneuver is how you change the range** (p. 29) and is scored
identically to burning a blood for intercept. `useManeuver` is 0.1% of
real choices in the profile — 4 decisions in 20 games — and that is
itself a symptom: the playtest decks are light on ranged weapons, so the
fixture rarely produces the position. See §5.

`usePress` and the round: "one each round" limits and the p. 31 mending
rules make round number load-bearing, and `scorePress` never consults
`c.round`.

## 3. The design

**(a) Reachability gates the strike, it does not merely discount it.**

```
reachable(strike, range) =
  range === "close"  -> true
  range === "long"   -> the strike has reach (a ranged weapon strike)
```

A `hand` strike at long range scores at or below the defensive options,
and `lethal` is only awarded on a strike that can actually land. This is
the same shape as `wouldSucceed` on `declareBlock`: **an option that
cannot do the thing must not be scored as if it does** — the lesson that
"NEVER attempt a block that cannot succeed" was written for.

The engine already knows which strikes reach; `richer-options-design.md`
§1's argument applies unchanged — it computed that to build the option, so
the option should say. **A `reach` or `rangeRequired` field on
`chooseStrike` is preferable to the AI re-deriving it from weapon text**,
which would be a second model of the pool.

**(b) A maneuver is priced by what it would ENABLE.** Not flat. If my
best strike is unreachable at the current range and a maneuver would make
it reachable, that maneuver is worth roughly what the strike is worth. If
the range already suits me, a maneuver is worth near zero — and if I am
the one who wants the range kept, it is worth less than zero.

This is a **structurally sound term** by the `richer-options-design.md`
§8 test: it varies across the option list, because the maneuver and the
strike are different options in the same list and the maneuver's value is
computed from the strike's.

**(c) Round awareness in press.** `scorePress` currently compares blood
and power. Round matters because a combat that keeps going is a combat in
which the opponent gets more strikes too, and because per-round effects
have already been spent. **Recommended as the weakest of the three and
measured separately** — it is the one most likely to be a §8 casualty,
since the round is the same for every press option in the decision. State
that expectation up front so a zero reads as a finding.

## 4. The order to build it in

(a), then (b), then (c) — and **measure after each**, not at the end.
(a) is a correctness fix and should be defensible on a trace test alone.
(b) is the one with a real chance of showing up in the bench. (c) is a
coin flip and the §8 law says so in advance.

## 5. THE MEASUREMENT PROBLEM, which is the same one politics has

4 `useManeuver` decisions in 20 games. That is not evidence that
maneuvering is rare in VTES; it is evidence that **the playtest decks
barely contain ranged combat**. A range-awareness fix measured on this
table will read as a dead heat for the same reason the politics work
would — the fixture cannot produce the position.

`ai-politics-bench-design.md` proposes politics decks. The same argument
applies here and the same doc should carry a **gun deck**: a seat whose
combat is ranged, so that long range actually happens. Two fixtures, one
piece of work.

The cheap probe that tells you whether it is worth it: count, over 20
games, how many `chooseStrike` decisions occur at long range with a hand
strike among the options. If that number is near zero on the current
decks, the fix is still correct and is simply unmeasurable here — which
is a legitimate thing to ship on a trace test, and should be said plainly
in the wave report rather than dressed up as a win.

## 5.1 BUILT, 2026-09-18 (platform 0.10.72) — and §5 WAS WRONG

This doc predicted the fix would be unmeasurable on the current decks.
**It is not, by a wide margin:**

| table | strike decisions | at LONG range | hand strike offered there |
| --- | --- | --- | --- |
| default | 388 | **61 (16%)** | 61 of 61 |
| politics | 414 | **37 (9%)** | 37 of 37 |

**One strike decision in six happens at long range on the default
table**, and the bare hand strike — which resolves to nothing there — was
offered in every single one, scoring `strikeDamage` plus the full
`strikeLethal` bonus. The estimate in §5 was drawn from the maneuver
count (4 in 20 games) and generalised from it to the whole mechanic,
which was the wrong inference: **maneuvers are rare because CREDITS are
rare, and long range is common because cards put you there.**

After the change the bot takes a hand strike at long range 29 times of 61,
and those are the lists where it is the ONLY strike offered — deducible
rather than measured, because every alternative outscores the penalty
(`dodge` 0, `combatEnds` 1, against `strikeUnreachable` −2). **So the
policy now declines a futile hand strike whenever it has any alternative
at all**, which is roughly 32 flipped decisions in 20 games.

### No engine change was needed

§7 asked whether `reach` should go on the `chooseStrike` option or be
derived. Neither, as it turned out: **a weapon's strike arrives as a
`useAbility` option, never as a `chooseStrike`**, so every
`chooseStrike` with `strike: "hand"` really is the bare hand strike. The
range is already on `view.combat`, and "a hand strike does not reach at
long range" is a rulebook fact (p. 29), not card data — so reading it in
the policy is not a second model of the pool. **§7 is closed without
touching the engine.**

The gap this leaves, stated plainly: a weapon strike offered as an
ability is still scored at the flat `playCard`, so the policy prefers a
gun at long range only because the hand strike is now penalised, not
because it knows the gun is ranged.

### 5.2 BOTH GAPS CLOSED, 2026-09-19 (platform 0.10.79)

**The weapon now says it reaches.** `weaponProfile` — the existing
summary of what a weapon does — gained `ranged`, and the engine stamps
`strikeReaches` onto the strike abilities that have it, centrally where
the choose-strike decision is raised, so no card has to remember. The
policy scores a reaching strike at `strikeRangedAtLong` rather than at
the generic `playCard`: **a positive reason to take the gun, instead of
the leftover after the hand strike was penalised.**

A gap found while doing it: **`.44 Magnum` declared no `weaponProfile`
at all**, being hand-rolled rather than spec-compiled. The flagship gun
was the one weapon in the pool that could not tell an agent it reaches.
It now declares one like every other weapon.

**Maneuvering is now about which range suits YOU.** The old rule assumed
every minion wants close range, because the policy could not see what it
was holding. The engine now stamps `rangedStrikeAvailable` on the
maneuver option, and the rule reads:

| holding | at long | at close |
| --- | --- | --- |
| no reach | **close the range** — our strike does nothing where we stand | stay |
| a ranged strike | stay | **open the range** — ours still works, their hands do not |

Opening is priced below closing on purpose: closing RESCUES a strike
that would otherwise do nothing, while opening only DENIES the opponent
theirs — and this policy cannot see whether they are armed too, in which
case opening buys nothing.

**Still unmeasured in real games**, for the reason §5.1 gives: maneuver
credits are rare, and 0 occurred at long range in 40 games. Both rules
ship on trace tests.

### Maneuvering, and what it is priced as now

`useManeuver` was scored at a flat `playCard` beside "burn a blood for
intercept". It is now `maneuverToClose` at long range and **below `pass`**
at close range — opening the range is a real cost to a minion whose
strike is its hands, and "spend the credit because it is there" is how a
bot maneuvers itself out of its own combat.

**Unmeasurable half:** 0 maneuver decisions occurred at long range in 40
games, so the closing rule ships on trace tests alone. The 8 that
occurred at close range will now be declined.

### §3(c), round awareness: NOT BUILT, and that is the finding

The §8 law settles it without an experiment. `scorePress` chooses between
`press:continue` and `press:end`, and **the round number is the same for
both** — a term reading only `cf.round` cannot vary across that list and
therefore cannot change the argmax. Building it would add a provably
inert weight, and this project deletes those rather than shipping them at
zero (the `blockPressure` precedent).

If round-awareness is wanted it has to enter through something that DOES
vary per option, which means a different design rather than a weight.

## 6. Tests

- **The headline:** a combat at long range, bot holds no ranged weapon;
  assert it does NOT choose `strike:hand` when a dodge or a maneuver is
  offered. Then the same fixture at close range; assert it DOES.
- **Lethality must not be claimed through an unreachable strike:** foe at
  1 blood, long range, hand strike. The old code scores this at
  `strikeDamage + strikeLethal` — the highest number in the function. New
  code must not.
- **Maneuver valuation:** a fixture where closing the range makes a
  lethal strike available; assert the maneuver is taken. And the negative
  control — a fixture where the bot's own strike is ranged and the
  opponent's is not; assert it does NOT close.
- **Negative space:** `view.combat` absent (a strike chosen outside a
  combat frame should be impossible; assert the scorer does not throw if
  it happens). Anything scoped to a live frame is derived on every read —
  a combat ends four different ways and a cached range would survive one.
- The fuzz stays green, and the ten standing seeds are a regression guard
  rather than a search.

## 7. Open question for the owner

**Should `reach` live on the `chooseStrike` option, or should the AI ask
a helper?** The doc recommends the option, on the `richer-options` §1
precedent. The counter-argument is that it adds a field to a core engine
type for one consumer — but `declareBlock.wouldSucceed`, `takeAction.bleed`
and `answerChoice.card` are all exactly that, and each has since paid for
itself. The precedent is consistent enough that breaking it needs a
reason.
