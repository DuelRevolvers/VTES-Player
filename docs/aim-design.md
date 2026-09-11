# Aim — and the clause that has to wait for the damage

*Target Hand (101938), Target Head (101939), Target Leg (101940), joined
to Target Vitals (101942), which was already in the pool.*

Wave 17, landed **v0.10.0**. Library **550 → 553**.

Four cards, one trigger. Every aim card is written the same way:

> **"If any damage from this strike is successfully inflicted on the
> opposing minion, …"**

and then each one does something completely different with it. That is
the wave: not four payloads, but the one moment they all wait for — which
the engine did not have, and which the card already in the pool was not
waiting for.

## 1. The card the wave found

`Target Vitals` shipped in the weapon-riders wave and passed its tests. It
prints:

> If any damage from this strike is successfully inflicted on the opposing
> minion, they take +2 damage from this strike, **and they cannot press
> this round**.

`addAimBonus` applied the press bar **at play time**:

```ts
cf.restrict[side === "acting" ? "opposing" : "acting"].press = true;
```

The `if` governs both clauses, and [RTR 19960221] is explicit about what
follows: an aim "can be played on a strike that does no damage, **even a
dodge or a combat ends**, but has no effect in that case". So a Target
Vitals played on a strike the opponent dodged was still stopping them
pressing — a wrong card, every time, in the only situation where playing
it was a mistake worth punishing.

The damage half was already correct: it rides an item that has `amount >
0` at the chokepoint, which is what "successfully inflicted" means. Only
the consequence was applied early. **One card, one clause, two different
timings — which is what the shape of a rider is for.**

## 2. `AimRider` — the payload, held

`CombatFrame.aimRiders: { acting: AimRider[]; opposing: AimRider[] }`,
keyed by the side that PLAYED the aim, fired at the damage chokepoint the
first time that side's strike puts damage on the other combatant, and
**spent as it fires**.

