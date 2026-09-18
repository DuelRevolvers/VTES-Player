# Discipline-granting equipment

Tranche 3, wave 40. Library **636 → 639**. Three equipment cards whose
first sentence is the same sentence — *"the vampire with this equipment
has superior \<D\>"* — and whose second sentences are three different
things.

| Card | KRCG | Printed |
|---|---:|---|
| Changeling Skin Mask | 100325 | Unique. Superior **Obfuscate**. May **burn it** to get +2 intercept for the current action. |
| Drum of Xipe Totec | 100591 | Unique. Superior **Celerity**. One optional maneuver each combat. |
| Veneficorum Artum Sanguis | 102102 | Unique. Superior **Blood Sorcery**. Any Tremere or Tremere antitribu may enter combat with the bearer as a Ⓓ action. |

## §1 — A grant is not a boost

The engine already had `disciplineBoost` — *"+1 level of Celerity
\[cel\]"*, the Discipline master cards — and it is **not** this. A boost
is a step: none → basic → superior. A vampire with no Celerity boosted by
one step has **basic**, where the Drum says superior outright. Writing
these three as boosts would have been wrong for every vampire who does not
already print the Discipline, which is most of the reason to equip them.

So `PermanentStatics.disciplineGrant` carries the LEVEL:

```ts
disciplineGrant?: { discipline: string; level: DisciplineLevel };
```

`disciplinesOf` applies boosts first, then grants **as a floor** — a
printed or boosted superior is never pushed back down to a granted basic,
and a grant on top of a superior has nowhere to go. It stays derived, so
the Discipline arrives and leaves with the card, which is what the
Changeling Skin Mask test asserts by burning the card and reading the
vampire again.

*"The superior Obfuscate is not optional"* [RTR 19980707] [LSJ 19980722]
— which is why all three are `statics` and none is an ability the bearer
may decline.

## §2 — The card as the price

Changeling Skin Mask's second sentence is `interceptForBlood` with the
**card** where the blood was: burn it, +2 intercept for the current
action. Same p. 26 gate — offered only while the bearer is the minion
attempting the block and their intercept still falls short — but no
Discipline test and no repeat, because there is nothing left to spend.

The burn happens **before** the intercept is emitted. A price paid after
the benefit is a price a later effect can dodge, and the ordering is free
here.

## §3 — What the Drum's ruling says, and what the engine does

*"The minion cannot use the discipline nor the maneuver provided if some
effect prevents him to use the equipment"* [RTR 20010710].

The engine does not honour this, and the reason is older than this wave.
`cf.maneuverCredits` is **summed when the combat frame is pushed**, from
`p.statics.maneuverPerCombat` across the minion's attached cards. The one
card in the pool that sets `restrict.equipment` is **Form of the Bat**,
whose rider is applied in `resolveBlockAttempt` — *after* the push. The
credit is already in the frame by the time the restriction exists, so
nothing can take it back. Biothaumaturgic Experiment has had this gap
since it landed; the Drum inherits it rather than creating it.

The granted **Discipline** has a second reason: `disciplinesOf(m)` takes a
minion and nothing else. It is frame-blind by construction, and it is
called from option enumerators, the pricer and the requirement check —
every one of which would have to learn to pass a combat frame. Neither
half is fixable without making maneuver credits derived rather than
stored, which is the standing *"anything scoped to a live frame is DERIVED
on every read"* lesson pointing at existing state.

**Recorded as a known deviation**, the sibling of the `.44 Magnum` one
already on the list: the equipment-restriction static is enforced at the
weapon-option gate and nowhere else.

## §4 — "Any Tremere" means any Methuselah's

`permanent.rushGrant` with `who.scope: "any"` already means the whole
table, and the actor filter is also the ruling: *"the action provided by
this card is considered to be an action requiring the listed
clan/sect/capacity/title"* [LSJ 20080604].

The one change the card forced is that `who.clan` was a single string.
"Tremere **or Tremere antitribu**" is a union, and Tremere antitribu is
not in the pool today — so the single string would have looked right, read
right, and been narrower than the card the day §7 opens that clan. It now
takes `string | string[]`, matched as a union.

## What the wave found

The sentence *"has superior \<D\>"* had no representation at all. What
made it easy to miss is that a field already existed whose name and type
fit it — `disciplineBoost`, one string, a Discipline code — and which is
wrong by exactly one level for every vampire the cards are played on. That
is the "empty for the wrong reason" shape in a different costume: a card
written with the near-miss field would have compiled, tested green against
any vampire that already printed the Discipline, and quietly done nothing
for the rest.

Second finding, from the Drum's ruling rather than its text: **equipment
statics that become combat credits are read once, when the combat is
pushed**, so an effect that forbids equipment mid-block cannot revoke
them. Pre-existing, now written down (§3).

## What is left

108 equipment cards. The next clusters are equipment that burns itself for
a benefit (Blood Tears of Kephran, Mummy's Tongue), the vehicles
(Helicopter, Learjet), and the Laibon-gated ones that are inert by §0.
**Writ of Acceptance stays out of scope** — a sect change.

## Tests

`tests/cards/discipline-granting-equipment.test.ts`, 6 tests, three of
them negative: the grant is a floor and not a ceiling, the burn is
withheld when the block already succeeds, and the rush is not offered to a
vampire of another clan.
