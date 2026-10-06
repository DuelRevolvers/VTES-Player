# Hunting-ground variants — design (wave 95)

Three hunting grounds that each bend a **different part** of the p. 21 rule —
"during your unlock phase, a ready vampire you control can gain N blood; a
vampire can gain blood from only one hunting ground card each turn".

| Card | KRCG | Cost | What it bends |
| --- | --- | --- | --- |
| Gurchon Hall | 100871 | 3 pool | **Who it feeds** — the two oldest, fixed, in one use. Requires a ready cardinal or regent. |
| Kingston Penitentiary, Ontario | 101060 | 4 pool | **Who may use it** — any other Methuselah may pay you 1 pool in *their* unlock phase to lock it and feed their vampire. |
| Poacher's Hunting Ground | 101404 | — | **How many times** — up to X anarchs, X = the non-derivative hunting grounds controlled by other Methuselahs. |

Printed text read from `data/vtes-raw.json`. All three extend the existing
`huntingGround` clause in `compile.ts`; the per-vampire limit
(`usedHuntingGroundThisTurn`) binds each of them.

Left out: Jungle Hunting Ground (feeds a Laibon) and Palace Hunting Ground (a
Guruhi) are inert in this pool; Trophy: Hunting Ground is a Red List trophy,
which is unmodelled. Arcanum Chapterhouse (taxes other seats' grounds) and
Threestar Cab Company (a blood store) are the natural next members.

## 1. What the wave found

**(a) For a seat permanent, `useAbility`'s `owner.seat` is the DECIDING seat, not
the holder.** The engine fills `owner` from `currentSeatOfTop()` and only
corrects it for *attached* cards. For every card only its holder may use, the two
are the same seat, so nothing noticed. Kingston is the first hunting ground a
*rival* uses: "pay the owner 1 pool", written with `owner.seat`, paid the renter
back his own pool — a rental that cost nothing and locked the card. The other
any-seat cards (`masterPhaseBurn`, the pay-to-unlock cards) already pass the seat
in `params`, which is the same workaround without the explanation. Here a
`holderOf` read off the table serves both the enumerator and the apply. **This is
the CLAUDE.md "which seat an ability belongs to" lesson a sixth time**, and it
was found only because the rental test checked the *owner's* pool as well as the
renter's. The engine's contract is left as it is: other cards depend on it.

**(b) A fixture flag the engine resets is a silent skip.** The first draft of the
"already fed this turn" case set `usedHuntingGroundThisTurn` in the fixture — and
the unlock sweep clears it before any hunting ground is asked, so the case was
testing a vampire that had *not* fed. It failed on an assertion rather than
passing quietly, which is the only reason it was noticed. It now feeds the vampire
from a real second ground first, in the same phase. The *guard clause in a test*
lesson, one level down: the fixture was fine; the engine undid it.

**(c) A stale comment.** `huntingGround.path` was documented as matching nothing
because "`MinionState` has no path" — true until the Path cards were unblocked,
when the enumerator was fixed and the comment left behind. Corrected; the
behaviour was already right.

## 2. Gurchon Hall: two fixed recipients

"Each of the two oldest ready vampires you control" names the recipients, where
every other hunting ground lets you choose one. So it is **one option** feeding
two vampires. Oldest is capacity. A tie for second place is the controller's to
break, so a tie is one option per legal pair (`combinations`). If one of the pair
has already fed from a ground this turn it is **skipped, not replaced** — the
recipients are fixed, so the next-oldest does not step in. Offered while at least
one of the pair can still feed.

## 3. Kingston Penitentiary: a rental

The owner's own use is an ordinary hunting ground and does **not** lock the card.
A rental, in the renter's own unlock phase, pays 1 pool to the holder, **locks**
the card, and feeds the renter's vampire — so one rental per round, since the
holder's unlock phase is what unlocks it. A renter on 1 pool is not offered it
(never oust yourself). `abilityAnySeat` is what lets other seats be asked at all.

## 4. Poacher's Hunting Ground: an allowance read off the table

X counts hunting grounds held by **other** Methuselahs that are **not
derivative**. Poacher's itself carries the `derivative` tag, so two players
cannot feed each other's poaching. It reuses the existing per-phase `allowance`
(Carfax Abbey's second grant), recomputed on every ask, so a ground burned
mid-phase lowers it.

## 5. Tests

`tests/cards/hunting-ground-variants.test.ts` — 8 cases. Gurchon: the two oldest
fed and nobody else; a tie gives one option per pair; a vampire already fed is
skipped and not replaced. Kingston: an ordinary ground for its owner with no rent
option; a rental moves 1 pool **from the renter to the owner**, locks the card and
feeds the renter's vampire; a locked Kingston cannot be rented. Poacher's: X = 2
with a derivative ground on the table that counts for nothing; X = 0 with none.

Mutation-checked — the `owner.seat` bug restored, the age sort reversed, the
derivative exclusion removed — each caught by its own card's cases.

Fuzz: all three added. A rental is the conservation replay's first hunting ground
that moves pool between seats.

## 6. Counts

Library 854 / crypt 217 / total 1071; supported 953 / 1071.
