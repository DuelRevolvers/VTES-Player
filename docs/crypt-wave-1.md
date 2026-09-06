# Crypt wave 1 — the statics

2026-09-03. The first crypt cards with working abilities, and the
structural work that makes the other three waves data.

**Crypt 33/217 supported. Counting the 118 that need no implementation at
all, 151 of 217 crypt cards now play correctly.**

---

## 1. The structure, which was the point of doing C1 first

**A crypt card is `cardType: "crypt"` and compiles to a handler with no
`options` and no `resolve`.** A vampire is never played — it is
influenced out of the uncontrolled region — so there is no window that
could offer it. Both methods are required by `CardHandler`; making them
optional would ripple through every call site for one card type, so the
crypt handler supplies an empty `options` and a `resolve` that throws.

**Its ability rides onto the vampire as a SELF-ATTACHED ENTRY**
(`CardHandler.cryptEntry`), which `makeVampire` attaches when a deck is
built. This is not a new idea — an ally's card text has worked exactly
this way since the allies gate, and a token vampire's since 2026-09-03 —
and it is the whole reason the crypt is cheap: **the entire `permanent`
vocabulary reaches crypt abilities with no second set of rules.**

Three smaller structural facts:

- **`COST_TYPES_BY_CARD_TYPE.crypt` is `[]`, and that is asserted rather
  than skipped.** Every play-cost modifier and every cancel effect names
  a printed LIBRARY type, and a vampire is never played. The
  central-queries guard now checks that a crypt handler claims none,
  instead of demanding it claim one.
- **The handler registry is name-keyed and needed no namespacing** —
  verified: no duplicate crypt names, and no crypt name collides with a
  library card.
- **A name typo is the dangerous failure here**, because the lookup is by
  name and a miss produces a vampire with silently no ability. Two new
  guards in `supported.test.ts` catch it: every crypt spec must name a
  real crypt card exactly, and every crypt spec must compile to a
  non-empty entry.

---

## 2. What the conditions needed

`ConditionalStatic` existed (Depravity, Bowl of Convergence) but carried
only `stealth`/`intercept` and only conditions about the *action*. Crypt
cards condition on three different things, so it grew three groups:

- **traits**: `bleed`, `strength`, `votes`, `handSize` alongside the two.
- **`actionDirected`**: "during directed / undirected actions" — narrower
  than `directedAtController`, which also asks *whose* action it is.
- **`actingMinion`**: a condition on who is coming at you — "against
  titled vampires" (Bret Stryker), "against younger Lasombra" (Azucena).
  `currentIntercept` already looks the actor up
  (`docs/opposing-statics-design.md`), so this cost a comparison rather
  than plumbing. **Younger/older compare DERIVED capacity**, so a granted
  point counts on both sides.
- **`controller`**: the board — pool at most N, holding the Edge,
  controlling a ready cardinal, controlling any locations, the prey's
  pool, the predator's ready minions, and the bleed target's clans.

**Every board condition is derived on each read, never settled when the
vampire enters play.** An oust rewrites who your prey is and a pool total
moves constantly — the rule `docs/retainer-wave-design.md` §1 states for
combat-scoped effects, applied again.

**`conditionalStaticNoAction` is the new sibling, and it is not a
convenience.** `handSizeOf`, combat strength and vote counting all ask
outside any action. A static carrying an action condition must contribute
**nothing** there rather than defaulting to true — so `conditionHolds`
computes whether the static `needsAction` and answers false when there is
none. Getting that backwards would have made every action-conditional
static permanently on.

Strength and votes deliberately use the no-action form: a combat can
outlive the action that started it (a rush pushes it after the frame
pops), so only board conditions are meaningful there.

---

## 3. `cannotBeBlockedBy`, and the union reading again

Rexton "Savage" Abernathy: *"Allies **and** vampires with capacity 3 or
less cannot block Rexton."*

The English "and" is a **union of two groups**, not an intersection — the
reading recorded in `docs/opposing-statics-design.md`, where the
intersection reading would have made the clause nearly inert (an ally has
no capacity to be younger *than*). Same reading here.

It is a **bar**, not a price, which is what separates it from `blockToll`
sitting beside it on Jürgen. Both are persistent statics on the ACTING
minion; one removes the option, the other charges for it.

Jürgen's toll is `payWith: "bloodOrLife"`, and the or-life half is load
bearing: p. 22 gives allies life rather than blood, so a toll printed as
"1 blood" locks them out and "1 blood or life" does not. Pinned by a test
that watches an ally take the option.

---

## 4. The 33 cards

**Flat traits (8):** Catalina Vega, Lenny Burkhead, Kamile Paukstys,
Massimiliano, Valeriya Zinovieva, Rinaldo Albizzi, Anousha, Hafthor
Thorsteinsson.

**Conditioned on the action (8):** Ariane, The Dowager, Martina
Srnankova, Oluwafunmilayo, Castellan, Verrix, Frau Schädel, Kalyani.

**Conditioned on the acting minion (3):** Bret Stryker, Azucena, Osvaldo
Kühnemann.

**Conditioned on the board (8):** Branimira, Devorah, Anxo Vilela,
Damian, Carmelita Neillson, Khin Aye, Neserian, Üresség.

**Combat grants (3):** Saku Pihlajamäki, Serhat Gunde, Abaddon — all
three are `maneuverPerCombat` / `pressPerCombat`, which already existed.

**Blocking (3):** Jürgen, Aelswith, Rexton. **Aelswith prints Terrifying
Visage's clause word for word** and cost nothing but a field name: that
static was built the day before, for a library card.

---

## 5. Deliberately left for later waves

Four cards look like statics and are not, so they wait for the wave that
owns their mechanic rather than being approximated now:

- **Adrino Manauara** — "1 press (**mandatory**) each combat, only usable
  to continue combat". `pressesContinueOnly` exists (Righteous Blade),
  but *mandatory* is not *optional*, and modelling it as a credit would
  quietly make the card better than it prints. → C3.
- **Kevin Jackson** — "+1 strength in combat with a Brujah. Brujah get +1
  strength in combat with him." The second half is an effect on the
  OPPOSING minion, which is an aura, not a static. → C3.
- **Noluthando** — "+1 damage with ranged strikes (even at close range)".
  A property of the strike, not of the minion. → C3.
- **Djeneba** — "strike cards cost the opposing minion +1 blood or life".
  A `PlayCostMod` whose `pays` union has no "blood or life" arm. → C4.

---

## 6. Next

**C2 — granted actions and unlock riders (~20 cards).** Rushes (Theo
Bell, Dafina, Barachiel, Nathaniel), library searches (Dominica, Sakhar,
Eulogio), and the "can unlock after a successful action" family
(Aaradhya, Keegan, Aline, Anja, Sakura, Sybren, Kalinda). All of it runs
on `permanent.rushGrant`, the granted-action machinery and
`onActionResolved` — which now reach crypt cards for free, because
`compileSpec` runs the clause compilers over a crypt spec exactly as it
does over any other.
