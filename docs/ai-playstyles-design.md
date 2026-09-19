# Bot playstyles (2026-09-18)

**Status: designed, not built. Owner review before kernel code.**

Owner request, 2026-09-18. Depends on nothing; composes with every other
`ai-*-design.md` in this set, because a playstyle is a weight overlay and
each of those docs adds weights.

## 1. What was asked for

> "I wanted there to be different playstyles, or personalities, for the
> bots. Balanced, Aggressive, Defensive, and Strategic … Attach a
> playstyle to all of the precon decks that match the deck's playstyle so
> the AI playing that deck will use that playstyle. Don't label this.
> This should be a background thing. Add the ability to change their
> playstyles with a dropdown selection in the profile settings menu to
> the right of their name change bars. The playstyles should be set to
> Default, by default, which means their playstyle is whatever the deck
> they have is set to."

Four requirements, and each is separately testable:

1. four playstyles, one of them Balanced;
2. every precon carries one, chosen to match what the deck does;
3. **nothing in the UI says so** — a player never sees a deck labelled;
4. a per-bot override in Profile, defaulting to "Default" = the deck's.

## 2. Naming

The owner's list is Balanced / Aggressive / Defensive / Strategic and
asked for "your naming convention for those", which reads as:

| owner's word | name used here |
| --- | --- |
| Balanced | **Balanced** |
| Aggressive | **Bruiser** |
| Defensive | **Turtle** |
| Strategic | **Politician** |

**DECIDED (owner, 2026-09-18): Balanced / Bruiser / Turtle /
Politician.** These are the stored settings values (`"balanced"`,
`"bruiser"`, `"turtle"`, `"politician"`) and the dropdown labels, and
they are now fixed — a later rename means migrating a stored blob.

The wart that was flagged and accepted with the names: **"Bruiser"
implies combat, and §5 shows the bucket also holds stealth-bleed decks
that never fight.** That is a naming imprecision, not a behavioural one —
the style means *aggressive*, and §3 defines it as pressure over safety
rather than as punching.

## 3. What a playstyle IS

**A `Partial<Weights>` overlay on `DEFAULT_WEIGHTS`. Nothing else.**

```ts
export type Playstyle = "balanced" | "bruiser" | "turtle" | "politician";
export const PLAYSTYLES: Record<Playstyle, Partial<Weights>>;
```

Three reasons this shape and not a subclass per style:

- `HeuristicAgent` already takes `weights?: Partial<Weights>` and merges
  over the defaults. The seam exists; this uses it.
