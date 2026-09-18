# Before-range attachments

Tranche 1 wave 53, 2026-09-15 (v0.10.44). Focus the Blood (100753),
Nosferatu Putrescence (101302), Magazine (101142). Library 680 → 683.

Three combat cards played *before range is determined* that do nothing
when they resolve. Each one **lands somewhere** and is cashed in later —
and the three land in three different places, which is what makes them
worth building together.

| Card | Lands on | Cashed in |
|---|---|---|
| Focus the Blood | the vampire, with 1 of its own blood on it | burn it: the next combat card that vampire plays costs 1 less blood |
| Nosferatu Putrescence | **either combatant**, whoever controls them | never — it is a permanent −1 strength |
| Magazine | a **gun**, holding an ammo card | firing that gun uses the ammo's effect |

`attachInCombat` (Wall of Filth, Disarm) already existed and already took
its window as data. What it could not do was land anywhere but "self" or
"opposing", which is where all three of these differ.

## §2 "A Nosferatu in combat" is a target, not a bearer

*"Put this card on a Nosferatu in combat. … You may play this card even
if you are not involved in the current combat."*

Two things at once. `to: "anyInCombat"` with `targetClan` picks either
combatant, whoever controls them; and the card comes from a seat that may
have no minion in the fight, so **`play.minion` cannot be the anchor** the
way it is for "self" and "opposing". The bearer rides in the option id
instead, which is where every chosen target rides (p. 25).

The outside-combat path itself was already built
(`docs/outside-combat-design.md`, `usable: ["byOutsideVampire"]`) — it
just only knew how to offer PREVENTION cards, because those were the only
cards that had ever needed it.

"−1 strength **each combat**", not this one: nothing burns the card when
the combat ends, so it is an ordinary attached static that happens to have
arrived mid-fight.

## §3 Focus the Blood: the blood is already spent

*"Put this card and 1 blood on this Assamite. This vampire can burn this
card to reduce the cost of a combat card they play by 1 blood."*

`bloodOnCard` MOVES the blood: a burn off the bearer plus counters onto
the entry, never counters from nothing — the fuzz proves pool and blood
conservation by replaying the event log, so a card that mints a counter
breaks a game-wide invariant rather than just itself.

Burning it is therefore not a price, it is the withdrawal. The discount is
a one-shot `playCostMod` on the COMBAT frame — not the action's, because a
combat card's cost is read there and the action a combat hangs from may
not be the right frame at all.

**`minionId` was already the right field.** The combat frame holds both
combatants' plays, so a mod with no minion scope would have let the
OPPOSING vampire spend Focus the Blood's charge. Terror Frenzy's superior
("combat cards cost the opposing vampire +1 blood") had needed exactly
that scope and left `PlayCostMod.minionId` behind for it.

"Assamite" is the registry's **Banu Haqim** — the clan-vocabulary trap the
project memory records, checked against the registry rather than the
printed name.

## §4 Magazine, and the four rules that were only in one place

*"Put this card on a gun on this minion and put an ammo card from your
hand on this card. When using this gun, you may use the effect of the ammo
card as if it were played from your hand."*

Three pieces, two of which already existed:

- **The stored card.** `storeCard` and `PermanentInPlay.stored` are the
  card-onto-card zone Black Market Cache built, and the rulebook's own
  precedent for it is a contested unique, "turned face down and out of
  play" (p. 14). Face up here: everybody can see what is in the magazine.
- **"On a gun."** The engine attaches cards to MINIONS, not to other
  cards. Rather than build a second attachment point, the gun is recorded
  as a link (`gun:<id>` in the entry's tags). Nothing in the rules asks
  where the card physically sits — only "when using **this** gun", which
  the link answers.
- **The effect.** New `CardHandler.ammoLoad`, so "use the effect of the
  ammo card" reads the ammo card's own compiled load instead of
  re-deriving five cards' effects in a second place.

**What this wave found:** the ammo enumerator carried a comment reading
*"ONE PLACE FOR THE FOUR RULES EVERY AMMO CARD PRINTS, so a sixth ammo
card cannot ship having forgotten one"* — and that was true only because
every caller came from a HAND. The rules were steps inside a loop over
hand cards, not a question anyone could ask. Magazine reaches the same
window holding an ammo card that was never in a hand, and would have had
to restate all four. They are now `ammoTargetGun(cf, side, minion,
minGunUses)`, a question about a (gun, load) pair, and both callers ask
it. Glaser's "not the first time the gun is used" moved onto `AmmoLoad`
for the same reason — a gate both paths must see is a property of the
load, not of one enumerator.

*"…requirements and cost apply as normal"*: no ammo card in the pool has
either, so the parenthetical costs nothing today. Recorded rather than
silently skipped.

## §5 The other thing it found

**`usable` exists on the spec AND on the mode, and the outside-combat
gate reads the MODE's.** Nosferatu Putrescence was first written with
`usable: ["byOutsideVampire"]` at spec level. It compiled, it typechecked,
every test but one passed — and the card was offered to nobody, because
the gate never looked there. The failure signature is the one the project
memory names directly: *"which seat an ability belongs to is a per-card
question, and getting it backwards offers the card to nobody, silently."*

The cheap tell was that the card's own test walked to the right seat's
impulse and got back `["pass"]`. **A field that exists at two levels needs
its reader checked, not its spelling** — the compiler cannot tell you that
you put a real field in the wrong real place.
