# New vampires — wave 98 (0.11.35)

Four actions whose card becomes a vampire, on the `becomesVampire`
machinery Waters of Duat and Childe of the Revolution built
(`token-vampire-design.md`).

| Card | Requires | Childe | Acts? | Master | Blood |
|---|---|---|---|---|---|
| The Embrace (100633) | non-sterile vampire | cap 1, actor's clan **and sect** | must hunt | — | — |
| Third Tradition: Progeny (101973) | non-sterile prince or justicar | cap 1, actor's clan, **Camarilla** | cannot act this turn | library/hand/ash heap | up to 2 |
| Creation Rites (100441) | ready non-sterile archbishop/priscus/cardinal/regent | cap 1, actor's clan, **Sabbat** | cannot act this turn | library/hand/ash heap | up to 1 |
| Tumnimos (102046) | non-sterile **Ravnos** cap ≥5 (the icon, p. 10) | cap 2, Ravnos, actor's sect, basic Chimerstry | must hunt | **hand only** | — |

## §1 What already existed

`becomesVampire` with `capacity`, `clan`/`clanFromActor`, `sect`,
`searchDisciplineMaster`; `requiresNonSterile`; `MinionState.cannotActThisTurn`
(read by the action enumerators). "Must hunt this turn" is not a clause: the
childe enters at 0 blood and p. 21 makes the hunt mandatory.

## §2 `sectFromActor`

The Embrace and Tumnimos copy the SIRE's sect, read once at resolution, like
`clanFromActor`.

## §3 `cannotActThisTurn` and `disciplines`

Carried on `VampireTokenEnteredPlay` and folded onto the token. A 0-blood
childe that cannot act is **not** forced to hunt — asserted, and mutation-
checked (folding `false` makes the test offer `hunt:tp`).

## §4 `bloodFromActor` — "move up to N blood"

A choice (`tokenBlood`), 0…min(N, sire's blood, childe's room). The room is
read with `capacityOf` **when asked**, so a Discipline master found first
(+1 capacity) makes room for Progeny's second blood.

**Finding:** choice frames are a **stack** — the last raised is asked first.
The first draft raised them in printed order, with a comment claiming that
was the asking order; the test asked the blood question first and offered
only the pre-master room. They are now raised in reverse printed order.
Anyone raising two choices from one resolution must do the same.

## §5 `disciplineMasterFromHand` (Tumnimos)

The same `searchDiscipline` choice with `zones: "hand"`: only hand cards are
offered, and there is **no shuffle** — p. 14's shuffle belongs to a library
search, and this is not one.

## §6 Deferred

The Becoming — a 0-capacity childe kept alive by master cards; not this
wave's shape (`token-vampire-design.md`).
