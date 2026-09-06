# Playing a card from hand outside its own action

*Angel's Gift (102349), Contraband (102352), Pack Alpha (101342), Piper
(101401), Biothaumaturgic Experiment (100162).*

## 1. The family

A pool survey of the 160 unsupported library cards turned up one clause
repeated almost word for word:

| Card | Type | Clause |
|---|---|---|
| Angel's Gift | Combat | "Equip this vampire with a **melee weapon from your hand** (requirements and cost apply as normal)." |
| Contraband | Combat `[obf]` | "Equip this vampire with a **non-unique equipment from your hand** (requirements and cost apply as normal)." |
| Pack Alpha | Combat `[ani]` | "**Employ an animal retainer from your hand** (requirements and cost apply as normal)." |
| Piper | Master | "That Anarch **recruits or employs an ally or retainer from your hand** (requirements and cost apply as normal)." |
| Biothaumaturgic Experiment | Action `[tha]` | "**Employ an animal retainer from your hand** ignoring requirements (pay cost as normal)." |

Three of them are the queue's named "mid-combat equip/employ from hand"
cluster; the survey added the other two, which are the same mechanic in a
master phase and at action resolution. The parenthetical is the whole
design brief: *the card comes in as if it had been played normally, minus
the action*.

Two further cards mention hand-adjacent zones and are deliberately **not**
in this wave, because they are a different mechanic (a face-up out-of-play
store, not the hand): Black Market Cache (102351) and Fleshforge Chamber
(102354).

## 2. What the engine had, and the one thing it lacked

Equipment, retainers and allies all reach play down a single path:

```
play the card  →  announceCardAction()  →  block window  →  resolve
                                                         →  enterPermanentFromAction(af)
```

`enterPermanentFromAction` is where the `PermanentEnteredPlay` /
`AllyEnteredPlay` events are emitted, and it read **everything off the
`ActionFrame`**: `af.card` (which card, which mode), `af.acting` (the
bearer), `af.actingSeat` (the controller). That is the last step of the
pipeline, and it is the only step these five cards want.

Nothing else was missing. There is no new sequencing here: a combat card
resolves in `combat.beforeRange` like any other, a master resolves in
`turn.master`, an action card's effects resolve on success. What was
missing was a way to say "and now put *that* card into play".

## 3. `enterPermanent(args)` — the refactor

`enterPermanentFromAction(af)` is now a one-line caller of

```ts
private enterPermanent(args: {
  card: CardInstance;
  handler: CardHandler;
  mode: DisciplineLevel | null;
  seat: SeatId;
  bearer: MinionId;
  cost: number;      // pool actually paid, for AllyEnteredPlay
}): boolean
```

keyed on *(card, mode, seat, bearer)* instead of on a frame. The
`putsInPlayOnSuccess` / `attachOnSuccess` branches stay on the action
path, because both of those are a card putting **itself** in play on
success — they are not things another card can do to a card in hand.

## 4. `EngineOps.playCardFromHand` — and when the cost falls due

```ts
playCardFromHand(args: {
  cardId: CardInstanceId; seat: SeatId; minion: MinionId;
  mode: DisciplineLevel | null; blood?: number;
}): void;
```

It removes the card from hand, emits `CardPlayed`, charges the cost, and
calls `enterPermanent`.

**`CardPlayed` is emitted, deliberately.** The card *is* being played
(p. 9); the event log is the record every "only one X in a game" check
reads (the Week of Nightmares precedent), and the English log should say
so.

**Reading on record: the cost is paid immediately and unconditionally.**
An equip action defers its cost to resolution because a blocked action
never resolves (p. 27). Here there is no action to block — Piper says so
in as many words ("This is not an action and cannot be blocked"), and a
combat card resolves inside its own window. So the cost falls due at the
moment the card enters play, and there is no failure branch to refund.

## 5. The `playFromHand` primitive

```ts
| ({ kind: "playFromHand" } & PlayFromHandFilter)

export interface PlayFromHandFilter {
  types: PlayCostCardType[];      // "equipment" | "retainer" | "ally"
  tags?: string[];                // "melee", "animal"
  nonUniqueOnly?: boolean;        // Contraband
  ignoreRequirements?: boolean;   // Biothaumaturgic Experiment
  halfCostInBlood?: boolean;      // Contraband superior
  actor?: { sect?: Sect; lock?: boolean };  // Piper
}
```

The **choice of which card to bring in rides in the option id**, the way
every other choice fixed at play time does (`from=<cardInstanceId>`, plus
`fmode=basic|superior` when the incoming card has modes, plus `fblood=N`
for Contraband's split). One option per legal (bearer × hand card × mode ×
split). No new decision point, no `ChoiceFrame`: the seat playing the card
is already being asked, and the answer is part of the play.

`actor` is what makes Piper fit the same primitive. For the other four
the bearer is the playing/acting minion; Piper's bearer is a **chosen
ready unlocked Anarch you control**, locked to do it, so `actor` widens the
enumeration by one axis and adds a `MinionLocked` on resolve.