- The whole weight table is **documented as the thing to be argued with**
  ("in one place so it can be read, argued with and tuned without reading
  the code"). Styles are arguments in that same vocabulary.
- It makes every style measurable by the existing bench, because
  `PolicySpec.make` is exactly "an agent from a seed" and a style is a
  closure over weights. **A style that cannot be benched is a style
  nobody can tell is working.**

`balanced` is `{}` — the current defaults, unchanged. That matters: it
means shipping this feature changes *nothing* for any bot until a deck or
a dropdown says otherwise, so the existing baseline stays comparable.

### The four, as intentions

Stated as what each cares about, because the actual numbers are a tuning
exercise that belongs in the build pass, not in a doc that would then be
stale:

- **Balanced** — the tuned defaults, four rounds of measurement deep
  (`richer-options-design.md` §5–§8). The control.
- **Bruiser** — pressure over safety: bleeds harder, presses combat,
  blocks less, spends blood freely, less cautious about `blockOutmatched`.
- **Turtle** — the board over the clock: blocks more readily, values
  keeping minions unlocked and alive, hunts sooner, more conservative
  with pool.
- **Politician** — the referendum over the bleed: values calling and
  winning votes, and is the style that most needs the politics stack to
  exist at all. **Until `ai-vote-scoring-design.md` lands, a Politician
  bot has almost nothing to be good at** — see §8.

## 4. Where a deck's style lives

**Not in `src/cards/registry.json`.** That file is generated and must
never be hand-edited, and a precon record is `{set, name, cards}` — card
data, which a playstyle is not.

**`config/deck-playstyles.json`**, hand-maintained, keyed by the same
identity `DeckSource` already uses:

```json
{
  "Fifth Edition|Toreador": "politician",
  "Fifth Edition (Anarch)|Brujah": "bruiser"
}
```

Read directly by the UI, not folded into the registry by
`scripts/build-registry.mts`. Three reasons:

- a playstyle is an **AI concern**, and the engine is pure (principle 1);
- re-tuning a deck's style should not require `npm run cards:registry`;
- **it must answer for decks that are not precons at all** — a pasted or
  imported deck has no registry entry, and the lookup has to be TOTAL.
  Unknown key falls back to `balanced`, never to undefined.

## 5. The assignment, derived rather than guessed

Computed from each precon's library composition — the share of Political
Action, Combat, Reaction and Action Modifier cards:

```
politician  if political      >= 13%
turtle      else if reaction  >= 29%
bruiser     else if combat    >= 27% or modifiers >= 30%
balanced    otherwise
```

Giving **6 politician, 13 bruiser, 7 turtle, 6 balanced**:

| precon | pol% | com% | rea% | mod% | style |
| --- | --- | --- | --- | --- | --- |
| Fifth Edition / Toreador | 22 | 18 | 10 | 39 | politician |
| Sabbat V5 / Path of Power and the Inner Voice | 19 | 8 | 17 | 34 | politician |
| New Blood / Malkavian | 18 | 4 | 18 | 33 | politician |
| Fifth Edition / Ventrue | 17 | 13 | 18 | 22 | politician |
| New Blood / Toreador | 16 | 20 | 20 | 24 | politician |
| Fifth Edition / Lasombra | 13 | 10 | 23 | 34 | politician |
| Fifth Edition (Anarch) / Banu Haqim | 3 | 51 | 16 | 10 | bruiser |
| Sabbat V5 / Path of Caine | 0 | 47 | 16 | 0 | bruiser |
| New Blood III / Lasombra | 6 | 46 | 17 | 0 | bruiser |
| Fifth Edition (Anarch) / Brujah | 0 | 44 | 16 | 3 | bruiser |
| New Blood II / Banu Haqim | 8 | 40 | 13 | 13 | bruiser |
| New Blood III / Salubri | 0 | 33 | 19 | 10 | bruiser |
| New Blood / Nosferatu | 0 | 29 | 24 | 8 | bruiser |
| New Blood III / Ravnos | 0 | 29 | 21 | 10 | bruiser |
| New Blood II / Brujah | 10 | 27 | 19 | 0 | bruiser |
| Fifth Edition / Malkavian | 0 | 5 | 26 | 39 | bruiser |
| Fifth Edition (Anarch) / Ministry | 0 | 17 | 12 | 39 | bruiser |
| Sabbat V5 / Path of Cathari | 0 | 14 | 18 | 38 | bruiser |
| New Blood II / Ministry | 8 | 17 | 17 | 31 | bruiser |
| Fifth Edition (Anarch) / Gangrel | 0 | 21 | 35 | 8 | turtle |
| Fifth Edition / Nosferatu | 0 | 23 | 32 | 5 | turtle |
| Fifth Edition (Companion) / Ravnos | 0 | 16 | 31 | 25 | turtle |
| New Blood / Tremere | 0 | 29 | 31 | 8 | turtle |
| Fifth Edition (Companion) / Tzimisce | 0 | 19 | 30 | 19 | turtle |
| Fifth Edition / Tremere | 0 | 18 | 29 | 16 | turtle |
| New Blood II / Gangrel | 0 | 23 | 29 | 13 | turtle |
| Fifth Edition / Hecata | 0 | 10 | 19 | 26 | balanced |
| Fifth Edition (Companion) / Salubri | 0 | 19 | 27 | 23 | balanced |
| New Blood / Ventrue | 0 | 16 | 18 | 22 | balanced |
| New Blood III / Hecata | 0 | 13 | 21 | 21 | balanced |
| New Blood III / Tzimisce | 0 | 17 | 21 | 23 | balanced |
| Sabbat V5 / Path of Death | 0 | 17 | 14 | 19 | balanced |

**The thresholds are a starting point, and the table is the artefact.**
The rule produced the table once; the table is then hand-maintained,
because a threshold that is right for 30 decks will be wrong for two and
arguing with a config row is easier than arguing with a formula.

**The honest wart:** `bruiser` holds 13 decks because it is doing two
jobs. Banu Haqim Anarch at 51% combat and Fifth Edition Malkavian at 5%
combat and 39% modifiers are both "aggressive" and play nothing alike —
one punches, one bleeds through stealth. Four buckets do not partition
VTES cleanly, and a fifth ("Bleeder") would split that bucket honestly.
The owner asked for four; this notes the seam rather than hiding it.

## 6. Which style a bot actually uses

```
effective(seat) =
  settings.botPlaystyles[i] !== "default"
    ? settings.botPlaystyles[i]            // the Profile override
    : deckPlaystyle(seat.deck)             // the deck's, from config
    ?? "balanced"                          // total fallback
```

**THIS MUST LIVE IN EXACTLY ONE FUNCTION.** `HeuristicAgent` is
constructed in **five** places today — `src/ui/loop.ts` (three) and
`src/ui/shell.ts` (two) — each spelled `new HeuristicAgent({ seed:
seatSeed(seat) })`. Five copies of a two-branch rule is the
"one question asked in two places will drift" lesson with four extra
chances to drift.

So: one factory, `botAgentFor(seat, deck, settings)`, and **all five
sites re-pointed at it**. The factory is where the seed and the weights
are decided together; nothing else constructs a bot.

This is also the change that makes the whole feature reviewable: if a bot
somewhere plays with default weights after this lands, it is because a
sixth construction site was added, and a test can assert there are none.

## 7. The Profile dropdown

In `botNamesPanel()` in `src/ui/shell.ts`, which already renders
`MAX_BOT_NAMES` (5) rows of:

```html
<label class="field botnamerow">
  <span>Bot 1</span>
  <input class="botname" data-bot="1" … />
</label>
```

Add a `<select class="botstyle" data-bot="1">` **after the input**, which
is "to the right" given `.botnamerow` is already `flex-direction: row`.
The input is `flex: 1 1 auto`; the select takes `flex: 0 0 auto` so the
name field keeps the stretch and the dropdown does not jump width between
rows.

Options, in this order: **Default**, Balanced, Bruiser, Turtle,
Politician. "Default" is the stored value `"default"`, not an empty
string — an unset value and a chosen "Default" must be the same thing,
which is the same reasoning `botNames` uses for empty strings.

Persistence mirrors `botNames` exactly, because it is the same kind of
data and should not invent a second pattern:

- `UiSettings.botPlaystyles: string[]`, positional, bot seat 1 is index 0;
- `DEFAULT_SETTINGS.botPlaystyles: []`, empty rather than five
  `"default"` strings;
- a `cleanBotPlaystyles` sanitiser beside `cleanBotNames`, dropping
  anything not in the union — **a stored settings blob is untrusted
  input**, and an unknown style must read as `"default"`, not throw;
- saved and reset by the existing **Save names** / **Reset** buttons.
  Two save buttons in one panel would be a worse UI than one that saves
  the row.

### The note in that panel is now wrong

The panel currently ends with:

> "A bot's name decides how it plays: the AI is seeded from it, so 'Bea'
> makes the same choices in the same spots every game, and renaming a bot
> gives it a different personality."

That describes the **tie-break seed**, and once a real playstyle exists
the sentence is actively misleading — a player who reads it will rename a
bot expecting a personality change and get a different coin flow. It must
be reworded in the same pass: the name still fixes the seed; the
dropdown is what decides how it plays.

**A feature that cannot be discovered is indistinguishable from one that
is absent**, and this panel is the only place the feature is visible.

## 8. "Don't label this"

Requirement 3, and it has teeth:

- **No style shown in the deck chooser**, the lobby, the table, the game
  log or a saved game's summary.
- The dropdown is the **only** place the four words appear.
- A test should assert it: render the deck panel and the table view for a
  precon with a non-balanced style and assert none of the four style
  names appears in the output. That is a cheap negative-space test and it
  is the only thing that stops a later UI pass from helpfully surfacing
  it.

## 9. Determinism, multiplayer, saves

- **Determinism is unaffected** and must stay so: the style changes
  *weights*, never the RNG. The seed stays `seatSeed(seat)`. A test
  should assert two agents with the same seed and the same style make
  identical choices, and that changing the style does not change the
  number of RNG draws in a decision — a style that perturbs the stream
  would make replays a lie (principle 2).
- **Multiplayer:** playstyles are a local-machine setting like `autoPass`
  and `aiSeats`, not part of a room. Bots run on the host, so the host's
  settings decide, which is already true of `aiDelayMs`. Nothing crosses
  the wire.
- **Saved games record each bot's playstyle. DECIDED (owner,
  2026-09-18).** Details in §9.1, because the shape is not obvious.

