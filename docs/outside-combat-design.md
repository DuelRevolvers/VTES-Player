# Acting on a combat you are not in

Status: **design + implementation** (2026-08-30). Queue item 1, opened by
the abstain gate's deferral of Saulot's Guiding Wisdom.

## 1. The rule, and why it needed a kernel change

The rulebook is explicit that combat is not a closed room (p. 28, Advanced
Rules):

> Some combat cards are played by minions "**not involved in the current
> combat**". Minions controlled by **ANY** Methuselah can play those cards.

Three of the combat windows already honour that without knowing it:
`beforeRange`, `beforeStrikes` and `endOfRound` each ask
`cycleSeat(cf.cycle)`, and `cf.cycle` spans **every** seat
(`sequencingOrder(state, actingSeat, [opposingSeat])`). A card in one of
those windows played by a third party would already have been offered.

**`damageResolution` was the exception, and it is where these cards live.**
It asked exactly one seat:

```ts
const seat = getMinion(this.state, pd.minion).controller;
return this.dp(seat, "combat.damageResolution", […]);
```

One pass from that seat resolved the damage. A third party never got an
impulse, so "prevent 1 damage to a minion in combat" was unplayable by
anybody outside it.

## 2. `CombatFrame.damageCycle`

The step becomes an impulse cycle like every other window: a cycle is
created when a pending-damage item comes to the front, and the damage
resolves when the cycle goes **quiescent** rather than on the first pass.

Ordering is `sequencingOrder(state, victimSeat, [])` — **the minion taking
the damage goes first**, which is what p. 31 describes ("first, the minion
taking damage can play combat cards that prevent damage"), with everyone
else following in seating order.

The cycle is rebuilt per damage item, not per round: `pendingDamage` is a
queue and each entry is its own prevention window with its own victim, so
the seat that goes first changes between entries.

**The `prevent:credit` built-in stays with the victim's side only.** A
credit belongs to a combatant (Beast Meld granted it to them); it is not
something a bystander can spend.

## 3. Prevention needs a target now

`ops.preventDamage(n)` applied to "the damage in front of us", which was
unambiguous while only the victim could act. With bystanders playing, a
card must say **whose** damage it prevents — Martyr's Resilience says "a
minion **or retainer** in combat", and Touch of Valeren superior says "that
minion", meaning the one its player controls.

So `preventDamageFor(minion, amount)`: it prevents against the pending item
whose victim is that minion, and does nothing if that minion has no pending
damage. The existing `preventDamage(n)` keeps its meaning (the head of the
queue) for the ordinary combatant case.

Enumeration therefore emits **one option per preventable victim**, which
lands in the option id, so a trace test names the minion it means.

## 4. The three cards

| id | card | shape |
|---|---|---|
| 101175 | Martyr's Resilience | combat card, **any** Methuselah's unlocked vampire not in the combat |
| 102262 | Touch of Valeren | action **or** combat; the superior combat mode is the outside-the-combat one |
| 102258 | Saulot's Guiding Wisdom | master archetype; ends a combat from outside, at `beforeRange` |

**Martyr's Resilience** is the pure case and the one that pins the "ANY
Methuselah" reading — its test has a *third* seat, neither combatant,
doing the preventing. Its superior mode is a variable cost ("burn X blood
to prevent X+1"), which reuses the per-X option enumeration built for Veil
the Legions.

**Touch of Valeren** is `modifierOrCombat`-adjacent but actually
Action/Combat: an action mode (add 3 blood or life to a minion, capped at
their starting life) and two combat modes, of which only the superior is
outside-the-combat. The cap is why `MinionState.startingLife` matters —
for a vampire that is capacity, for an ally its printed life.

**Saulot's Guiding Wisdom** needs two things beyond the gate:

- **`endCombat()` from outside**, at `beforeRange`. That window already
  cycles every seat and already calls `abilityOptionsFor`, so the ability
  slots straight in; the op just pops the combat frame the way a
  `combatEnds` strike does.
- **A title worth 2 votes that is not a `VampireTitle`.** `TITLE_VOTES` is
  a fixed map over eleven titles, and "a unique Independent title" is none
  of them. Rather than corrupt that enum, the vote enumeration gains a
  second source: **`bonusVotes` contributed by cards attached to the
  vampire**, offered even when `title === null`. That is the honest model —
  the card *represents* a title, and what a title does mechanically is
  supply votes.

## 5. Deliberately out of scope

**Huldu, The Desecrator (201757)** has exactly this shape ("once each
combat involving another minion you control … prevent 1 damage to that
minion") and is a **crypt card**. Crypt abilities are 0/217 and belong to
phase 7; the mechanic is built and Huldu will need no new kernel work when
the importer lands.
