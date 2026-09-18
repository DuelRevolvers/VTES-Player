# Fee Stake — the Anarch title

Tranche 1 wave 51, 2026-09-14 (v0.10.41). Fee Stake: Boston (100712),
Corte (100713), Los Angeles (100714), New York (100715), Perth (100716),
Seattle (100717). Library 671 → 677.

Six cards, one factory — the hunting-ground/Praxis-Seizure treatment, in
the third sect.

## §1 Why these are not just more Praxis Seizures

*"+1 stealth ACTION. Requires an Anarch with capacity 5 or more. Title.
Put this card on this Anarch to represent the unique Anarch title of
Baron of \<city\>."*

A Praxis Seizure and a Crusade are **political actions**: you call a
referendum and the table decides. A Fee Stake is an **ordinary action**:
you announce it, and if nobody blocks, you are the Baron. The whole
mechanical difference is which side of the block window the title lands
on, and it is the reason this needed engine work at all — every
title-granting card in the pool so far arrived through `refPutInPlay`,
the referendum path.

The gate cost nothing: `requiresSect` and `requiresCapacity` both already
existed, so "requires an Anarch with capacity 5 or more" is two lines of
data.

## §2 `attachSelf` had to learn to grant a title

`attachOnSuccess` is the action-card mirror of the master compiler's
`putPermanentInPlay`, and the two had drifted: the master path emitted
`TitleGranted` from `permanent.grantsTitle` and pushed a `"title"` tag,
and the action path did neither. Nothing had noticed because no action
card in the pool granted a title.

So `attachSelf` gains `grantsTitle` / `grantsTitleCity`, the handler
contract carries them through, and the engine emits the same
`TitleGranted` — **with the city** — right after the permanent enters
play. One event, two compilers, the same shape.

**The city is the wave 19 finding in a third place.** `titleContestKey`
keys prince, baron and archbishop on the **city alone** (p. 39: a prince
"can be contested by another vampire who claims any title to the same
city"). A Baron of Boston whose city lived only in a display tag would
answer `null` there and never contest — with anybody, including another
Baron of Boston. The tag is for people; `grantsTitleCity` is for the
rules. `unique: true` is the other half: the contest detector gates on
the registry flag, so without it two Barons of Boston is an illegal
state rather than a contest.

`baron` was already in `TITLE_VOTES` and already keyed on the city in
`titleContestKey`, so the rules side needed nothing — only the delivery.

Ruling honoured for free: *"if the title is contested, the card is turned
face down out of play and the provided action cannot be used"*
[LSJ 20070808-2] — which is what `ContestedCard` already does with the
whole entry, title included.

## §3 A vote modifier scoped to ONE referendum

*"Vampires can call a referendum to burn this card as a +1 stealth
political action; **during that referendum, non-Anarch titles are worth
-1 vote**."*

The first half is `vulnerableTo` with `via: "politicalAction"` — built
for Anarch Revolt, and used again last wave for The New Inquisition. The
second half is new: a modifier that applies to **that** referendum and no
other.

`ReferendumFrame.voteModifiers` already existed (Absolute Tyranny's
"vampires who do not follow the Path of X get -1 vote"), carrying
`{amount, exceptPath}`. Fee Stake needs two different conditions —
`titledOnly` and `notSect` — because *"non-Anarch **titles** are worth -1
vote"* says both things: an untitled vampire has no title to devalue, and
an Anarch's is untouched. Adding them to the same array rather than
inventing a parallel one keeps the single clamp that matters: the total
is `Math.max(0, …)`, so a negative **takes votes away and never hands the
other side votes against**, exactly as the existing modifiers do.

The seeding point is `referendumSetup`, the one hook that fires as a
referendum frame is pushed, and it is guarded on `fromCardInPlay` — the
flag a card in play already uses to tell its own referendums apart from
any other bearing the same name.

Ruling noted and no-op: *"the votes provided by the Priscii
sub-referendum are not affected"* [ANK 20180307-1]. The Prisci
sub-referendum is unmodelled, so there is nothing for the exception to
carve out.

## §4 "+1 vote during referendums THEY CALL" is not a ConditionalStatic

Three of the six print a clan clause — *"while this Anarch is Toreador or
Toreador antitribu, they get +1 vote during referendums they call"*
(Boston/Toreador, New York/Brujah, Seattle/Gangrel; all three clans are
in the V5 pool, so none of this is inert).

`ConditionalStatic` was the obvious home and is the wrong one. The vote
count reads conditional statics through `conditionalStaticNoAction` —
**with no action and no referendum in hand** — so a condition of the form
"during referendums this vampire called" is unanswerable there by
construction. It is not a property of the board; it is a property of the
frame.

So it is a plain `PermanentStatics.votesWhenCalling`, read at the vote
site against `rf.callingMinion`, with the clan carried on the static
rather than in the engine — the Día de los Muertos rule from wave 21:
*the granting card's condition rides on the grant, and the engine only
asks whether it is met.* The three plain cities simply omit the field.

## §5 What the wave found

**The two compilers that put a card in play had drifted, and only one of
them could grant a title.** `putPermanentInPlay` (masters) emitted
`TitleGranted` and tagged the entry `"title"`; `attachOnSuccess`
(actions) did neither, because until now no action card granted one. This
is the `onMasterPhase` / `PermanentShuffledIntoLibrary` family shape
again, in a third guise: **two code paths that mean the same thing,
written at different times, that do not agree** — and the way to find it
is to ask what the SIBLING does, not what the doc comment says.

**A condition can be unanswerable in the layer you put it in.**
`votesWhenCalling` looks exactly like a `ConditionalStatic`, and would
have compiled as one and silently never fired: the vote count asks the
conditional layer with no action and no referendum, so the condition
would evaluate against nothing every time. A static that reads the FRAME
belongs where the frame is.
