# Referendums that become a table rule

Tranche 1 wave 52, 2026-09-14 (v0.10.42). Beyond Reproach (100158),
Camarilla Threat (100285), Masquerade Enforcement (101184).
Library 677 → 680.

Three political actions whose success does not do something once — it
leaves a card in play that changes a rule for **everybody**, until
somebody calls another referendum to burn it.

## §1 The shell was already there

`refPutInPlay` with no `onActor` (War of Ages) leaves the calling card in
play at seat level; `vulnerableTo` with `via: "politicalAction"` (Anarch
Revolt, and twice more in the last two waves) is "any vampire may call a
referendum to burn this card as a +1 stealth political action". Every one
of these three is that shell plus one rule, which is what makes them a
family and why the wave is cheap.

The only per-card difference in the shell is WHO may call the burn:
Masquerade Enforcement says "any **Camarilla** vampire", which is
`vulnerableTo.who.sect` and already existed.

## §2 Beyond Reproach — a bar and a penalty are one sentence

*"Primogen cannot attempt political actions and get one less vote during
political actions."*

One aura with two fields (`cannotActPolitical`, `votes: -1`) and one new
filter (`title: "primogen"`, where `titledOnly` was any title at all)
rather than two clauses, because the two halves must never disagree about
who a primogen is. The vote half needed nothing beyond the filter: the
count already clamps at zero, so -1 takes a vote away and never hands the
other side votes against.

The bar is the political sibling of `cannotHunt` — an aura that removes
an ACTION KIND rather than modifying it. `auraBlocksHunt` and
`auraBlocksPolitical` are now the same helper with a key argument,
because the hunt version had already drifted: it read `p.aura` alone and
ignored `p.auras`, the additive list New Carthage introduced, and it
checked neither `titledOnly` nor the new `title`. Writing the political
one beside it would have copied the drift.

**And the bar had to go into THREE enumerators.** Political actions are
enumerated in three places — the political card's own `options`, the
`vulnerableTo` burn action's `eligible`, and `politicalGrant` — each of
which already asked `calledPoliticalThisTurn` separately. This is exactly
the `meetsRequirements` failure the project memory records four times, so
all three were fixed in the same pass and none on faith.

The pool check was done first (§0): the V5 crypt prints **10 primogen**,
23 princes and 1 justicar, so neither this card nor Masquerade
Enforcement's "prince or justicar" gate is inert.

## §3 Camarilla Threat — a price on a phase the engine gives away

*"Each Methuselah must pay an additional pool to use a discard phase
action to discard a card."*

`tableStatic` — the helper Torpid Blood's taxes use — sums a static over
every seat's play area wherever the card sits, so "each Methuselah"
needs no iteration and no controller question. The new
`discardActionPoolTax` is read at **both** the option gate and the apply,
which is the pairing `docs/play-cost-design.md` §3 exists to insist on: a
gate and a payment that drift apart is how a player is offered an action
they cannot pay for.

The gate is `pool > tax`, not `>=`: nobody ousts themselves to discard a
card, the same reading every other optional price in the pool takes.

## §4 Masquerade Enforcement — the influence phase's first tax

*"When any Methuselah moves a vampire from uncontrolled to controlled, he
or she burns 1 additional pool."*

`influenceOutPoolTax`, on the `inf:out:<id>` option and its apply. The
influence phase had never had a price on it before — transfers are
counted, not bought — so this is the first static the influence
enumerator reads at all.

## §5 What the wave found

**A test that passed by doing nothing.** The first draft of the
Masquerade Enforcement test read `state.seats[0].uncontrolled[0]` and
bailed out if it found nothing — and `threeSeatGame` has an **empty
uncontrolled region**, so the assertion never ran and the test was green
from the first attempt. Replacing the bail-out with `expect(u)` turned it
red immediately. This is the project memory's "empty for the wrong
reason" lesson happening in the test that was written to prevent it:
**a guard clause in a test is a silent skip.** The fixture now builds its
own uncontrolled entry.

**`auraBlocksHunt` had drifted from `auraBonus` by two filters.** It read
only the singular `p.aura`, so a bar printed on a card that also carries
`auras` would not have applied, and it knew nothing of `titledOnly`. The
drift was invisible because only one card uses it. Found by trying to
write its sibling — which is the cheapest way this family of bugs ever
gets found, and an argument for writing the sibling through a shared
helper rather than beside it.
