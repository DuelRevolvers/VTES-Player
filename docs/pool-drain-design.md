# Recurring pool drains from a card in play

*Anarch Revolt (100055), Judgment: Camarilla Segregation (101028), Augury
of Doom (102310), War of Ages (102348), Fame (100698), Tension in the
Ranks (101958).*

## 1. The family

A survey of pool-moving cards among the 153 unsupported library cards
found one recurring shape, and it is the largest coherent group left:

> **A card that sits in play and charges Methuselahs pool on a repeating
> trigger, plus a printed way for the table to get rid of it.**

| Card | Type | Drain | Removal |
|---|---|---|---|
| Anarch Revolt | Master | any Methuselah with no ready Anarch burns 1, each of their unlock phases | a referendum, called as a +1 stealth political action |
| Judgment: Camarilla Segregation | Action | any Methuselah controlling a non-Camarilla vampire burns 1, each of their unlock phases | any Methuselah, in their master phase, burns a non-Camarilla vampire they control |
| Augury of Doom | Action | your prey burns 1 per vampire in torpor they control, their unlock phase | burns itself when the prey has no torpor vampires, or is ousted |
| War of Ages | Political | your prey burns 1, their unlock phase | a referendum, as above; and it burns itself (for +3 pool) when the prey is ousted |
| Fame | Master (on a vampire) | while the bearer is in torpor, **every** Methuselah burns 1 in their own unlock phase | none printed |
| Tension in the Ranks | Master | *not* an unlock drain: after any ready minion is burned or sent to torpor, its controller burns 1 | any Methuselah, a master phase action + discard two master cards |

Tension in the Ranks earns its place: its trigger differs, but it is the
same card archetype (a standing tax with a printed price for removing it),
and it shares its removal shape with Judgment.

**The Gate of Acheron** (102290) has this exact shape and is deliberately
left out: its alternative to burning pool is *removing a card in the ash
heap from the game*, and the ash-heap region is on the BLOCKED list
pending owner review.

## 2. What already existed

Almost all of it, which is why this is a data wave rather than a kernel
one:

- **`onAnyUnlock(entry, owner, unlockingSeat, ops)`** — "during each
  Methuselah's unlock phase" (Constant Revolution, Smiling Jack). Four of
  the six drains are this hook with a different predicate.
- **`onLeaveReady(entry, owner, {minion, controller, how}, ops)`** — fired
  for **every** entry on every seat, before the burn/torpor event, and it
  already carries `how: "burned" | "torpor"`. Fame and Tension are one
  hook each.
- **`abilityAnySeat`** — "any Methuselah can use this ability", built for
  Carver's Meat Packing. The two master-phase removal clauses need it.
- **`permanent.vulnerableTo`** — "minions can burn this card as a Ⓓ
  action", already generic over who may take it and what it costs.
- **`putInPlayOnSuccess`** — an action card that puts itself in play.

### The one gap: `onAnyUnlock` never reached an attached card

The unlock sweep fired `onAnyUnlock` over `seat.permanents` only. Every
existing user is a location, so nothing had noticed — but **Fame sits on a
vampire**. It now iterates the same `allEntries()` set `onLeaveReady`
uses, so seat-level and attached cards are treated alike.

## 3. `permanent.unlockDrain` — the shared clause

```ts
unlockDrain?: {
  /** Whose unlock phase fires it: anyone's, or only the controller's prey. */
  whose: "any" | "prey";
  amount: number;
  /** What must hold of the Methuselah whose phase it is. Absent = always. */
  when?:
    | { kind: "noReadySect"; sect: Sect }        // Anarch Revolt
    | { kind: "controlsNonClan"; clan: string }  // Judgment
    | { kind: "bearerInTorpor" };                // Fame
  /** "…for EACH vampire in torpor they control" (Augury of Doom). */
  perTorporVampire?: boolean;
};
```

Every field traces to a printed line. `bearerInTorpor` is a condition on
the **card's bearer**, not on the unlocking Methuselah, which is why it is
in the same union rather than a separate axis: all three answer the one
question "does the drain apply this phase".