## 6. "Requirements apply as normal" — what that includes, and what it does not

The point of the clause is that the incoming card is not smuggled past its
own gates. Checked at enumeration, by the **same helper the ordinary
equip/employ/recruit enumerators call**, so the two answers cannot drift:

- the discipline of the chosen mode (`disciplineOk`);
- `meetsRequirements` (clan / sect / title / capacity);
- own-copy uniqueness (`seatControlsCopy`);
- one vehicle per minion;
- `statics.cannotPlayCardTypes` (Depravity) on the bearer;
- affordability, through `playCostFor`.

**Not** checked, and this is a reading worth recording: **`canAct(bearer)`
and "one action per turn".** Those gate *taking an action*, and none of
these five is an action. Three of them are played mid-combat, where the
bearer is necessarily locked — applying `canAct` would make the whole
family inert. Piper spells the reasoning out for us ("This is not an
action"), and the other four are combat cards and action *effects*.

`ignoreRequirements` (Biothaumaturgic Experiment) drops exactly the
`disciplineOk` + `meetsRequirements` pair and keeps everything else,
because the card says "ignoring requirements (**pay cost as normal**)".

## 7. Pricing a card the compiler does not own

The compiler is compiling *Contraband*; the card it must price is
whatever equipment is in hand, whose `CardSpec` it has no reference to.
It has the `CardHandler`, so the price comes from a `PricedCard` built out
of `handler.bloodCost`, `handler.poolCost`, **`handler.costTypes(mode)`**
and **`handler.requiresDisciplines(mode)`** — the two queries built for
the play-cost and discipline-filtered waves, doing here exactly the job
they were built for one family earlier. That is the third wave running
where an existing query turned the next family into data.

This needs one new thing: `PlayContext.registry`, so an enumerating
handler can look up another card's handler. Everything a card needs to
know about *itself* is still denormalized; this is a card asking about a
**different** card, which no amount of denormalization onto frames can
answer.

`halfCostInBlood` (Contraband superior) enumerates one option per legal
split, `blood ≤ floor(cost / 2)`, in the `paymentSplits` shape already
used by cost sources and variable costs.

## 8. Angel's Gift's second mode

> "This round, this vampire gets 1 optional maneuver, only usable to get
> to close range."

`CombatFrame.maneuverCredits` is combat-scoped and unrestricted, so this
needs its own counter: **`CombatFrame.closeManeuvers`**, reset each round
beside `handStrikesAggravated`, and offered only while `range === "long"`.

The field carries **both** restrictions ("this round" and "only to close")
because the single card that grants it carries both; if a later card wants
one without the other, split it then rather than now. Spending prefers a
close-only credit over an ordinary one when both are available and legal —
it is the use-it-or-lose-it resource.

## 9. Pack Alpha superior

> "Burn an animal retainer employed by this vampire to put this card on
> this vampire. This minion gets +1 strength. A minion can have only one
> Pack Alpha."

A cost paid in a card already in play, which is new — every other cost so
far has been blood, pool or counters. `{ kind: "burnAttachedToAttach";
tags: string[] }` enumerates one option per matching attached permanent
(`burn=<cardId>` in the option id), burns it on resolve and then
`putPermanentInPlay`s the played card with the spec's statics. "Only one"
is `permanent.exclusiveKey`, checked at enumeration and pushed as a tag.

## 10. Biothaumaturgic Experiment superior

> "Put this card on a minion you control. The attached minion gets 1
> optional maneuver each combat and +1 strength."

`attachSelf` already grants `strength`. The maneuver needed
**`PermanentStatics.maneuverPerCombat`** — the aura already had the field
(Brujah Debate radiates it), an attached card did not. Granted at
`pushCombat` beside the existing `pressPerCombat` sweep, which is the
exact sibling.

The mode says "a minion you control", not "this vampire", so it uses the
existing `permanent.attach` targeting rather than `attachSelf`'s bearer.

## 11. Limits

- Angel's Gift, Pack Alpha: "only one each **round**" → `combatLimit: "round"`.
- Contraband: "only one each **combat**" → `combatLimit: "combat"`.

Both are the existing `spec.combatLimit`, which records the play against
the combat frame. **Known non-invariant, pre-existing and unchanged by
this wave:** the printed limit is per *vampire* and the implementation is
per *combat frame*, so two combatants cannot each play their own copy in
the same round. Noted rather than fixed, because changing it touches every
card that already uses `combatLimit`.

## 12. Rulebook citations

- p. 9 — a card with a pool cost may only be played by a Methuselah who
  can pay it; playing a card is what puts it into play.
- p. 16 — a card in play is controlled by the Methuselah who played it,
  regardless of whose minion it sits on.
- p. 20 — the equip action and its +1 stealth (the action these cards
  bypass).
- p. 22 — employ retainer / recruit ally actions; a retainer's life; an
  ally enters unable to act this turn.
- p. 27 — an action card's cost is paid at resolution (the rule that does
  **not** apply here, §4).
