# Precon bundles — planning the remaining legacy decks

> Planning doc, 2026-11-25. **A REPORT: it admits nothing and opens no clan.**
> The counts come from a one-off scan of `data/vtes-raw.json` against
> `src/cards/registry.json` after wave 119 (0.11.69). They go stale with
> every wave, so re-derive them before you act on one (§5).

## 1. The idea

Forty-four legacy precons are below 100%. Many of them share missing cards,
because one clan appears in several products (Sabbat War, Black Hand, Third
Edition and the Starter Kits reuse the same vampires and the same clan
cards). Building those decks one at a time builds the shared cards once and
then finds them already done; building them as a **bundle** plans the shared
cards up front and opens the clan's crypt groups **once**, with one owner
approval, instead of once per deck.

A bundle is still a **series of waves**. Each wave stays 3–6 cards sharing a
mechanic (the binding rule in `CLAUDE.md`). The bundle only decides which
decks the waves aim at, and in which order.

## 2. The bundles

"Distinct" is the number of different cards the bundle needs. "Deck by deck"
is the sum of each deck's own missing list, which counts a shared card once
per deck. The difference is the saving from planning the decks together.

| Bundle | Decks | Distinct | Deck by deck | Crypt with an ability | Library | Clan opening needed | New discipline |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| A. Keepers of Tradition Toreador + Ventrue | 2 | 14 | 14 | 6 | 8 | none (Toreador and Ventrue 4–5 are open) | none |
| B. Tremere antitribu | 4 | 42 | 55 | 14 | 17 | Tremere antitribu 2–4 | none |
| C. Brujah antitribu | 3 | 40 | 49 | 14 | 20 | Brujah antitribu 2–4 | none |
| D. Brujah (Camarilla) | 2 | 35 | 37 | 13 | 16 | Brujah 2–4 | none |
| E. Tzimisce | 4 | 58 | 91 | 18 | 32 | Tzimisce 2–5 | none (Vicissitude is in the pool) |
| F. Malkavian and Dementation | 5 | 66 | 95 | 19 | 35 | Malkavian 4–5, Malkavian antitribu 2–4 | Dementation |
| G. Lasombra and Obtenebration | 3 | 68 | 78 | 20 | 40 | Lasombra 2, 4, 5; Pander 2; Kiasyd 4 | Obtenebration, Mytherceria |
| H. Anarchs | 3 | 60 | 62 | 24 | 25 | group 3 of nine clans | none |

The decks in each bundle:

- **A:** Keepers of Tradition Toreador (82%), Keepers of Tradition Ventrue (75%).
- **B:** Starter Kit Tremere antitribu (84%), Third Edition Tremere antitribu
  (79%), Pact with Nephandi (72%), Black Hand Tremere antitribu (69%).
- **C:** Starter Kit Brujah antitribu (78%), Sabbat War Brujah antitribu
  (75%), Third Edition Brujah antitribu (70%).
- **D:** Camarilla Edition Brujah (73%), Keepers of Tradition Brujah (70%).
- **E:** Den of Fiends (58%), Sabbat War Tzimisce (56%), Starter Kit
  Tzimisce (50%), Third Edition Tzimisce (46%).
- **F:** Starter Kit Malkavian antitribu (60%), Third Edition Malkavian
  antitribu (56%), First Blood Malkavian (51%), Black Hand Malkavian
  antitribu (51%), Keepers of Tradition Malkavian (48%).
- **G:** Parliament of Shadows (57%), Sabbat War Lasombra (53%), Heirs to
  the Blood Kiasyd (39%).
- **H:** Anarch Barons (69%), Anarch Gang (61%), Anarchs Gangrel (74%).

Bundles A and D could be one "Keepers of Tradition" bundle, but D needs
Brujah opened and A needs nothing, so they are kept apart.

## 3. A cross-bundle commons wave

Ten library cards are missing from four or five decks each, across bundles:
Trap, Rötschreck, Mighty Grapple, Drawing Out the Beast, Amaranth, Secret
Horde, Increased Strength, Psyche!, Superior Mettle and Wolf Companion. All
ten are tranche T1 or T2 (no legacy discipline), so **they need no clan
opening**, and together they appear in **22 of the 44** unfinished decks.

Seven of the ten are Combat cards or combat retainers, so they split into
two or three waves by mechanic (strength and grapple; dodge and
maneuver; the masters). Building them early lifts every bundle that follows.

## 4. Decks that fit no bundle

Eighteen decks share too little with any other to bundle:

- **A clan with a legacy discipline:** Assamite (Quietus), Giovanni and
  Samedi (Necromancy; Samedi also Thanatosis), Baali (Daimoinon), Salubri
  antitribu (Valeren), Gargoyles (Visceratika, Flight) and Akunanse
  (Abombwe).
- **A clan no other unfinished deck uses:** Followers of Set, Ravnos,
  Guruhi, Ishtarri, Osebo, Nosferatu antitribu, Toreador antitribu,
  Ventrue antitribu and Gangrel antitribu.
- **Multi-clan decks:** Alastors and Anathema, each spanning six or more
  clans.

These are best taken one deck at a time, after the bundles, because the
commons wave and the bundles finish part of each of them for free.

## 5. Re-deriving these numbers

The scan is not a checked-in script. It reads the same inputs as
`scripts/card-status-by-set.cjs` (the legacy-precon loop, the `NOT_DECKS`
list and the re-release rule) and lists each deck's unbuilt card ids. To
redo it, copy that loop, collect the unbuilt ids per deck instead of a
count, and take unions over the decks of each bundle.
