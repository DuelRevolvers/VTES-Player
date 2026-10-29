# Granted-action requirements — design

**Status: BUILT in 0.11.54** (owner review 2026-10-27; answers in §8,
what building changed in §9).
Raised by `docs/marked-vampires-design.md` §8 (wave 111), which this
corrects in two places (§2).

## 0. The rulings

- **[LSJ 20080604]**, on 79 cards including The Gate of Acheron, Open War
  and Contract: the action a card provides is "considered to be an action
  requiring the listed clan/sect/capacity/title". Its examples: Open War's
  action requires an Anarch, The Gate of Acheron's requires Hecata.
- **[LSJ 20080603]**, on Open War: the card counts as requiring an Anarch,
  "for eg. Powerbase: Los Angeles".
- **p. 39:** "Baron is a title that can only be held by an Anarch", and only
  Camarilla vampires can hold primogen, prince, justicar and Inner Circle.
  Independent votes "are not tied to a sect".
- **p. 24:** a political action is a type of action, whatever provided it.

No card text contradicts any of these, so the Golden Rule (p. 16) does not
come into it.

## 1. The reading: the requirement belongs to the GRANT, not the card

"The listed clan/sect/capacity/title" is the list in the grant's own
sentence: who may take the action. It is not the card's clan icon and not
the card's play requirement. Three cards show the difference:

| Card | Card's requirement | Grant | Action requires |
|---|---|---|---|
| The Gate of Acheron | Hecata icon | "Hecata you control with capacity 4 or more can add 1 counter" | Hecata, capacity 4+ |
| The Gate of Acheron | Hecata icon | "Vampires can burn this card" | nothing |
| Open War | "Requires a baron" | "Anarchs can enter combat with a minion" | an Anarch |
| Contract | none | "The chosen Assamite can enter combat" | Banu Haqim |
| Archon | none | "The attached vampire can enter combat" | nothing |

So `marked-vampires-design.md` §8's phrase "requiring its card's clan" is
wrong. Reading the icon would make a Ventrue burning The Gate of Acheron
count as an action requiring Hecata.

The ruling names four kinds of requirement. Words in the same sentence
that are not one of the four confer nothing: "you control", "ready",
"younger", "controlled by other Methuselahs", "Changeling allies" (a card
type).

## 2. What the pool can observe

**Readers of "an action requiring <clan>"**, from the supported cards'
text:

- Cappadocian Crypt: Hecata or Oblivion, after a successful action.
- "Mother" Anja Giovanni (G6): Hecata or Oblivion, after another Hecata's
  successful action.
- Keegan (G6): a Gangrel, after his own successful action.

Sakura, The Merciless (G6) reads a Path, which is printed on the crypt card
and is already answered from the actor (`docs/path-cards-design.md` §0).
**No supported card reads an action requiring a sect, capacity or title.**

**Grants that list a clan someone reads:** The Gate of Acheron (spec,
`counterGrant`) and Pit of Contemplation (bespoke handler) both list
Hecata. No grant in the pool lists Gangrel.

So the observable defect is four pairs: {Gate of Acheron, Pit of
Contemplation} × {Cappadocian Crypt, Mother Anja}. Today none of the four
offers its payoff.

**Corrections to §8 of the wave 111 doc.** It said "four readers ask about
Hecata". Four specs NAME Hecata, but Roger de Camden's discount asks about
a card being PLAYED and Hel-Blá's revive asks about an ALLY card. Two
readers ask about an action. And §8 missed Pit of Contemplation, the
second grant.

## 3. Design

### 3.1 The record

Add `requires?: { clans: string[] }` to `ActionFrame.grantedEffect`.
`announceEntryAction` takes a matching `args.requires` and copies it in.
It goes on the frame because the answer differs by grant KEY within one
card (The Gate of Acheron, §1), and the frame already holds the key (the
`isMaster` lesson: denormalize what a handler lookup cannot answer).

### 3.2 Where each grant gets it

- **Spec-compiled grants derive it from their own `who` filter**, through
  one helper, `grantRequirement(who)`, which reads only the filter's
  `clan`. The filter that decides who may act and the requirement that
  acting confers then cannot disagree.
- **Bespoke grants pass it by hand**: Pit of Contemplation, Contract,
  Priority Contract, Saulot's Avenging Fist, Saulot's Healing Touch, Week
  of Nightmares, Veneficorum Artum Sanguis, Artistically Inept, Cave of
  Apples, and any others the walk finds.
- **The walk is over the 17 call sites of `announceEntryAction`, read
  against each card's text**, not over the ruling's card list. A grant can
  list a clan without the ruling being attached to it.

### 3.3 The one read

`actionRequiresClans(af, registry)` in `derived.ts` answers "which clans
does this action require" for every action:

- An action announced with a card: the card's `requiresClans()`.
- A granted action: `grantedEffect.requires.clans`.
- Anything else: none.

Re-point both readers to it:

- `unlockAfterAction` in `compile.ts` (Keegan, Mother Anja). Its
  `if (!card) return` guard splits: the clan test goes through the helper,
  while the card-type and discipline tests still need a card, because a
  grant lists neither.
- `afterActionBlood` in `compile.ts` (Cappadocian Crypt).

### 3.4 Scope: clans only

Sect, capacity and title have no reader in the pool (§2). A field no
reader asks about is a partial card no test can see, so this records
clans only. The day a card reads "an action requiring an Anarch", the
record and `grantRequirement` each gain one field. Question 1 asks whether
you want all four now instead.

## 4. Related gap A: a granted political action is not political

