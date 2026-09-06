# Combat cards that become permanents

*Wall of Filth (102347), Sculpt the Flesh (102260), Disarm (100549),
Morbidity (102332), Monstrous Form (102253).*

## 1. The cluster

The combat-side twin of `docs/action-attachments-design.md`. There the
card was an **action** that, on success, put itself into play instead of
going to the ash heap; here it is a **combat card** that does the same
thing mid-fight, and everything interesting happens afterwards.

| Card | Where it lands | What it then does |
|---|---|---|
| Wall of Filth `[pro]`/`[tha]` | on **its own player**, before range | burn it to prevent 2 damage (basic: non-aggravated only) |
| Sculpt the Flesh `[PRO]` | on the **victim**, as part of a strike | the bearer burns 1 blood or life each unlock phase; minions can burn it as a +1 stealth action |
| Disarm `[pot]` | on the **opposing vampire**, at end of round | sends them to torpor, −1/−2 strength; the bearer can burn 3 blood to be rid of it |
| Morbidity `[obl]`/`[tha]` | **into play**, not attached | holds up to 2 of the opponent's blood, returned when combat ends |
| Monstrous Form `[DOM][PRO]` | on its own player, as an **action** | lock it in combat for +1 strength this round, or a maneuver, or a press |

Two pieces already existed and carried most of this: `strikeAttachToVictim`
(Weighted Walking Stick) and `CombatFrame.afterCombatEnds` (the
after-combat-ends wave). What was missing is the plain case — a combat
card that attaches **without** being a strike.

## 2. The window a combat attach happens in is DATA, not a fixed case

`combatWindowFor(mode)` maps a mode's primitives to the combat window it
is played in, one `case` per primitive kind. That works while a primitive
has exactly one window — and the two plain-attach cards here disagree:
Wall of Filth is "only usable before range is determined", Disarm is
"only usable ... at the end of a round".

Rather than split one mechanic into two primitives to satisfy a `switch`,
**`attachInCombat` carries its own window** (`when: "beforeRange" |
"endOfRound"`) and `combatWindowFor` reads the field. It is the first
primitive whose window is data, and the alternative — `attachBeforeRange`
and `attachAtEndOfRound` as separate kinds that resolve identically — is
strictly worse: two names for one mechanic, which is how
`modifyVotes`/`restrictVotes` drifted apart.

`to: "self" | "opposing"` picks the bearer. `"opposing"` is p. 16
territory, so the entry records `controller` explicitly, exactly as the
action side had to learn to (Phantasmagoria).

## 3. A prevention filter that was missing, and the card it was already breaking

> Soak: "[for] Prevent 2 **non-aggravated** damage."

The `prevent` primitive has no aggravated filter, and `PendingDamage`
has carried `aggravated` since the strike-effects gate. **So Soak has
been preventing aggravated damage it cannot touch** — not a deferral, a
live rules bug on a supported card, found while surveying this wave.

Three cards in the pool print "non-aggravated": Soak (supported),
**Wall of Filth** (this wave) and Opikun (crypt, phase 7). So the filter
is worth having and is one field: `prevent.nonAggravated`.

It is a gate on **options**, not on the op — the `noPreventBy` precedent
from the discipline-filtered wave, and for the same reason: a card that
provably cannot touch this damage should never be offered against it,
rather than being offered and then doing nothing.

Wall of Filth is the sharpest possible test of the pair, because its two
modes differ **by exactly this clause**: basic prevents 2 non-aggravated,
superior prevents 2 of anything. The negative-space assertion writes
itself.

## 4. Disarm's window, and why nothing new was needed to measure it

> "Only usable at close range at the end of a round during which this
> vampire **successfully inflicted more damage** than the opposing
> vampire. Not usable by a vampire being burned or going to torpor."

`CombatFrame.damageTakenThisRound` was built two waves ago for Flesh of
Marble, and it is incremented inside `resolveCombatDamage` — i.e. **after
prevention**, which is precisely what "successfully inflicted" means. So
"this vampire inflicted more than the opposing vampire" is
`damageTakenThisRound[other] > damageTakenThisRound[mine]`, read from the
player's side. No new bookkeeping.

