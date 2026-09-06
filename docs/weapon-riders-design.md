# What a weapon does besides hit

*AK-47 (100032), Sniper Rifle (101816), Righteous Blade (102359), Sword
of the Archangel (102261), Treasured Samadji (102015).*

**Equipment has never had a per-card wave.** `docs/weapons-design.md`
built the gate — `spec.weapon` compiles to an ability in
`combat.chooseStrike` calling `ops.chooseWeaponStrike` — and then the
family was left alone. That block has five fields (`damage`, `handBonus`,
`ranged`, `aggravated`, `maneuverPerCombat`), and **every one of the five
weapons left in the pool adds exactly one thing it cannot say.** That is
the wave: not a new mechanism, a vocabulary that stopped one card short.

| Card | What `spec.weapon` cannot say |
|---|---|
| **AK-47** | "After the bearer strikes with this gun, 1 optional additional strike (limited), **only usable to strike with this gun**, this round." |
| **Sniper Rifle** | "2R damage, **only usable at long range**" — plus a blocker's rider that sets the range and commits the strike. |
| **Righteous Blade** | "1 optional press, **only usable to continue combat**, each combat." |
| **Sword of the Archangel** | a **keyword-filtered** cancel, and a conditional unlock after combat. |
| **Treasured Samadji** | it is **not a weapon at all** — equipment that grants a once-per-combat **dodge**. |

## 1. Granted strikes, generalised

Treasured Samadji's "once each combat, this Ravnos can strike: dodge" is
the second card in two waves to want **a specified strike offered in the
`chooseStrike` step**; Voracious Vermin's burn-weapon strike was the
first, and it got a bespoke `CombatFrame.grantedBurnEquipment`.

Two is the point at which a field becomes a list, so that becomes
**`CombatFrame.grantedStrikes?: { acting: StrikeKind[]; opposing: StrikeKind[] }`**,
and `StrikeKind` gains `"dodge"`. A granted strike is spent when taken —
`splice`, not a boolean — which is what "once each combat" and "one
additional strike" both mean.

**`grantedCombatEnds` is deliberately NOT folded in.** It is read at four
sites with two conditions attached (`cf.round === 1`,
`noCombatEndsFirstRound`), so merging it would move real logic for no
gain; it is a boolean because it means one specific thing. Recorded so
the next person does not mistake the inconsistency for an oversight.

## 2. "Only usable to strike with this gun" — the .44 ruling, reused

AK-47's rider is an additional strike **restricted to one weapon**, and
the engine has held exactly that restriction since the .44 Magnum
maneuver ruling: `CombatFrame.committedStrike[side]` names the card whose
strike the side is locked into, and the weapon ability already refuses to
offer any other weapon's strike while it is set.

So the rider is two existing ops in sequence: grant the additional strike
(`grantAdditionalStrike`, `limited: true`) and set `committedStrike` to
this weapon. **The hand strike still needs barring** — `committedStrike`
gates the built-in `strike:hand` at the same site, which it already did.
`weapon.additionalStrikeSelf` is the flag; it fires **when this weapon's
strike is chosen**, which is where `chooseWeaponStrike` already runs.

**Reading on record: the extra strike is offered even if the gun cannot
usefully fire again.** The card says "they get 1 optional additional
strike", with no condition; whether the second shot is worth taking is
the player's problem, and `limited: true` already stops a second source
stacking (one limited additional strike per round, p. 32).

## 3. `weapon.onlyAtLongRange`

Sniper Rifle's strike is offered only while `cf.range === "long"`. One
line in the weapon ability, and it is a gate on **options** — the
`noPreventBy` precedent — so a close-range round simply does not list it
and the bearer takes a hand strike like anyone else.

Its second clause is a **blocker's** rider: "If the bearer blocks, they
can, before range is determined, set the range for the first round of the
resulting combat to long, and their initial strike that round must be
with this weapon." Three conditions, all already recorded on the frame:
`cf.fromBlock` (built for the unlock-and-block cluster), `cf.round === 1`,
and the bearer being the blocking side. Taking it sets the range and
**commits the strike** — the same `committedStrike` as §2, which is what
"their initial strike that round must be with this weapon" says.

