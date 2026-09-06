# Stun

*Kiss of Cathari (102330), Mind Numb (101211).*

## 1. The ruling

The word **stun** appears nowhere in the V5 rulebook (full-text searched)
and is defined by no card in the pool — those two cards are the only ones
that use it, and neither explains it. Both were left unsupported rather
than guessed at.

**Owner ruling, 2026-08-31, quoted verbatim:**

> Stun: lock a minion and put a stun counter on them. A minion with one or
> more stun counters does not unlock as normal at the beginning of their
> controller's unlock phase; during that unlock phase, burn all stun
> counters they had at the beginning of the turn.

Everything below implements exactly that. Where the ruling is silent, the
note says so.

## 2. Two clauses, and why the second one is not redundant

The ruling has a snapshot in it that is easy to miss:

1. **≥ 1 stun counter ⇒ does not unlock.** The count does not extend the
   effect — two counters still cost one unlock phase, because clause 2
   burns *all* of them at once.
2. **Burn the counters held at the beginning of the turn.** The unlock
   phase is the first phase of the turn (p. 7), so "at the beginning of
   the turn" is the count as the unlock phase opens. That matters because
   cards act *during* an unlock phase — "during any Methuselah's unlock
   phase" (Homunculus) is a real window. A stun applied inside that window,
   after the snapshot, survives to the next turn instead of being burned
   the instant it lands.

So the implementation is: snapshot at the top of the sweep, suppress the
unlock on a non-zero snapshot, burn the snapshot. Not "burn whatever is
there when we get to it".

## 3. Where it lives: `counters["stun"]`, not `skipNextUnlock`

`MinionState.skipNextUnlock` already means "does not unlock as normal,
once" (Toreador Grand Ball, On the Qui Vive). It is a **boolean**, and the
ruling says *counters*, plural and stackable. `MinionState.counters` —
named counters belonging to nobody, built for "hostage" and "nightmare"
(docs/bespoke-economies-design.md) — is the literal shape, so stun is
`counters["stun"]` with `ops.addMinionCounters(minion, "stun", ±n)` and
the existing `MinionCountersChanged` event.

The two co-exist in the unlock sweep: `skipNextUnlock` is spent whether or
not it did anything, stun is burned from its own snapshot, and either
suppresses the unlock.

**Interaction that falls out for free, and is right:** a counter sink
("burn a counter from this card *instead of unlocking as normal*", Touch
of Oblivion) is only spent `if (m.locked && !suppressed)`. A stunned
minion was never going to unlock, so it wastes no counter — the same
guard that already protected an unlocked minion.

## 4. `EngineOps.stun(minion)`

Locks the minion (if not already locked) and adds one counter. One op,
called from both cards, so the two halves of the ruling cannot drift
apart.

`derived.ts` gets `stunned(m)`, the sibling of `heldHostage(m)`.

**Nothing else needed to gate a stunned minion.** It is locked, and
`canAct` / `canReact` already exclude a locked minion (a wake still lets
it react, which is correct — the ruling restricts *unlocking*, not
reacting).

## 5. Kiss of Cathari (102330) — `[obf] or [pre]`, 1 blood

> `[obf] or [pre]` Strike: combat ends.
> `[OBF] or [PRE]` As above, and after combat ends, if the range is close,
> stun the opposing minion.

Structurally identical to **Catatonic Fear**, which is "strike: combat
ends" plus an after-combat rider conditioned on close range. So this is
one new variant on `CombatFrame.afterCombatEnds` —
`{ kind: "stun"; minion }` — applied where the others are, **after the
frame pops** (docs/after-combat-ends-design.md §2), with `closeRangeOnly`
read off the captured frame, i.e. the range *as combat ended*.

The mode's discipline is `["obf", "pre"]` — the existing "any one of"
shape, not `{ all: [...] }`.

## 6. Mind Numb (101211) — `[pre]`, 1 blood

> `[pre]` Ⓓ Stun an unlocked vampire.
> `[PRE]` As above, and this is a +1 stealth action.

A directed action card that names a minion. `CardActionParams.targetMinion`
already derives directedness from the target's controller (p. 25), so
that half is free.

**One kernel hole had to be closed.** A successful `cardEffect` action
with a `targetMinion` enters combat with it — that gate exists for rushes,
and it was written as "granted actions can opt out, cards from hand cannot":

```ts
const rushLike = af.grantedEffect === null || af.grantedEffect.key === "enterCombat";
```

`af.grantedEffect` is null for every card played from hand, so Mind Numb
would have rushed its victim. Cave of Apples had already needed exactly
this ("a granted Ⓓ action that targets a minion *without* entering
combat") and got it through the granted-action branch; the hand-played
branch had no equivalent. **`ActionFrame.noCombatOnSuccess`** is that
equivalent — optional, set from `CardActionParams.noCombat`, so every
existing rush card is untouched.

### Reading on record: a vampire cannot stun itself

The card says "an unlocked vampire" and does not say "another". The actor
is nonetheless excluded from its own target list, because **the acting
minion locks at announcement (p. 25)**: by the time the effect resolves
the actor is not an unlocked vampire, so it can never satisfy the card's
own condition. This also matches every other minion-targeting primitive
in the compiler, each of which excludes the actor unless the card says
otherwise.

Targets are drawn from **every** Methuselah (a Ⓓ action, so directed at
the target's controller), skipping a minion protected by
`untargetableByOthers` (Secure Haven).

## 7. Rulebook citations

- p. 7 — turn structure: unlock is the first phase, so "the beginning of
  the turn" is when the unlock sweep runs.
- p. 17 — "unlock all of your cards" is the unlock phase's own effect,
  which is what stun suppresses.
- p. 25 — the acting minion locks at announcement; an action's target is
  fixed at announcement.
- p. 27 — a directed action may only be blocked by the Methuselah it is
  directed at.