### 9.1 What a save carries, and why it is allowed to

`SavedGame` lives in `src/ui/history.ts` and already carries
`botSeats?: string[]` — with a comment making a careful argument that it
does **not** break the rule that a save carries no preferences:

> that rule is about REPLAY, and it still holds — the answers are all in
> `commands`, so this game replays identically whoever is handed the
> seats afterwards. What it fixes is a game coming back UNPLAYABLE.

**A playstyle passes the same test, for the same reason.** The commands
already played replay identically regardless; what the playstyle affects
is the decisions the bot makes *from here*. Without it, loading a save
resumes a different game with the same board — which is the continuity
problem `botSeats` was added to solve, one step further in.

The shape:

```ts
/** How each bot seat was playing. Keyed by SEAT ID, not positional —
 *  the Profile panel's list is "Bot 1…5" slots, a save knows real seats. */
botPlaystyles?: Record<string, Playstyle>;
```

Four rules that fall out of the existing file and should not be
re-derived later:

- **Optional, and `version` stays 1.** `botSeats` set the precedent: a
  save written before the field simply does not have it. Bumping the
  version would reject every existing save for no reason.
- **An absent field falls back to the deck's style**, which is exactly
  the `"default"` behaviour of §6 — so an old save loads as the right
  thing without a special case. This is the rare occasion where the
  backwards-compatible path and the correct path are the same path.
