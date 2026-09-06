# Granted rush actions — cards in play that let a minion enter combat

Status: **design + implementation** (2026-08-29). Sub-family of the
granted-actions gate (`docs/granted-actions-design.md`); the rush
mechanics themselves were settled in `docs/rush-actions-design.md`.

## 1. The family

Five unsupported cards, all masters, all of the shape "&lt;who&gt; can enter
combat with &lt;target&gt; as a [+N stealth] Ⓓ action":

| id | card | who acts | target | stealth |
|---|---|---|---|---|
| 100794 | Frontal Assault | each ready minion **you control** | a minion controlled by **your prey** | — |
| 100897 | Haven Uncovered | **minions** (anyone's) | the **bearer** | +1 |
| 101487 | Priority Contract | the **chosen** Assamite you control | the **bearer** (a prey minion) | +1 |
| 101587 | Regent | **Sabbat vampires** (anyone's) | the **bearer** | — |
| 102257 | Saulot's Avenging Fist | the **bearer** (a Salubri) | a **non-Salubri vampire** | +1 vs Tremere |

The existing `rush` spec field covers only the ally/retainer shape (the
card *is* the minion, or sits on it, and only its own controller acts).
Three of these five let a minion the card's controller does **not**
control take the action, and two of them pick their actor by clan or sect
rather than by attachment.

## 2. What already exists (no sequencing change)

Everything in the kernel these need was built for earlier gates:

- `announceEntryAction(entry, minion, { targetMinion })` — a rush from a
  card in play; combat on success, the target is not locked
  (rush design §2.3).
- Directedness derived from the target minion's controller (p. 25), so
  "Ⓓ" needs no encoding — it falls out.
- `entryActionOptionsFor` already scans **every** seat's cards in play,
  built for the "minions can burn this card" clause, so a card can offer
  an action to a seat that does not control it.
- `PermanentInPlay.grantedActionUses: { minion, key }[]` — the p. 20
  "once per turn per copy" limit, per minion.
- `PermanentInPlay.chosen` — a minion picked when the card entered play
  (Priority Contract's Assamite).

So this sub-family is compiler work plus three additive hooks (§6).

## 3. `permanent.rushGrant`

```ts
rushGrant?: {
  who: { scope: "bearer" | "chosen" | "controller" | "any";
         kind?; clan?; sect? };
  target: { scope: "bearer" | "prey" | "any"; kind?; notClan? };
  stealth?: number;
  stealthByTarget?: Array<{ clan?; sect?; delta }>;
};
```

`who.scope` is the actor set before the clan/sect filter: the card's
bearer, the minion recorded in `chosen`, every minion the card's
controller controls, or every minion in the game. `target.scope` is
resolved from the **card's controller** ("your prey" is the controller's
prey, even when someone else is taking the action — no card in this
family combines a foreign actor with a prey target, but the rule has to
pick one and the card's text is written from its controller's seat).

`stealthByTarget` is the one conditional: Saulot's Avenging Fist is a +1
stealth action only when the target is Tremere. It resolves at
announcement against the chosen target, so it is a property of the
option, not of the action frame.

Per-copy limit key: `"enterCombat"`, shared with the ally/retainer
`rush`, so one card cannot grant two rushes to the same minion in a turn.

## 4. Several granted actions on one card

Haven Uncovered grants a rush at its bearer **and** lets the bearer burn
it — two granted actions on one card, from two different spec clauses.
`compileSpec` previously grafted `vulnerableTo` with a plain overwrite
and threw if anything already owned `actionOptions`. It now collects the
providers (the card's own, `vulnerableGrant`, `permanentRushGrant`) and
merges them: `actionOptions` concatenates, `useActionOption` and
`resolveGrantedAction` dispatch to the provider that owns the option id.
Option ids carry a verb segment so the dispatch is unambiguous:

- `act:<Name>:<cardId>:rush:<actor>:<target>` — a granted rush
- `act:<Name>:<cardId>:<burn|steal|shuffle>:<actor>` — `vulnerableTo`

## 5. Attach targeting

`permanent.attachClan` ("a &lt;clan&gt; you control") and
`attachAnyMinion` ("any ready minion") did not cover "a ready vampire"
(Haven Uncovered), "a Sabbat vampire you control with capacity 8 or
more" (Regent), or "a minion controlled by your prey" (Priority
Contract). The general form is one field:

```ts
attach?: { scope: "own" | "prey" | "any"; kind?; clan?; sect?;
           minCapacity? };
```

The two older fields stay as sugar for the cards already using them.
A card attached to a minion its player does not control records
`controller` explicitly (p. 16), as `attachAnyMinion` already did.

`permanent.exclusiveKey` implements "a vampire can have only one
archetype": no second card carrying the same key may go on a minion that
already has one.

## 6. Three new hooks

All additive — a notification to cards in play, no change to the impulse
cycle or to any frame.

1. **`onLeaveReady(entry, owner, info, ops)`** — a minion left the ready
   region (burned or sent to torpor), fired from `burnMinion` and from
   both `WentToTorpor` sites, *before* the event, so the leaver is still
   findable and its controller readable. Frontal Assault's "you gain 1
   pool after a ready minion controlled by your prey is burned or sent to
   torpor" and Priority Contract's "if the attached minion is about to
   leave the ready region" both ride it. The existing `onCombatLeave` is
   narrower (it needs the *other* combatant) and stays.
2. **`onInfluencePhase(entry, owner, turnSeat, ops)`** — mirrors
   `onMasterPhase`, fired as the influence phase begins. Frontal Assault
   burns itself and its controller's pool there.
3. **`onDiablerie(entry, owner, info, ops)`** — fired inside
   `commitDiablerie` **before** the blood hunt is pushed, which is
   exactly what Regent's "move this card to the diablerist (before the
   blood hunt is called)" asks for. The victim is already burned at that
   point, so a card that was on the victim reads the bearer from the
   info, not from the state.

## 7. Titles held by a card

Regent is the first master that *carries* a title: "put this card on a
Sabbat vampire you control … to represent the unique Sabbat title of
regent" (4 votes, p. 28). `permanent.grantsTitle` emits `TitleGranted` on
attach.

The mirror was missing entirely: nothing ever cleared a title when the
card granting it left play, which was already wrong for the three
referendum title-granters (Malkavian/Toreador Justicar, Cardinal
Benediction). `burnPermanent` now emits the new `TitleLost` event when
the entry is tagged `"title"`, and Regent re-grants the title on the
diablerist when it moves.

## 8. Per-card notes

- **Frontal Assault** — seat-level (no bearer). Its influence-phase
  clause is not optional: "during your influence phase, burn this card
  and burn 1 pool for each ready minion controlled by your prey", so the
  card lasts exactly one turn cycle for its controller and the pool cost
  is a real risk. The pool gain is per leave-ready event, not per turn.
- **Haven Uncovered** — the only card here whose bearer is chosen with no
  ownership restriction ("a ready vampire", so anyone's, and putting it
  on your own vampire is legal if pointless). The bearer's escape hatch
  (burn it as a +1 stealth Ⓓ action) is `vulnerableTo.who.bearerOnly`,
  a new flag beside `excludeBearer`/`othersOnly`.
- **Priority Contract** — two picks at play time (the Assamite and the
  prey minion), so its play options enumerate the pairs; the Assamite
  lands in `chosen`. Its "about to leave the ready region" clause is
  modelled on `onLeaveReady` as a **ChoiceFrame** asked of the
  controller — the burn and the 3 pool happen before the leave event, so
  the timing matches "about to".
- **Regent** — `attach.scope: "own"` + `sect: "sabbat"` +
  `minCapacity: 8`, `grantsTitle: "regent"`, and a rush granted to every
  Sabbat vampire in the game. The diablerie clause moves the card and the
  title to the diablerist when a **Sabbat** vampire diablerizes the
  bearer; a non-Sabbat diablerist just burns it with the victim.
- **Saulot's Avenging Fist** — `attach` a Salubri you control,
  `statics.strength: 1`, `exclusiveKey: "archetype"`, and a bearer rush
  at any non-Salubri vampire with `stealthByTarget` for Tremere.

## 9. Deviations recorded

- Contested/unique titles (p. 19) remain unmodeled, so a second Regent
  on a different Methuselah's vampire is not contested — the same
  standing deviation as every other unique card.
- Frontal Assault's pool gain fires for **any** prey minion leaving the
  ready region, including one its controller never touched, which is
  what the card says ("after a ready minion controlled by your prey is
  burned or sent to torpor").