The second sentence is not decoration. **End of Round runs even when
combat has already ended and even when a combatant has just left the
ready region** (p. 32, and `docs/impulse-design.md` §10 row 13) — which
is exactly the situation a vampire "being burned or going to torpor" is
in at that moment. So the rule is: the playing vampire must still be
`isReady`. The card is telling us about a case the engine really does
reach.

New usable rules: **`onlyIfInflictedMoreThisRound`** and
**`byStillReadyCombatant`**.

## 5. A bearer who can buy the card off

> Disarm: "They can burn 3 blood to burn this card."

Not `vulnerableTo` — that is the generalised "**minions** can burn this
card as a Ⓓ **action**" clause (~25 cards), which costs an action and can
be blocked. This is the **bearer**, paying blood, at no action cost.

**`permanent.bearerCanBurn: { blood }`** is offered to the bearer's
controller in their own turn windows. Recorded reading: **it is offered
whenever they can pay**, with no timing restriction, because the card
prints none — the same reading Fragment of the Book of Nod's deviation
note wishes it had taken.

## 6. Morbidity: a blood store on a card in play

> "Put this card in play and move up to 2 blood from the opposing vampire
> to this card. After combat ends, move all the blood from this card to
> the opposing vampire and burn this card."

**`PermanentInPlay.counters` is the store.** This is the Wasserschloss
Anif precedent — blood moved onto a card becomes counters, and counters
moved back become blood — and it needs no new state at all. "Up to 2" is
the `x=N` shape: one option per affordable amount, so the player chooses
rather than the card choosing for them.

The return is an `AfterCombatRider`, and it must be robust to the case
these cards exist for: **the opposing vampire can be burned during the
combat**. `findMinion`, not `getMinion`; with no recipient the blood is
simply gone and the card still burns.

The superior's second clause, "combat cards cost the opposing vampire +1
blood", is `combatCostModOnOpponent` — **built for Terror Frenzy
superior in the play-cost wave, reused here verbatim**. That is the fifth
wave running where a query or primitive built for one family turned the
next one into data.

## 7. Monstrous Form: one card, both compilers

`cardType: "actionOrCombat"` (built for Touch of Valeren) hands each mode
to the compiler that owns its law. The basic is an ordinary before-range
strength bonus; the superior is a `+1 stealth` action that attaches, and
the attached card carries a **lock-to-use combat ability with three
answers** — +1 strength this round, one maneuver, or one press.

Nothing new: `lockGrant`-shaped abilities on a card in play are the
established pattern, and the three grants are `strengthBonusRound`,
`grantManeuverCredit` and `grantCombatPress`, all of which exist. What is
new is only that the ability is offered in **combat** windows rather than
action windows, which `abilityOptions` already supports — the weapons do
it, and so does Guardian Angel.

## 8. Rulebook citations

- p. 16 — control vs ownership: a card put on another Methuselah's minion
  is still controlled by the player who played it.
- p. 20 — "+N stealth action".
- p. 29 — the combat round: before range, range, strikes, damage
  resolution, end of round.
- p. 30, p. 32 — combat ends immediately when a combatant is not ready;
  **End of Round runs anyway**.
- p. 31 — damage resolution and prevention.
- p. 34 — aggravated damage cannot be mended.

## 9. Readings on record

1. **A non-aggravated prevention card is not offered against aggravated
   damage** (§3) — options, not a no-op.
2. **Disarm's player must still be ready at End of Round** (§4) — the
   card's own second sentence, and p. 32 is why the case arises.
3. **"Up to 2 blood" is a choice, not a maximum taken automatically**
   (§6) — the Cave of Apples / Dead Pool direction the owner endorsed,
   not the Show of Force one.
4. **A bearer buy-off has no timing restriction** (§5) — the card prints
   none.