**It is an option, not an effect** ("they **can**"), and it is offered in
`combat.beforeRange`, which is where the frame's range is still open.

## 4. `weapon.pressPerCombat` — a credit with a restriction

`PermanentStatics.pressPerCombat` grants credits spendable **either way**:
`press:continue` to keep fighting, or `press:end` to cancel a standing
press (p. 32). Righteous Blade's is "only usable to continue combat".

**`CombatFrame.pressesContinueOnly[side]`** is a third pool beside
`presses` and `pressesCombat`, offered only for `press:continue` and
**spent first**, because it is the use-it-or-lose-it one. That is exactly
the rule `closeManeuvers` established in the play-from-hand wave — a
restricted credit is spent ahead of a general one, so the player is never
left holding the narrow credit and having spent the wide one.

## 5. Card keywords, and a filter that correctly matches nothing

Sword of the Archangel: "Once each combat, this Salubri can burn 1 blood
to cancel **a grapple or aim card** as it is played by the opposing
minion, and its cost is not paid."

The cancel machinery is the Vozhd of Gravesend's, verbatim:
`abilityInAsPlayed` (p. 7 otherwise reserves that window),
`ops.cancelPendingCard(true)` ("its cost is not paid" is the Sudden
Reversal wording, which refunds), and the question about the pending card
answered by a **central query denormalized onto the frame** rather than by
reading another card's spec.

What is new is the question. "Grapple" and "aim" are **printed
keywords** — a line above the card text, like "Unique." or "Frenzy." —
not card types and not Disciplines. `CardSpec.keywords` →
`CardHandler.cardKeywords` → **`CardPlayFrame.keywords`**, the same
treatment `isMaster` / `isCombat` / `isStrike` get.

**The V5 pool contains exactly two keyword cards and BOTH ARE
UNSUPPORTED**: Immortal Grapple (100959, "Grapple.") and Target Vitals
(101942, "Aim."). So this filter is written, correct, and **enumerates
nothing today** — the Wall Street Night / Black Forest Base precedent,
and it gets a test asserting the negative so that "nothing offered" is
pinned to the right reason. When those two cards land, the Sword works
with no further change; they are named in `partial-support.md` so nobody
has to re-derive that.

## 6. The Sword's second clause, and why it needs a flag

"Once each turn, if the opposing vampire is burned **during this weapon's
strike resolution** and the bearer remains ready, the bearer can unlock
at the end of combat."

Three things have to be true at three different moments, so the frame
carries the middle one. `CombatFrame.afterCombatEnds` (built in the
after-combat-ends wave, applied **after the pop** so a rider may raise a
choice) holds the payout; what it cannot see by itself is *how* the
victim died. **`CombatFrame.burnedByStrike?: CardInstanceId[]`** records
the weapon whose strike resolution burned a combatant, written at
`resolveCombatDamage` — the single chokepoint the round-recurring wave
established for damage actually inflicted, as opposed to damage queued.

"The bearer remains ready" is read **when the rider fires**, not when the
flag is set, because the bearer can die later in the same combat. "Once
each turn" is `PermanentInPlay.usedThisTurn`, cleared on `TurnBegan`
beside `grantedActionUses` (the archetypes wave).

**Reading on record: "burned" is burned, not sent to torpor.** The card
says burned, `notifyLeaveReady` already distinguishes
`"burned" | "torpor" | "removed"`, and an aggravated strike that fills a
vampire's wounds burns them outright (p. 34) — which is exactly what this
weapon does, so the clause is reachable rather than decorative.

## 7. Treasured Samadji is equipment that is not a weapon

"This Ravnos gets +1 bleed. Once each combat, this Ravnos can strike:
dodge." No damage, no `spec.weapon` block: a `statics.bleed` and a
granted dodge (§1), gated on `usedThisCombat`. It is in the wave because
it is the card that turned `grantedBurnEquipment` into `grantedStrikes` —
the second user is what justifies the shape.
