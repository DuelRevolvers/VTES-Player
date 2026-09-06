# Remaining Mechanics Roadmap

Goal: build every **reusable mechanic** the unsupported pool needs, so
the genuine **one-offs** are all that's left at the end. Current status:
**174/661 supported**. Gates 1–8 are all **IMPLEMENTED** — every
kernel-touching mechanic gate is closed; what remains is the one-off
sweep (each card a thin bespoke handler over the primitives built here).

Buckets below come from scanning the 341 unsupported library cards by the
mechanic they need (a card can need several). Ordered by value ×
dependency; each is a kernel-touching gate → design doc + owner review
before code, per the project rule.

## Gate order

1. **Combat strike effects** — ✅ **DONE** (docs/strike-effects-design.md):
   aggravated damage, `strikeDamage`, `strikeStealBlood`, strike riders,
   `onlyAfterFirstRound`. Wave: Body Flare, Walk of Flame, Theft of Vitae,
   Aid from Bats. **Follow-up still open**: first strike, destroy/steal
   weapon, "hand strikes aggravated this round" (Claws of the Dead), and
   aggravated-prevention typing (Fortitude can't prevent aggravated).

2. **Equipment & weapons** — ✅ **DONE** (docs/weapons-design.md): generic
   data-driven `weapon` shape (guns fixed-R, melee strength-based,
   aggravated, per-combat maneuver). Wave: Assault Rifle, Flamethrower,
   Ivory Bow, Femur of Toomler, Kali's Fang. **Follow-up**: weapon
   additional strike (AK-47), block-rider weapons (Sniper Rifle), vehicle
   statics, and non-weapon/bespoke equipment (Kevlar Vest, Living Manse…).

3. **Block restrictions** — ✅ **DONE** (docs/block-restrictions-design.md):
   `ActionFrame.blockRestrictions` + `blockRestriction` primitive.
   Wave: Visions of Gehenna, Seduction.

4. **On-vampire static permanents** — ✅ **DONE**
   (docs/on-vampire-statics-design.md): `attachSelf` primitive +
   `PermanentStatics.bleed/strength` + `attachOnSuccess` hook. Wave: Heart
   of the City, Preternatural Strength.

5. **Politics follow-ups** — ✅ **DONE**
   (docs/politics-followups-design.md): title-granting referendums
   (`isTitleGrant`, `TitleGranted`, `referendumSetup`) + per-clan vote
   statics (`lockGrant.perClanMinion`). Wave: Malkavian/Toreador Justicar,
   Cardinal Benediction, Power Structure. (New Carthage's global tally
   deferred.)

6. **Ballots** — ✅ **DONE** (docs/ballots-design.md): the real mechanic is
   a referendum-scoped sect vote restriction (`voteRestriction`,
   `restrictVotes`), not a parallel source. Wave: Closed Session, Private
   Audience; completed Cardinal Benediction's rider. Sabbat titles added.

7. **Frenzy** — ✅ **DONE** (docs/frenzy-design.md): frenzy keyword hook
   (`isFrenzy`) + combat restriction flags (`restrictOpponent`). Wave: Rage
   of Apedemak, Terror Frenzy.

8. **Card counters** — ✅ **DONE, infrastructure** (docs/counters-design.md):
   the shared `PermanentInPlay.counters` field + `CountersChanged` +
   enter-with-counters + add/remove ops, validated by a kernel test. The
   ~19 counter cards themselves are the one-off sweep (each accumulates/
   spends counters bespokely). Not a single clean gate — by design.

9. **Paths** (Sabbat, ~5) — explicitly last / out of current scope
   (aligns with "Sabbat Paths last" in CLAUDE.md).

## After the gates

Whatever remains (bespoke one-shot effects, unique locations with
singular abilities, counter cards) is swept individually — the "one-offs
last" phase. Each still lands with a scenario test.

## Tracking

Gate docs live beside this file (`docs/<gate>-design.md`), each marked
DRAFT → APPROVED → IMPLEMENTED. This roadmap is updated as gates close.