`af.political` is set only for a political action card played from hand
(`engine.ts`, the `isPoliticalAction` stamp). `announceEntryAction`
receives `args.political` and records the once-per-turn use on the minion,
but never sets the frame's flag. Every reader asks about the card or the
flag, so a granted political action looks like a plain action (p. 24):

- **Aaradhya, The Callous Tyrant (G6)**, a Sabbat cardinal, unlocks after a
  successful political action. Black Forest Base grants "a Sabbat vampire
  can call a referendum … as a +1 stealth political action". Missed.
- **Oluwafunmilayo (G6)** gets +1 intercept against a political action.
  Missed against Black Forest Base, Elysium: The Arboretum, Masquerade
  Enforcement, The New Inquisition and Archon's burn referendum.
- **The AI's `view.action.political`** reads the same flag, so a bot treats
  those five as plain actions when deciding whether to block
  (`ai-block-action-value-design.md`).

**Fix:** `announceEntryAction` stamps `political: true` on the frame. The
`politicalAction` card type in `actionCardTypes` is read through one helper
that asks `af.political` instead of the card's printed type. Both readers
(`unlockAfterAction`, the conditional crypt statics in `derived.ts`) use
it.

## 5. Related gap B: a card requiring a baron does not require an Anarch

Open War, Bait and Switch, Revolutionary Council and Childe of the
Revolution declare `requiresTitle: ["baron"]` and no sect. Two readers ask
for "a card requiring an Anarch" and miss all four:

- **Powerbase: Los Angeles** unlocks a ready Anarch after its extra
  discard. It reads `spec.requiresSect` directly (`cards.ts`), bypassing
  the central `requiresSects` query.
- **Garibaldi-Meucci Museum** exchanges a card requiring an Anarch from
  the ash heap, through the central query.

**Fix:** the central `requiresSects()` (`compile.ts`) adds the sect each
required title implies, from one table read off p. 39. Powerbase: Los
Angeles moves to the central query. The play gate needs no change: it
already checks the title, and only an Anarch can hold it.

One side effect is visible and correct: the Deck Builder's sect filter
reads the same query, so those four cards will show as needing an Anarch.

Question 3 asks how much of the p. 39 table to build.

## 6. Tests

Each gap gets positives and the negative space beside them.

**§3, granted requirements:**

- The Gate of Acheron's counter action by a capacity-4 Hecata succeeds:
  Cappadocian Crypt and Mother Anja are both offered.
- The same for Pit of Contemplation.
- The Gate of Acheron's BURN action by a Hecata succeeds: neither is
  offered. This is the test that pins §1, the grant rather than the icon.
- The counter action is blocked: neither is offered (both print
  "successful").
- Keegan has no positive to build, because no grant lists Gangrel. Instead
  of a guard clause, a test asserts that no supported grant lists Gangrel,
  so admitting one fails it and asks for the positive.

**§4, political grants:**

- Aaradhya calls Black Forest Base's referendum and the action succeeds:
  her unlock is offered.
- Oluwafunmilayo blocking Masquerade Enforcement's action gets +1
  intercept.
- The Gate of Acheron's counter action: neither applies.

**§5, barons:**

- Powerbase: Los Angeles discards Open War: the Anarch unlock is offered.
- Garibaldi-Meucci Museum offers Open War from the ash heap.
- A card requiring neither (a plain action card): neither is offered.

## 7. Build order and version

One build pass, one version bump (0.11.54), with the usual four checks plus
`simulate:politics`, because §4 changes political actions.

## 8. Questions for the owner

1. **Record clans only (§3.4), or all four kinds the ruling names?** I
   recommend clans only: sect, capacity and title have no reader to test
   against.
2. **Build §4 and §5 in the same pass?** I recommend yes. Each has
   observable cards in the pool today, and §4 shares §3's cause (`af.card`
   is null for a granted action).
3. **For §5, baron only, or the whole p. 39 table?** I recommend the whole
   table (baron → Anarch; primogen, prince, justicar, Inner Circle →
   Camarilla). It is rulebook fact rather than per-card data, and a test
   can pin it over every titled card in the pool. Only baron has a reader
   today.

**Owner answers (2026-10-27):** 1, clans only. 2, the same pass. 3, the
whole p. 39 table.

## 9. What building changed

- **The record is `ActionFrame.grantRequires`, not
  `grantedEffect.requires`.** A rush grant (Contract, Open War) has a null
  `grantedEffect`, so §3.1's placement could not hold its requirement.
- **Mother Anja's two lists became a union.** `unlockAfterAction` tested
  "requiring Hecata OR Oblivion" as two gates, so she fired only for a
  card requiring both. §6's Anja positive could not pass without the fix,
  and the card text is not ambiguous. Pinned by an Umbrous Clutch test.
- **Rebel is a third §4 reader.** "If they block … a political action"
  read the played card's type; it now reads `af.political`.
- **The table covers all ten titles**, Sabbat included (p. 40), as a
  `Record<VampireTitle, Sect>` named `TITLE_SECT` in `state.ts`.
- **§5's Deck Builder side effect does not happen.** The catalogue parses
  sect requirements from card text (`scripts/build-catalog.mts`), not
  from `requiresSects`. Left as a follow-up.
- **Bespoke grants that pass `requires` by hand:** Pit of Contemplation
  (Hecata), Cave of Apples (Ministry), Week of Nightmares (Ravnos),
  Saulot's Healing Touch (Salubri). Spec grants derive it from `who.clan`
  in five compilers: counter, bleed, rush, political and the
  `vulnerableTo` burn.
- **Tests:** `tests/cards/granted-action-requirements.test.ts`, 17 tests.
  Against the unfixed source, the 11 positives fail and the 6 negatives
  pass.