- **`isSavedGame` must validate it**, beside the `botSeats` check, and
  must reject unknown style strings rather than trusting them — a save
  file is untrusted input, and it is the one that arrives attached to a
  bug report.
- **The loader says what it assumed**, as the `botSeats` loader already
  does, rather than silently picking.

## 9.2 BUILT, 2026-09-19 (platform 0.10.76)

Everything in §3–§9 shipped. What is worth recording is where the build
differed from the design, and one thing the design did not anticipate.

- **`src/ai/playstyles.ts`** — the four overlays. `balanced` is `{}`, so
  the feature ships inert and the measured baseline stays comparable.
- **`config/deck-playstyles.json`** — 32 precons, generated once from the
  §5 rule and hand-owned thereafter. 6 politician, 13 bruiser, 7 turtle,
  6 balanced.
- **`src/ui/botagent.ts`** — THE one place a bot is built. All five
  construction sites (three in `loop.ts`, two in `shell.ts`) call it; a
  grep for `new HeuristicAgent` in `src/ui/` now returns nothing.
- **`UiSettings.botPlaystyles`** plus `cleanBotPlaystyles`, positional and
  sanitised the way `botNames` is.
- **The Profile dropdown**, to the right of each name box, saving and
  resetting with the row rather than with a second button.
- **`SavedGame.botPlaystyles`**, keyed by seat, optional, `version`
  unchanged, rejected by `isSavedGame` if it names a style this build
  does not know.

### The style rides on the AGENT, which §9.1 did not say

The save is written by `LocalTransport.snapshot()`, which holds the
agents and nothing else — there was no path from a seat to the style it
had been built with. The options were a parallel map keyed by seat, which
is a second thing to keep in step with `setAgent` and would go out of
step the first time a seat was handed back to a human, or stamping the
style on the agent itself. The agent won: `botAgentFor` returns a
`StyledAgent`, and `playstyleOf` reads it back.