**Reading on record — Fame charges everyone.** "During each Methuselah's
unlock phase, if this vampire is in torpor, **that** Methuselah burns 1
pool" is `whose: "any"` with no seat filter: the card's own controller
pays it too. That is what the text says, and Fame is normally played on an
opponent's vampire, so the cost is the point.

## 4. `permanent.leaveReadyDrain`

```ts
leaveReadyDrain?: {
  amount: number;
  /** "…burned or sent to torpor" (Tension) vs "goes to torpor" (Fame). */
  how?: "burned" | "torpor";
  /** Fame: only when the leaver is this card's own bearer. */
  bearerOnly?: boolean;
};
```

The pool is charged to `info.controller` — the leaver's controller, read
**before** the minion leaves, which is exactly why `onLeaveReady` fires
ahead of the event.

## 5. Self-burn: `permanent.selfBurn`

Two cards end themselves.

```ts
selfBurn?: {
  /** "…or after they are ousted, burn this card" (+ optional payout). */
  onPreyOusted?: { gainPool?: number };
  /** "If your prey controls no vampires in torpor, burn this card." */
  whenPreyHasNoTorpor?: boolean;
};
```

**New hook: `onSeatOusted(entry, owner, oustedSeat, ops)`**, fired from
`processOusts` **before** the `Ousted` event. That ordering is not
incidental: "your prey" is an adjacency relation, and the oust rewrites
adjacency. Firing first is the only moment at which `preyOf(controller)`
still names the seat being ousted.

**Reading on record:** Augury of Doom's `whenPreyHasNoTorpor` is evaluated
**at the same moment the drain is counted** — during the prey's unlock
phase. The clause and the count read the same board state in the same
sentence ("for each vampire in torpor they control … if your prey controls
no vampires in torpor"), so evaluating them together is the natural
reading; checking continuously would make it the only condition in the
engine that is re-derived outside a window.

## 6. Removal, shape one: a referendum to burn the card

> "Vampires can call a referendum to burn this card as a +1 stealth
> political action." (Anarch Revolt, and War of Ages with "…that costs 1
> pool")

This is `vulnerableTo` with **`via: "politicalAction"`**: same actor
filters, same stealth and cost fields, but success calls a referendum
instead of burning the card outright, and the *referendum* burns it on a
pass.

The politics kernel needed one generalization. The referendum push was
gated on the acting card:

```ts
if (success && af.card && this.handler(af.card.instance.name).isPoliticalAction)
```

A granted action has **no `af.card` at all** — the political action is
granted by a card in play. `ActionFrame.referendumSource` (`{cardName,
cardInstanceId}`) is now the single thing that gate reads, set from either
path, so `applyReferendum` dispatches to the card in play's own handler
and `rf.cardInstanceId` is the entry to burn.

Also generalized: `CardHandler.holdsCardForReferendum`, which is what
`isTitleGrant` was really being used for at two engine sites ("do not burn
this card at action resolution; the referendum decides"). War of Ages
wants the same treatment for a different reason — on a pass it goes *into
play* rather than onto a vampire — so the flag now says what it means, and
title grants set it.

## 7. Removal, shape two: a master-phase price

```ts
masterPhaseBurn?: {
  /** "…use a master phase action and…" (Tension). Judgment does NOT. */
  usesMasterAction?: boolean;
  /** "…discard two master cards" (Tension). */
  discardMasters?: number;
  /** "…burn a non-Camarilla vampire they control" (Judgment). */
  burnOwnMinion?: { kind?: "vampire" | "ally"; notClan?: string };
};
```

Offered to **every** Methuselah (`abilityAnySeat`), in their own master
phase, and only when they can actually pay — an ability that cannot be
paid for is never enumerated. Judgment's clause conspicuously does *not*
say "master phase action", so it does not consume one; Tension's does.

## 8. Rulebook citations

- p. 7 — the unlock phase, and that it is the first phase of the turn.
- p. 10 — master phase actions; a trifle refunds one.
- p. 17 — "unlock all of your cards" and unlock-phase effects.
- p. 27 — a successful political action calls its referendum; an action
  card is burned at resolution unless something holds it aside.
- p. 36 — the surviving predator gains 6 pool when their prey is ousted.
- p. 43 — every card an ousted Methuselah controls is removed from play.
- p. 44 — a victory point for ousting your prey.
