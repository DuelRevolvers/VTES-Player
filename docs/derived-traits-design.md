# Derived traits: capacity and Disciplines

Status: **design + implementation** (2026-08-29). First wave into the
Master backlog, chosen by surveying the remaining 223 library cards for
the largest shared shape.

## 1. Why this one

The remaining pool's biggest bucket is Master (63). Inside it, the largest
*identical* cluster is the six **Discipline** cards — one printed text, six
names:

> "Discipline. Put this card on a vampire. This vampire gets +1 level of
> \<D\> and +1 capacity. Cannot be put on a vampire with superior \<D\>."

Celerity (100312), Dominate (100572), Obfuscate (101310), Potence (101424),
Protean (101498), Oblivion (102277).

Six cards for one mechanic is a good ratio on its own, but the real reason
to do it now is that it is a **derived-value gate**, and those get more
expensive the longer they wait. `MinionState.capacity` and
`.disciplines` were plain stored fields that nothing ever recomputed —
which quietly contradicts the architecture's own principle that derived
values are never stored (`derived.ts` header). Every new card that reads
either field entrenches that.

Blast radius when measured: 28 reads of `.capacity`, 10 of `.disciplines`,
and several of those legitimately want the *printed* value (deck building,
the UI's card tile). Small enough to fix cleanly today.

## 2. The two functions

```ts
capacityOf(m)     // printed capacity + Σ attached statics.capacityBonus
disciplinesOf(m)  // printed record, with statics.disciplineBoost applied
```

`disciplinesOf` returns the printed record **by identity** when nothing
modifies it, so the overwhelmingly common case allocates nothing. Levels
step none → basic → superior, and superior is the ceiling.

Capacity is three separate things at once (p. 11) — the blood maximum, the
pool needed to gain control, and the older/younger comparison — so all
three call sites had to move: the `BloodGained` clamp, the influence-phase
"counters ≥ capacity" check and the blood a vampire enters play with, plus
every `younger`/`minCapacity`/`maxCapacity` test in the compiler.

**Not** moved: `MinionState.capacity` itself stays the printed value, the
way `MinionState.strength` does. The UI and deck importer read it directly
and should.

## 3. The card shape

One factory, `disciplineCards()`, emits all six. The only new spec field is
`permanent.attach.notSuperiorDiscipline`, which filters the attach targets.

Two details worth recording:

- **No `exclusiveKey`.** A vampire may legally hold two *different*
  Discipline cards, and even two of the *same* one (none → basic →
  superior). The superior gate is what stops a third, and it falls out of
  `disciplinesOf` for free.
- **Reading on record:** the text says "a vampire", not "a vampire you
  control". Scoped to `own`, because handing an opponent's vampire a
  Discipline level and a capacity point is not a play anyone makes, and
  scoping it that way keeps a future AI from generating one.

## 4. What the fuzz caught (twice)

The blood invariant is `0 ≤ blood ≤ capacity`. Capacity becoming derived
breaks that in two places, and the fuzz found **both**:

1. The end-of-game conservation check snapshots capacities at setup — fixed
   to take the live derived value.
2. The **per-step** check still read `m.capacity`. Missed on the first
   pass; seeds 5 and 9 failed with "blood 5 outside [0, 4]" on a vampire
   legitimately holding a Discipline card.

Worth stating plainly: this was my incomplete fix, not a pre-existing bug,
and the fuzz is what caught it. It is the counterpart to the lesson from
the last wave — the fuzz cannot see a *too-permissive option list*, but it
is very good at a *violated numeric invariant*.

## 5. Capacity can now FALL — a new class of event

Nothing had ever reduced a vampire's capacity before. If a Discipline card
leaves play, capacity drops and the vampire may sit above it.

`settle()` now runs `drainOverCapacity()` beside `burnDepleted()`: any
vampire above its derived capacity burns the excess. The rulebook covers
the other direction explicitly — "a vampire cannot have more blood than
their capacity; if an effect puts more blood on them than their capacity
allows, the excess is always moved to the blood bank immediately" (p. 11) —
and says nothing about capacity falling. Read as: **the invariant holds
whenever it becomes false, whichever side moved.** Recorded as a reading.

It immediately found two **test fixtures building an impossible vampire**
(`blood: 4, capacity: 3` in the diablerie tests). Those are now legal, with
the assertion's intent preserved.

## 6. Count

Library cards supported: **221 → 227 of 444 (51.1%)** — past half. Crypt
0/217 (phase 7). Total 227/661 (34.3%). Masters remaining: 57.

## 7. What this unlocks next

The survey turned up two more Master clusters that are now mostly data:

- **Lock-to-grant locations** — Channel 10, KRCG News Radio, Kumpania, The
  Anarch Free Press, The Black Throne. `permanent.lockGrant` already does
  stealth/intercept/votes; these need small filters (`minCapacity`, a
  first-action-of-the-phase restriction) and, for two of them, a second
  ability on the same card.
- **Archetypes** — Dabbler, Monster, Perfectionist, Rebel, and the two
  Saulot cards. `permanent.exclusiveKey` already models "a vampire can have
  only one archetype"; each needs its own once-per-turn trigger.
