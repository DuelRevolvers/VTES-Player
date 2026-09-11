# The Discipline masters, and the §0 check that chose them

*Animalism (100070), Auspex (100114), Fortitude (100774), Presence
(101480), Thaumaturgy (101965).*

Wave 18, landed **v0.10.1**. Library **553 → 558**.

Five cards, no new primitive, and **twenty lines of data**. The whole
content of this wave is the question of *which* five — which is not a
matter of taste, and is worth writing down because the answer generalises
to every wave after it.

## 1. The family was already built

`docs/derived-traits-design.md` built the shape six cards ago:

> "Discipline. Put this card on a vampire. This vampire gets +1 level of
> \<D\> and +1 capacity. Cannot be put on a vampire with superior \<D\>."

`disciplineCards()` in `cards.ts` is a factory over `[krcgId, name, code]`,
and both bonuses are **derived at read time** (`disciplinesOf`,
`capacityOf`) rather than written onto the minion, so they vanish
correctly when the card leaves play with no bookkeeping at all.

Celerity, Dominate, Obfuscate, Potence, Protean and Oblivion were in.
Fourteen more Discipline masters were not.

**The V5 printings word it differently** — "gains 1 level of \<D\>.
Capacity increases by 1: **the vampire is one generation older**" — and
that is the same effect stated more carefully, since capacity and
generation are two readings of one number (p. 11). Four of this wave's
five carry that wording and none of them needed a different shape.

## 2. Which five, and why it is not a preference

A Discipline master that grants a Discipline **no card in the pool
requires** is whole and inert: it does exactly what it prints, forever, to
no effect. That is the Tradition Upheld shape ("choose a ready Caitiff",
with no Caitiff in the pool), and §0 keeps inert cards out as firmly as
partial ones.

So the check ran first, over the registry:

| | |
|---|---|
| Disciplines the supported LIBRARY requires | `ani dom for pot pre cel aus tha obl pro obf` — **eleven** |
| Discipline masters already in the pool | `cel dom obf obl pot pro` — **six** |
| **The wave** | the other **five**: `ani aus for pre tha` |

Each of the five is required by between 45 and 79 cards already in the
pool, so none of them is close to the line.

The **nine that stayed out** — Chimerstry, Dementation, Necromancy,
Obtenebration, Quietus, Serpentis, Vicissitude, Abombwe and Agent of Power
— grant a Discipline nothing in the pool asks for. They are not blocked,
not hard, and not deferred for effort: they are simply inert until §7
opens the clans that use them, and they cost nothing on that day.

Note the shape of the argument. The usual §0 question is "does the pool
contain a target this card can name?" Here it runs the other way — "does
the pool contain anything that can USE what this card gives?" — and the
answer is a set difference over the registry, not a judgement.

## 3. The test is the check, not the cards

`tests/cards/discipline-cards.test.ts` gained one assertion:

> the set of Disciplines granted by Discipline masters in the pool ==
> the set of Disciplines the supported library requires

That is the §0 rule as an executable statement, and it is deliberately a
**reason rather than a count** — an assertion about eleven would be a
hostage to every future wave. This one is not: when the library widens
into a clan whose Discipline nothing yet requires, it fails and names the
card to add; when a Discipline master is added early, it fails and says
the card is inert. Either way the failure is the answer.

It reads LIBRARY entries only. A crypt card's Disciplines are levels it
**has**, not a requirement it **makes** — the distinction
`clan-vocabulary.test.ts` had to learn when the legacy library brought in
twenty-two clans no vampire has.

The coverage loop that played each card and asserted the level landed went
from six Disciplines to eleven. That is the whole of the rest of the
testing, because the mechanism is six waves old and already pinned.

## 4. What this wave did not find

Nothing. No engine defect, no stale deferral, no rule mis-read — the first
wave since 11 with none, and worth recording as such rather than dressing
up. The mechanism was built correctly the first time and five more cards
went through it untouched; typecheck, 2,279 tests, the build and a
20-game simulation were green on the first run with all five dealt into
the fuzz decks.

The one correction it did make is in `CLAUDE.md`, and it was mine: the
Combat bucket note carried "**Zero melee weapons are in the pool**" from
wave 16, repeated in the wave 17 report. It is false and was false when
written — Bang Nakh, Bastard Sword, Meat Cleaver, Sengir Dagger, Kali's
Fang, Femur of Toomler, Brass Knuckles, Gas-Powered Chainsaw, Righteous
Blade and the Sword of the Archangel are all in the pool and all tagged
`melee`. It came from a query whose registry lookup was wrong, reported as
a finding, and was then carried forward twice without being re-derived —
which is exactly the failure mode `CLAUDE.md` opens by describing. A
claim in a doc is a claim about the code **as it was**, and a claim about
the code that was never true is worse.