### The note under the name boxes was wrong and is now two notes

It claimed "a bot's name decides how it plays … renaming a bot gives it a
different personality", which described the tie-break SEED. With real
playstyles that sentence would send a player to the wrong control. It now
says the name fixes a bot's luck and the dropdown decides how it plays.

### §11.3 answered itself

"Should Politician ship before the politics stack?" — the politics stack
(items 0–5 and 9) was built first, so a Politician bot now has a real
competence to be named for: it votes on the referendum's actual terms,
aims its own, and declines to pay into settled ones.

### What is NOT claimed

**No strength measurement.** Each style is a coherent argument in the
weight vocabulary, and none has been benched against another. The bench
takes a `PolicySpec.make`, so a style is one line away from being
measured — that is the point of shipping them as weights — but it has not
been done, and a style that plays worse would currently be invisible.

## 9.3 SIX STYLES, 2026-09-19 (platform 0.10.80)

The §5 assignment was made from CARD TYPES, which was the crude proxy
available at the time. Re-doing it from what each card actually **does**
— the effect families the summariser already computes — showed the four
buckets were hiding two clusters.

### Stalker: seven decks, not one

§2 flagged that "Bruiser" was doing two jobs. The measurement says how
badly. Sorting the precons by stealth:

| deck | bleed | stealth |
| --- | --- | --- |
| Fifth Edition / Malkavian | 34 | **52** |
| Fifth Edition (Anarch) / Ministry | 35 | **49** |
| Fifth Edition / Tremere | 23 | 34 |
| New Blood / Malkavian | 20 | 33 |
| New Blood II / Ministry | 17 | 33 |
| Sabbat V5 / Path of Cathari | 25 | 31 |
| New Blood / Ventrue | 29 | 29 |

**High bleed AND high stealth is a distinct, populated cluster.**
Sneaking a bleed past a blocker and punching somebody are opposite
skills, and one weight set cannot want both — a bruiser presses combat
and trades minions, where a stalker wants its vampire unlocked, alive and
unblocked.

### Builder: the one nobody predicted

Six precons are mostly PERMANENTS rather than bleed, combat or votes:

| deck | board | bleed |
| --- | --- | --- |
| New Blood III / Tzimisce | **44** | 8 |
| Fifth Edition / Hecata | **43** | 16 |
| Sabbat V5 / Path of Caine | **39** | 8 |
| New Blood III / Hecata | **38** | 13 |
| Fifth Edition (Companion) / Tzimisce | **36** | 13 |
| New Blood / Nosferatu | **33** | 12 |

They were scattered across three styles, none of which describes them.

**Builder is also a probe at a defect affecting every bot.** A permanent
is scored at a flat `playCard` and a bleed at six times that, which is
why no bot ever employs a retainer
(`ai-politics-bench-design.md` §7.3). Builder is the one style that
*should*, and raising it inside a style is the safe place to find out
whether it helps before touching the default for everyone.

### What was checked and is NOT a cluster

**Economy** (pool gain/drain) — two or three decks lean that way and none
strongly. **Damage prevention** — a trait inside combat decks rather than
a style. Both were measured and rejected rather than assumed away.

### The assignment now

`builder 5, bruiser 10, stalker 6, politician 5, turtle 3, balanced 3`,
from a six-way rule that reads the effect families and puts the most
distinctive claim first. **Two decks were then corrected by hand** — New
Blood II Ministry and New Blood Ventrue both fell a rounding hair short
of the stalker threshold and are plainly stealth-bleed decks. That is
what "hand-maintained" in the config comment means, and the first time it
has been exercised.

**Still no strength measurement.** Six coherent arguments; none benched
against another.

## 9.4 BENCHED, 2026-09-19 (platform 0.10.81) — NO STYLE BEATS THE DEFAULT

`npm run bench --style <name>` and `--against-style <name>` were added,
which is the line §9.2 promised a style was away from being measurable.

**Control first:** default vs default, 120 games — gap **0.000 VP** on a
margin of ±0.268. The instrument is not measuring itself.