Spent, not merely marked: a strike can put two packets on a victim (an
ammo card's separate aggravated packet, `ammo-design.md` §5), and a rider
that is not consumed pays the card twice.

The gate is `pd.minion === struck`, not simply "some damage happened".
The card says "on the opposing minion" — a strike that lands on a retainer
or on a bystander is not what it is waiting for.

Round-scoped, and cleared beside `aimsThisStrike` at the round boundary:
an aim rides ONE strike. `moveDisciplines` is the deliberate exception —
Target Leg says "this **action**" — and is left alone there, which the
comment at the boundary says in as many words so the next person does not
"fix" it.

## 3. Two damage bonuses that are not the same bonus

| Card | Printed as | Where it is added | Prevention |
|---|---|---|---|
| **Target Vitals** | "if any damage … is successfully inflicted, they take **+2 from this strike**" | the damage chokepoint | already survived it |
| **Target Head** | "**the strike does +2 damage**" | inside `inflict`, beside the ammo bonus | eats it like any damage |

These read alike and behave differently, and the difference is worth a
field. Against a strike of 1 damage and 1 point of prevention: Target
Vitals inflicts nothing at all (the base was prevented, so the "if" never
fires); Target Head inflicts 2. Folding Target Head's bonus into
`aimBonus` would have made it **unpreventable**, which is the more
dangerous of the two mistakes and the one that would never have shown up
in a test that only counted damage.

Hence `aimStrikeBonus` beside `aimRiders`, and `spec.aimRider` carrying
both `strikeDamage` and `damage`. [RTR 19960221] — "adding damage to a
strike that does not deal damage has no effect" — is free either way: the
`amount > 0` gate below the addition already is that rule.

## 4. The two questions a rider asks

Target Head's "you may **set the range** for the next round" and Target
Hand's "you may **destroy a weapon** he or she has" are options, and they
are raised as **engine-owned choice keys** — the `handSizeDown` /
`diablerieDiscipline` / `contest` precedent. The reason is the one
recorded there: the question is raised long after the card has finished
resolving, from a chokepoint the card cannot see, and writing the answer
onto each aim card would be one question answered in three places.

`raiseChoice` from combat damage resolution pushes a frame **immediately**
— `deferChoices` is set only while an ACTION resolves — so the weapon is
gone before the round can offer another strike with it.

### The range question is asked at the round boundary, not when it fires

It cannot be asked when the rider fires. Damage resolution comes **before
the press step**, so at that moment nobody knows whether there is a next
round to set a range for. `pendingSetRange` records that it was earned;
the question is asked at the boundary, where `willContinue` is settled and
a next round is known to exist.

Answering it sets `cf.range` and moves the step from `beforeRange`
straight to `beforeStrikes`, which is [RTR 19970630] exactly: "skip the
Determine Range step for that round" — and with the step skipped, "no
other effect can be used to reset the range that round" falls out, because
that step is where such an effect would be played.

[PIB 20120214] — "if another effect was already setting that round's
range, that effect has priority" — is the guard beside it: the question is
not asked when the step is already skipped, which is what Immortal
Grapple's `skipRangeNextRound` leaves behind.

## 5. Gates on options, not just on state

Two of the payloads are restrictions, and a restriction that only stops
the effect while still offering the option is a bug the fuzz cannot see.

**Target Head, "cannot use any additional strikes or presses this round".**
[LSJ 20011214-5] is unusually specific: the barred minion "cannot play a
card that provides an additional strike, **even if just to benefit from
another effect**". So `noAdditionalStrikes` gates both ends — the grant
ops refuse, and the `chooseStrike` enumerator drops any mode carrying an
`additionalStrike` effect. A strike already granted earlier in the round
is taken away too: the card says they cannot USE one.

**Target Leg, "may use maneuvers or presses only if they require Obfuscate,
Blood Sorcery or Flight this action".** `moveDisciplines` holds the
allowed abbreviations, and the filter runs in two places for two reasons:

- **Credits are barred outright** — a rush rider's maneuver, a weapon's,
  a press credit from a card in play. None of them requires a Discipline,
  so none survives the card's "only if". That takes the built-in
  `maneuver:credit` / `press:continue` / `press:end` options **and the
  whole of `abilityOptionsFor`** for those two windows.
- **Card plays are filtered by the mode's own Discipline**, in the
  compiler, which is the only place that can see it.

`modeRequiresOneOf` takes one deliberate reading: a mode listing several
Disciplines as alternatives ("[cel] or [pre]") qualifies only if **every**
alternative is allowed, because the player picks which one to satisfy it
with, and an option that can be satisfied by a Discipline the card does
not name is an option the card does not permit. `{ all: [...] }` — a mode
requiring several at once — qualifies if any one of them is named, since
the card asks whether the maneuver requires Obfuscate, not whether that is
all it requires.

**"flight" is in the list and matches nothing today.** Flight is not
modelled anywhere in the pool. That is the Wall Street Night precedent and
it is correct to name it: the card names it, and the day a FLIGHT card
lands the filter works with no further change.

## 6. Tests

`tests/cards/aim.test.ts`, 8 tests. The wave's whole content is a timing,
so the strike that LANDS and the strike that does NOT are asserted against
each other:

- the rider is queued when the card resolves and the press bar is **still
  false** — the assertion that would have failed before this wave;
- **a strike that inflicts nothing fires no rider** (strength 0, so
  `inflict` queues nothing — no dodge card needed), and the press bar
  never appears;
- Target Hand's −1 strength, and its weapon question, which burns the
  named weapon;
- **no weapon question at all when the victim carries none** — a "may"
  that is never asked, pinned so the absence has a reason;
- Target Head's +2 as strike damage, and its additional-strike bar plus
  the earned range question;
- Target Leg's filter removing a press credit, with a **control** proving
  the same fixture offers that credit without the card.

One existing test moved, and it moved for the right reason:
`weapon-riders.test.ts` pins exactly which cards the Sword of the
Archangel's keyword filter enumerates, and the aim family went from one
card to four.

Fuzz: all three dealt in. Green.

## 7. Not done

- **Target Retainer (101941)** — "you can target a **retainer** on the
  opposing minion with this strike (instead of the opposing minion)". Its
  other half is an ordinary `aimRider` with `damage: 1`, but retargeting a
  strike at a permanent is a different mechanic: retainers are not
  minions, so nothing in the damage path can address one today.
  [ANK 20200311] adds that a cancelled Target Retainer resolves the strike
  with the **default** target, which is a rule about a target that was
  never chosen. Deferred deliberately, not blocked — it belongs with
  whatever wave first makes a strike address a permanent.
- Target Hand's "-1 strength **this action**" is applied to the combat
  frame, which is the whole of that action in every case the engine can
  currently produce. A second combat inside one action would not carry it;
  no card in the pool does that.
