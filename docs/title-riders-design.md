# The title riders — design (wave 93)

Fourteen title-granting political actions the earlier waves had left out, and
none of them for the reason that was written down. Built as two riders on the
existing Praxis Seizure and Crusade factories.

| Cards | Rider | Why it was out |
| --- | --- | --- |
| Praxis Seizure: Washington, D.C. (101472) | **none** — the plain shape | a full stop inside the city name |
| Praxis Seizure: Athens, Barcelona (Tremere), Berlin, Cairo, Geneva (Ventrue), Brussels (Nosferatu), Glasgow (Gangrel), Monaco, Paris (Toreador), Rome (Brujah), Stockholm (Malkavian) | "If the prince is \<clan\>, his or her capacity increases by 1." | the rider was unbuilt |
| Crusade: Berlin (Lasombra), Crusade: Istanbul (Tzimisce) | "If this vampire is \<clan\>, they unlock during your next discard phase." | recorded as naming "a clan the pool does not have" — no longer true |

Printed text read from `data/vtes-raw.json`.

## 1. What the wave found: three recorded reasons, all out of date

**Praxis Seizure: Washington, D.C. had no rider at all.** It is word for word the
plain shape the thirteen implemented Praxis Seizures use. The only visible
difference is that "Washington, D.C." puts a **full stop inside the city name**,
and whatever split the printed text into sentences when the family was sorted read
"C." as a trailing clause. A card excluded by a parsing artefact is invisible to
every check that reads the ledger rather than the text — nothing recorded it as
out, and nothing recorded why.

**The Crusades' exclusion note was a claim about the pool as it was.** The Crusade
factory's comment says the other eleven "each add a clan rider naming a clan or a
vampire the pool does not have — inert by §0". For two of them that stopped being
true when the V5 Sabbat crypt arrived: Berlin names **Lasombra** and Istanbul
**Tzimisce**, both now in the crypt. The CLAUDE.md lesson in its exact form — *a
deferral is a claim about the code, and a recorded deviation a claim about the
pool, as they were*.

**The Praxis riders were never about absent clans.** Every clan the eleven name is
in the V5 crypt (asserted against the real registry, not a list in the test). They
were out because the rider was not built, which is a different reason with a
different expiry: it ends the moment somebody builds one field.

The test that pinned the old state — `expect(inPool.length).toBe(13)`, in
`praxis-seizure.test.ts`, with a comment saying the others "wait for a wave that
builds the rider" — failed the moment this wave admitted them, which is the
*assertion about a total set is a hostage* lesson firing exactly as described. It
now pins the **reason**: the Praxis Seizures still out are exactly the ones whose
rider is unbuilt.

## 2. The capacity rider

`PermanentStatics.capacityBonusIfClan: { clan, amount }` — `capacityBonus` with a
condition on the **bearer's** clan. It is read in `capacityOf`, where the bearer
is in hand, rather than folded when the card enters play, because the card goes on
whichever vampire called the referendum and the factory cannot know who.

Two consequences need no code:

- **"Capacity increases" raises the ceiling only.** The prince gains no blood; it
  can now hold one more. Asserted.
- **A contested title switches the bonus off.** A contested card leaves its zone
  entirely and parks in `seat.contested` (p. 17 "turned face down and out of
  play"), so it is no longer in `attached` and `capacityOf` never sees it. The
  bonus comes back when the contest does.
- **A FULL prince who loses the bonus is not left over capacity.** This looked
  like a gap — nothing in this wave drains blood when capacity drops, and the
  fuzz's invariant reads the *derived* capacity — so it was tested rather than
  claimed. `settle()` already runs `drainOverCapacity()`, written for exactly this
  ("capacity is derived, so it can FALL — a Discipline master card granting +1
  capacity leaves play"). The test pins it: Alice's Tremere prince at 7/7 has her
  title contested by Bob, and exactly 1 blood goes to the bank.

## 3. The Crusade rider

"If this vampire is \<clan\>, they unlock during your next discard phase" is
Feral Hound's shape — remember the bearer as the card enters play, spend the unlock
once in the controller's next discard phase — **lifted out of the retainer
compiler**, where it lived inside `retainerAbilities`, into `addDiscardPhaseUnlock`
on the generic tail every card type passes through. The clan is read at entry,
because that is when "this vampire" is named.

It also settled a question the lessons leave open: `onEnterPlay` **does** fire for
a card a referendum puts in play (`refPutInPlay`). The test would have shown
otherwise; it passed, and a mutation that removes the unlock fails it.

## 4. Deferred, each with its blocker named

- **Praxis Seizure: Istanbul** — "in this referendum, each ready Assamite gets +1
  vote". Assamite is **Banu Haqim** in the registry, so it is live. *Corrected in
  wave 94:* this note understated the blocker — the card also prints "and if this
  vampire is not an Assamite, lock all Assamites", which the rider regex swallowed
  into the title sentence. Both riders were built in wave 94
  (`in-this-referendum-design.md` §4).
- **Praxis Seizure: Venice** — the same two riders for Giovanni, plus the open
  question of whether the V5 **Hecata** answer to "Giovanni".
- **Crusade: Aragon** (Lucita) and **the eight antitribu Crusades** — their riders
  name a vampire and clans the V5 crypt does not have. They were recorded as "inert
  by §0", but that sits awkwardly beside wave 8's ruling on the Path masters — "a
  clause that matches nothing today is fine under §0 because the card does
  everything it prints". The title half of each Crusade works in this pool; only the
  rider cannot fire. **Which reading applies is the owner's call**, and this wave
  did not make it.

## 5. Tests

`tests/cards/title-riders.test.ts` — 21 cases, every one driving the real
referendum to a pass with the caller's own ballot.

Each rider is asserted against its **twin**: the same caller under two cards whose
riders name different clans. A Tremere under Athens gets +1 capacity and under
Berlin gets nothing; a Lasombra under Crusade: Berlin unlocks in the discard phase,
a Tzimisce under it stays locked, and the Tzimisce under Crusade: Istanbul unlocks.
All eleven capacity cities are tabled against a clan that is not their own.

The discard-phase unlock is observed at the **start of Bob's turn**: Alice's
minions do not unlock in Bob's unlock phase, so an unlocked caller there can only
have been unlocked by the rider.

Mutation-checked — removing the unlock (fails the two unlock cases) and removing
the capacity rider (fails every capacity case) — clean on restore.

Fuzz: Athens, Paris, Washington D.C. and both Crusades added. A capacity bonus that
contests away mid-game is what the blood-within-capacity invariant has to survive.

## 6. Counts

Library 848 / crypt 217 / total 1065; supported 947 / 1065.