### Each style on a deck it is assigned to, against the tuned default

240 games each (60 deals × 4 rotations):

| style | deck | gap vs default | margin |
| --- | --- | --- | --- |
| stalker | Fifth Edition Malkavian | −0.021 | ±0.191 |
| turtle | Anarch Gangrel | −0.037 | ±0.193 |
| politician | Fifth Edition Toreador | −0.063 | ±0.191 |
| bruiser | Anarch Brujah | −0.100 | ±0.200 |
| builder | Fifth Edition Hecata | −0.125 | ±0.196 |

**Not one is outside its margin, and ALL FIVE ARE NEGATIVE.** Individually
each says "no difference proven". Collectively, five of five falling the
same side of zero is a weak signal worth writing down rather than
rounding away: the styles are, if anything, slightly *worse* than the
default. That is unsurprising — the default is four rounds of measurement
deep (`richer-options-design.md` §5–§8) and each style is a hand-written
argument that has never been tuned.

Style against style is the same story: stalker vs bruiser −0.037,
builder vs turtle −0.029, politician vs bruiser +0.004, all inside ±0.20.

### What the styles DO change: behaviour, measurably

Builder was built partly to probe the "no bot ever plays a permanent"
defect. It does what it was built to do — all seats one style, 30 games
per deck:

| deck | style | board plays | permanents on the table (avg) |
| --- | --- | --- | --- |
| Hecata | balanced | 305 | 5.7 |
| Hecata | **builder** | **430** | **7.0** |
| Hecata | turtle | 286 | 5.7 |
| Gangrel | balanced | 168 | 3.6 |
| Gangrel | **builder** | **270** | **5.2** |
| Gangrel | turtle | 168 | 3.6 |

**+41% and +61% more permanents played; a quarter to a half more board on
the table.** The styles are not inert — they visibly change how a game
looks, which is what a *feel* feature is for.

### THE FINDING THAT CORRECTS AN EARLIER CLAIM

`ai-politics-bench-design.md` §7.3 called "the policy never plays its
defensive permanents" a POLICY PROBLEM and the strongest candidate item
on the list. **This experiment argues against that.** Builder plays
substantially more permanents and does not win more — the extra board
bought nothing measurable.

That does not prove the low valuation is right; a mirror match makes
defence symmetric, Builder moves several weights at once, and a quarter
more board may simply be too small a change. But it does mean the
defect was asserted and is now contested by evidence, and it should not
be built on the strength of the original claim alone.

## 10. Tests

- `PLAYSTYLES.balanced` is `{}`, and a bot built with it is
  **byte-identical in behaviour** to today's — a regression guard on the
  whole existing baseline.
- The resolution rule, all four branches: override set; override
  `"default"` with a precon deck; override `"default"` with a **pasted**
  deck (falls back to balanced); unknown precon key.
- **The config is total over every shipped precon:** walk
  `registry.precons` and assert each has a row in
  `config/deck-playstyles.json`. This is the test that keeps the table
  honest when a precon is added — and it is the "a set derived from the
  registry has to name its card KIND" lesson: this walks *precons*, not
  cards.
- **One factory:** a test asserting no `new HeuristicAgent(` outside
  `botAgentFor` and the test tree. Crude, and it is the only thing that
  catches a sixth construction site.
- The §8 no-label assertion.
- `tests/ui/version.test.ts` and the settings round-trip: save, reload,
  same values; and a corrupted `botPlaystyles` in storage reads as
  defaults rather than throwing.

## 11. Owner decisions, and what is left

**Decided 2026-09-18:**

1. **The names** (§2) — Balanced / Bruiser / Turtle / Politician.
2. **Saves remember each bot's playstyle** (§9.1).

**Still open:**

3. **Should Politician ship before the politics stack?** A Politician bot
   today differs from Balanced only in how eagerly it takes political
   *actions* — it still votes yes to everything
   (`ai-vote-scoring-design.md` §1). It would be a style that is named for
   a competence it does not have. Shipping the dropdown with four styles
   and a Politician that is thin is defensible; so is holding Politician
   until voting works. Worth deciding deliberately rather than
   discovering.
