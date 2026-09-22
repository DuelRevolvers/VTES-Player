# Card status by set

> **Generated 2026-09-22 from `data/vtes-raw.json` and `src/cards/registry.json`** by
> the script in this doc's footer. Re-run it rather than editing the numbers.
> A card printed in several sets is counted in each of them; the totals row
> counts unique cards.

## States

- **Built** — in the registry and `supported`: it does everything it prints
  (`tests/cards/no-partial-cards.test.ts`). Playable now.
- **Whole, no build** — a V5 crypt card printing no ability. In the pool and
  whole; there is nothing to build. "In pool %" is Built + this column.
- **Planned** — not in the pool yet. Which wave of `docs/pool-widening-design.md`
  will take it:
  - **T1** — library, no discipline (§6 tranche 1, in progress, ~1,100 left).
  - **T2** — library, only disciplines the V5 crypt already has (§6 tranche 2).
  - **T3** — library needing a legacy discipline (§6 tranche 3).
  - **§7 gate** — legacy vampire printing no ability. Already whole; enters
    the pool the moment the owner opens its group in
    `config/crypt-groups.json` (the crypt stays V5-only until then).
  - **§7 build** — legacy vampire printing an ability with no
    implementation. Clan-by-clan waves after the library.
- **Imbued** — a different card type (life, conviction, powers) the engine
  has no model for. Out of scope; no wave is planned.
- The **V5 product line** (`config/v5-sets.json`) is marked ★ — 100% in pool.

## By set

| Set                                      | Cards | Built |  Built % | Whole, no build | In pool % |   T1 |   T2 |   T3 | §7 gate | §7 build | Imbued |
| ---------------------------------------- | ----: | ----: | -------: | --------------: | --------: | ---: | ---: | ---: | ------: | -------: | -----: |
| Jyhad (1994)                             |   437 |   224 |  **51%** |               0 |       51% |   74 |   28 |    0 |      54 |       57 |      0 |
| Vampire: The Eternal Struggle (1995)     |   436 |   224 |  **51%** |               0 |       51% |   73 |   28 |    0 |      54 |       57 |      0 |
| Dark Sovereigns (1995)                   |   173 |    39 |  **23%** |               0 |       23% |   59 |    6 |   18 |      11 |       40 |      0 |
| 1996 Promo (1996)                        |     2 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       1 |        1 |      0 |
| Ancient Hearts (1996)                    |   179 |    38 |  **21%** |               0 |       21% |   49 |   13 |   24 |      16 |       39 |      0 |
| Sabbat (1996)                            |   410 |   164 |  **40%** |               0 |       40% |   81 |   26 |   29 |      48 |       62 |      0 |
| Sabbat War (2000)                        |   437 |   189 |  **43%** |               0 |       43% |   82 |   26 |   41 |      40 |       59 |      0 |
| Final Nights promo (2001)                |     3 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        3 |      0 |
| Final Nights (2001)                      |   386 |   116 |  **30%** |               0 |       30% |   64 |   21 |   79 |      22 |       84 |      0 |
| Bloodlines promo (2001)                  |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Bloodlines (2001)                        |   196 |     4 |   **2%** |               0 |        2% |   33 |    7 |   89 |       4 |       59 |      0 |
| Winter 2002 Storyline promo (2002)       |     1 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        0 |      0 |
| Camarilla Edition promo (2002)           |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Sabbat War promo (2002)                  |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Camarilla Edition (2002)                 |   547 |   252 |  **46%** |               0 |       46% |   92 |   38 |   11 |      46 |      108 |      0 |
| Fall 2002 Storyline promo (2002)         |     1 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        0 |      0 |
| 2003 Tournament promo (2002)             |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| Anarchs promo (2003)                     |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Anarchs (2003)                           |   260 |   113 |  **43%** |               0 |       43% |   51 |   13 |    1 |      21 |       61 |      0 |
| Summer 2003 Storyline promo (2003)       |     2 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        1 |      0 |
| Black Hand promo (2003)                  |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Black Hand (2003)                        |   286 |    79 |  **28%** |               0 |       28% |   79 |   24 |   14 |      27 |       63 |      0 |
| Prophecies league promo (2004)           |     2 |     1 |  **50%** |               0 |       50% |    1 |    0 |    0 |       0 |        0 |      0 |
| 2004 promo (2004)                        |     3 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        3 |      0 |
| Gehenna promo (2004)                     |     1 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        0 |      0 |
| Gehenna (2004)                           |   150 |    28 |  **19%** |               0 |       19% |   50 |    6 |   16 |       6 |       44 |      0 |
| Fall 2004 Storyline promo (2004)         |     2 |     1 |  **50%** |               0 |       50% |    0 |    0 |    0 |       0 |        1 |      0 |
| Tenth Anniversary (2004)                 |   190 |    13 |   **7%** |               0 |        7% |   34 |    3 |    4 |      60 |       76 |      0 |
| Kindred Most Wanted promo (2005)         |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2005 Tournament promo (2005)             |     2 |     0 |   **0%** |               0 |        0% |    2 |    0 |    0 |       0 |        0 |      0 |
| Kindred Most Wanted (2005)               |   314 |    97 |  **31%** |               0 |       31% |   76 |   22 |   36 |      18 |       65 |      0 |
| Legacies of Blood promo (2005)           |     2 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        2 |      0 |
| 2005 Storyline promo (2005)              |     3 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        3 |      0 |
| Legacies of Blood (2005)                 |   461 |    94 |  **20%** |               0 |       20% |  125 |   19 |  124 |      24 |       75 |      0 |
| 2006 Tournament promo (2006)             |     7 |     3 |  **43%** |               0 |       43% |    2 |    1 |    0 |       0 |        1 |      0 |
| Nights of Reckoning (2006)               |    60 |     0 |   **0%** |               0 |        0% |   14 |    0 |   26 |       0 |        0 |     20 |
| 2006 Championship promo (2006)           |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Third Edition promo (2006)               |     2 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        2 |      0 |
| Third Edition (2006)                     |   537 |   214 |  **40%** |               0 |       40% |  123 |   28 |   39 |      48 |       85 |      0 |
| 2006 Storyline promo (2006)              |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2006 EC Tournament promo (2006)          |     1 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        0 |      0 |
| Sword of Caine promo (2007)              |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Sword of Caine (2007)                    |    60 |     6 |  **10%** |               0 |       10% |   25 |    6 |    3 |       0 |       20 |      0 |
| 2007 Promo (2007)                        |     1 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        0 |      0 |
| Lords of the Night (2007)                |   295 |    88 |  **30%** |               0 |       30% |   54 |   26 |   63 |      16 |       48 |      0 |
| 2008 Tournament promo (2008)             |    16 |     4 |  **25%** |               0 |       25% |   10 |    1 |    0 |       0 |        1 |      0 |
| Blood Shadowed Court (2008)              |   100 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |      35 |       65 |      0 |
| Twilight Rebellion (2008)                |    60 |    11 |  **18%** |               0 |       18% |   19 |    0 |   10 |       3 |       17 |      0 |
| 2008 Storyline promo (2008)              |     2 |     0 |   **0%** |               0 |        0% |    2 |    0 |    0 |       0 |        0 |      0 |
| Keepers of Tradition (2008)              |   457 |   181 |  **40%** |               0 |       40% |  106 |   36 |   10 |      26 |       98 |      0 |
| 2009 Tournament / Storyline promo (2009) |    13 |     1 |   **8%** |               0 |        8% |   10 |    0 |    0 |       0 |        2 |      0 |
| Ebony Kingdom (2009)                     |    62 |     1 |   **2%** |               0 |        2% |   31 |    5 |    5 |       6 |       14 |      0 |
| Heirs to the Blood (2010)                |   324 |    65 |  **20%** |               0 |       20% |   68 |    9 |   86 |      19 |       77 |      0 |
| 2010 Storyline promo (2010)              |     5 |     0 |   **0%** |               0 |        0% |    3 |    0 |    0 |       0 |        2 |      0 |
| Danse Macabre (2013)                     |    34 |     3 |   **9%** |               0 |        9% |    5 |    3 |    1 |       4 |       18 |      0 |
| The Unaligned (2014)                     |    76 |     9 |  **12%** |               0 |       12% |    7 |    0 |   10 |      11 |       39 |      0 |
| 2015 Storyline Rewards (2015)            |    13 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |       12 |      0 |
| Anarch Unbound (2016)                    |    42 |     5 |  **12%** |               1 |       14% |    6 |    2 |    6 |       3 |       19 |      0 |
| Anthology (2017)                         |    65 |     8 |  **12%** |               0 |       12% |   10 |    1 |    3 |      13 |       30 |      0 |
| Keepers of Tradition Reprint (2018)      |   166 |    19 |  **11%** |               0 |       11% |   11 |    8 |    2 |      27 |       99 |      0 |
| Lost Kindred (2018)                      |    41 |     3 |   **7%** |               0 |        7% |    8 |    0 |    7 |       2 |       21 |      0 |
| Heirs to the Blood Reprint (2018)        |   134 |     5 |   **4%** |               0 |        4% |   30 |    0 |   41 |       4 |       54 |      0 |
| 2018 Humble Bundle (2018)                |     5 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        5 |      0 |
| Sabbat Preconstructed (2019)             |   125 |    68 |  **54%** |               0 |       54% |   14 |    1 |   12 |      15 |       15 |      0 |
| 2019 Promo Pack 1 (2019)                 |    11 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |       11 |      0 |
| 2019 SAC Promo (2019)                    |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       1 |        0 |      0 |
| 2019 Promo (2019)                        |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    1 |       0 |        0 |      0 |
| 2019 NAC Promo (2019)                    |     1 |     0 |   **0%** |               1 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2019 Grand Prix Promo (2019)             |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2019 DriveThruCards Promo (2019)         |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Twenty-Fifth Anniversary (2019)          |    61 |    34 |  **56%** |               0 |       56% |   14 |    3 |    3 |       0 |        7 |      0 |
| 2019 EC Promo (2019)                     |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       1 |        0 |      0 |
| First Blood (2019)                       |   109 |    71 |  **65%** |               0 |       65% |    2 |    1 |    5 |       7 |       23 |      0 |
| 2019 AC Promo (2019)                     |     1 |     0 |   **0%** |               1 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2019 ACC Promo (2019)                    |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       1 |        0 |      0 |
| 2020 GP Promo (2019)                     |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2020 Promo Pack 2 (2020)                 |    11 |     2 |  **18%** |               2 |       36% |    1 |    1 |    1 |       3 |        1 |      0 |
| V5 Polish Edition promo (2020)           |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| ★ Fifth Edition (2020)                   |   191 |   144 |  **75%** |              47 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2021 Resellers Promo (2021)              |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2021 Mind’s Eye Theatre Promo (2021)     |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2021 Kickstarter Promo (2021)            |     7 |     2 |  **29%** |               0 |       29% |    2 |    0 |    0 |       1 |        2 |      0 |
| 2021 Promo Pack 3 (2021)                 |    11 |     3 |  **27%** |               0 |       27% |    3 |    0 |    0 |       0 |        5 |      0 |
| 2021 SAC Promo (2021)                    |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| ★ Fifth Edition (Anarch) (2021)          |   135 |   106 |  **79%** |              29 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| ★ New Blood (2022)                       |   130 |   114 |  **88%** |              16 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2022 European GP Promo (2022)            |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| ★ New Blood II (2022)                    |   119 |   106 |  **89%** |              13 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| Fall of London (2022)                    |    30 |     1 |   **3%** |               0 |        3% |    9 |    0 |    0 |       0 |       20 |      0 |
| 2022 Promo (2022)                        |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2022 Fee Stake Promo (2022)              |     3 |     3 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2022 EC Promo (2022)                     |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2023 Spanish National Promo (2023)       |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2023 War of the Ages Promo (2023)        |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2023 Belgian Championship Promo (2023)   |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2023 Chapters Promo (2023)               |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2023 Andalusian Open Promo (2023)        |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| Echoes of Gehenna (2023)                 |    30 |    13 |  **43%** |               0 |       43% |   11 |    0 |    0 |       1 |        5 |      0 |
| Shadows of Berlin (2023)                 |     9 |     2 |  **22%** |               0 |       22% |    2 |    0 |    0 |       2 |        3 |      0 |
| Promo (2023)                             |    24 |     7 |  **29%** |               0 |       29% |    7 |    3 |    2 |       1 |        4 |      0 |
| 2023 Ropecon Promo (2023)                |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2023 Zaragosa Promo (2023)               |     1 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        0 |      0 |
| 2023 Mineiro Promo (2023)                |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| ★ Fifth Edition (Companion) (2024)       |   115 |   103 |  **90%** |              12 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| Thirtieth Anniversary (2024)             |    55 |    25 |  **45%** |               0 |       45% |   13 |    3 |    0 |       2 |       12 |      0 |
| ★ New Blood III (2025)                   |   131 |   123 |  **94%** |               8 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2025 CC Promo (2025)                     |     2 |     2 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| ★ Sabbat V5 (2025)                       |   146 |   124 |  **85%** |              22 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2025 European GP Promo (2025)            |     1 |     0 |   **0%** |               0 |        0% |    0 |    1 |    0 |       0 |        0 |      0 |
| Print on Demand                          |   943 |    56 |   **6%** |               0 |        6% |  146 |    3 |  302 |      88 |      348 |      0 |
| **All unique cards**                     |  4149 |   916 |  **22%** |             118 |       25% |  897 |  165 |  485 |     386 |     1162 |     20 |

## Totals

|                                            |    Cards |    % |
| ------------------------------------------ | -------: | ---: |
| Built                                      |      916 |  22% |
| Whole, no build (V5 crypt)                 |      118 |   3% |
| Planned T1 (library, no discipline)        |      897 |  22% |
| Planned T2 (library, pool disciplines)     |      165 |   4% |
| Planned T3 (library, legacy discipline)    |      485 |  12% |
| Planned §7 gate (legacy vampire, whole)    |      386 |   9% |
| Planned §7 build (legacy vampire, ability) |     1162 |  28% |
| Imbued (out of scope)                      |       20 |   0% |
| **Total**                                  | **4149** | 100% |

Nothing is cut or blocked: every card not yet built is in one of the five
planned buckets, except the Imbued. No date is attached to a bucket — waves land on the owner's
"onto the next", in the order T1 → T2 → T3 → §7.

## Precon decks

The 32 preconstructed decks the registry derives from the KRCG
snapshot. **Implemented %** counts CARD COPIES whose card is in the pool and
built. **Playable as printed** is the deck importer's own verdict: a crypt of
12+, a library of 60–90, one crypt group or two
consecutive (p. 4, p. 14), and nothing unimplemented.

**They are different questions.** A deck can be 100% implemented and still not
be a legal deck on its own — which is exactly what the New Blood starters are:
half decks, sold in pairs, and not a defect in the pool.

| Deck                              | Set                       | Crypt | Library | Implemented % | Playable as printed | Why not                       |
| --------------------------------- | ------------------------- | ----: | ------: | ------------: | ------------------- | ----------------------------- |
| Hecata                            | Fifth Edition             |    12 |      77 |      **100%** | yes                 | —                             |
| Lasombra                          | Fifth Edition             |    12 |      77 |      **100%** | yes                 | —                             |
| Malkavian                         | Fifth Edition             |    12 |      77 |      **100%** | yes                 | —                             |
| Nosferatu                         | Fifth Edition             |    12 |      77 |      **100%** | yes                 | —                             |
| Toreador                          | Fifth Edition             |    12 |      77 |      **100%** | yes                 | —                             |
| Tremere                           | Fifth Edition             |    12 |      77 |      **100%** | yes                 | —                             |
| Ventrue                           | Fifth Edition             |    12 |      77 |      **100%** | yes                 | —                             |
| Banu Haqim                        | Fifth Edition (Anarch)    |    12 |      77 |      **100%** | yes                 | —                             |
| Brujah                            | Fifth Edition (Anarch)    |    12 |      77 |      **100%** | yes                 | —                             |
| Gangrel                           | Fifth Edition (Anarch)    |    12 |      77 |      **100%** | yes                 | —                             |
| Ministry                          | Fifth Edition (Anarch)    |    12 |      77 |      **100%** | yes                 | —                             |
| Ravnos                            | Fifth Edition (Companion) |    12 |      77 |      **100%** | yes                 | —                             |
| Salubri                           | Fifth Edition (Companion) |    12 |      77 |      **100%** | yes                 | —                             |
| Tzimisce                          | Fifth Edition (Companion) |    12 |      77 |      **100%** | yes                 | —                             |
| Malkavian                         | New Blood                 |     6 |      49 |      **100%** | no                  | crypt 6 < 12; library 49 < 60 |
| Nosferatu                         | New Blood                 |     6 |      49 |      **100%** | no                  | crypt 6 < 12; library 49 < 60 |
| Toreador                          | New Blood                 |     6 |      49 |      **100%** | no                  | crypt 6 < 12; library 49 < 60 |
| Tremere                           | New Blood                 |     6 |      49 |      **100%** | no                  | crypt 6 < 12; library 49 < 60 |
| Ventrue                           | New Blood                 |     6 |      49 |      **100%** | no                  | crypt 6 < 12; library 49 < 60 |
| Banu Haqim                        | New Blood II              |     6 |      48 |      **100%** | no                  | crypt 6 < 12; library 48 < 60 |
| Brujah                            | New Blood II              |     6 |      48 |      **100%** | no                  | crypt 6 < 12; library 48 < 60 |
| Gangrel                           | New Blood II              |     6 |      48 |      **100%** | no                  | crypt 6 < 12; library 48 < 60 |
| Ministry                          | New Blood II              |     6 |      48 |      **100%** | no                  | crypt 6 < 12; library 48 < 60 |
| Hecata                            | New Blood III             |     6 |      48 |      **100%** | no                  | crypt 6 < 12; library 48 < 60 |
| Lasombra                          | New Blood III             |     6 |      48 |      **100%** | no                  | crypt 6 < 12; library 48 < 60 |
| Ravnos                            | New Blood III             |     6 |      48 |      **100%** | no                  | crypt 6 < 12; library 48 < 60 |
| Salubri                           | New Blood III             |     6 |      48 |      **100%** | no                  | crypt 6 < 12; library 48 < 60 |
| Tzimisce                          | New Blood III             |     6 |      48 |      **100%** | no                  | crypt 6 < 12; library 48 < 60 |
| Path of Caine                     | Sabbat V5                 |    12 |      77 |      **100%** | yes                 | —                             |
| Path of Cathari                   | Sabbat V5                 |    12 |      77 |      **100%** | yes                 | —                             |
| Path of Death                     | Sabbat V5                 |    12 |      77 |      **100%** | yes                 | —                             |
| Path of Power and the Inner Voice | Sabbat V5                 |    12 |      77 |      **100%** | yes                 | —                             |

**18 of 32 playable as printed**, and **32 of
32 at 100% implemented**. Every card in every precon is a V5 card, so this
table moves only if the V5 pool does — the library waves of §6 widen the pool
AROUND these decks, not inside them.

## Precon decks outside V5

The 49 preconstructed decks the rest of the KRCG snapshot ships.
**None of these are in the pool**: `build-registry.mts` hands `collectPrecons`
the V5 sets alone, deliberately, so a widened card can never drag its legacy
set's precons in half-built. This table is a REPORT — it admits nothing and
changes no config. It is here to answer one question the V5 table cannot:
**how far is the pool from dealing a real legacy deck?**

**Implemented %** is the same rule as above — card copies whose card is in the
registry and built — so it rises only as the §6 library waves land. A deck at
40% is 40% of its CARD COPIES, not of its distinct cards; the commonest cards
in VTES are the ones already built.

**"Legal shape" is NOT the V5 table's "playable as printed".** That verdict
also requires nothing unimplemented, and by that rule every row here would
read "no" and the column would say nothing. This one asks the deck-legality
question ALONE — a crypt of 12+, a library of 60–90, one crypt group or
two consecutive (p. 4, p. 14) — and leaves implementation to the column beside
it. A deck needs BOTH columns before it can be dealt.

Two decks are left out on purpose, at the owner's word (2026-09-15):

- **Not decks.** Several `precon` entries in the snapshot are bundles, tins or
  print-on-demand singles lists rather than preconstructed decks —
  2018 Humble Bundle, Anthology, Heirs to the Blood Reprint, Keepers of Tradition Reprint, Print on Demand, Tenth Anniversary, The Unaligned. Tenth Anniversary's tins are 100 distinct cards
  at one copy each and Print on Demand is 943: a list with one copy of
  everything is not a deck list.
- **Originals of re-releases.** Where the same clan deck exists as an original
  and as a later re-release, the **re-release is listed and the original
  dropped**. Only two products qualify, confirmed by release date rather than
  by memory: **Camarilla Edition (2002) → First Blood (2019)** and
  **Final Nights (2001) → Lords of the Night (2007)**. Camarilla Edition's
  *Brujah* has no First Blood counterpart, so it is not the original OF
  anything and stays.

| Deck                            | Set                   | Year | Crypt | Library | Implemented % | Legal shape | Why not                       |
| ------------------------------- | --------------------- | ---: | ----: | ------: | ------------: | ----------- | ----------------------------- |
| Brujah antitribu                | Sabbat War            | 2000 |    12 |      77 |       **72%** | yes         | —                             |
| Lasombra                        | Sabbat War            | 2000 |    12 |      77 |       **51%** | yes         | —                             |
| Tzimisce                        | Sabbat War            | 2000 |    12 |      77 |       **54%** | yes         | —                             |
| Ventrue antitribu               | Sabbat War            | 2000 |    12 |      77 |       **66%** | yes         | —                             |
| Brujah                          | Camarilla Edition     | 2002 |    12 |      77 |       **71%** | yes         | —                             |
| Anarch Barons                   | Anarchs               | 2003 |    12 |      77 |       **69%** | yes         | —                             |
| Anarch Gang                     | Anarchs               | 2003 |    12 |      77 |       **60%** | yes         | —                             |
| Gangrel                         | Anarchs               | 2003 |    12 |      77 |       **74%** | yes         | —                             |
| Malkavian antitribu             | Black Hand            | 2003 |    12 |      77 |       **47%** | yes         | —                             |
| Nosferatu antitribu             | Black Hand            | 2003 |    12 |      77 |       **63%** | yes         | —                             |
| Toreador antitribu              | Black Hand            | 2003 |    12 |      77 |       **57%** | yes         | —                             |
| Tremere antitribu               | Black Hand            | 2003 |    12 |      77 |       **62%** | yes         | —                             |
| Alastors                        | Kindred Most Wanted   | 2005 |    12 |      77 |       **62%** | yes         | —                             |
| Anathema                        | Kindred Most Wanted   | 2005 |    12 |      77 |       **62%** | yes         | —                             |
| Baali                           | Kindred Most Wanted   | 2005 |    12 |      77 |       **44%** | yes         | —                             |
| Gangrel antitribu               | Kindred Most Wanted   | 2005 |    12 |      77 |       **58%** | yes         | —                             |
| Akunanse                        | Legacies of Blood     | 2005 |    12 |      77 |       **51%** | yes         | —                             |
| Guruhi                          | Legacies of Blood     | 2005 |    12 |      77 |       **65%** | yes         | —                             |
| Ishtarri                        | Legacies of Blood     | 2005 |    12 |      77 |       **65%** | yes         | —                             |
| Osebo                           | Legacies of Blood     | 2005 |    12 |      77 |       **51%** | yes         | —                             |
| Brujah antitribu                | Third Edition         | 2006 |    12 |      77 |       **65%** | yes         | —                             |
| Malkavian antitribu             | Third Edition         | 2006 |    12 |      77 |       **54%** | yes         | —                             |
| Starter Kit Brujah antitribu    | Third Edition         | 2006 |     6 |      44 |       **74%** | no          | crypt 6 < 12; library 44 < 60 |
| Starter Kit Malkavian antitribu | Third Edition         | 2006 |     5 |      43 |       **56%** | no          | crypt 5 < 12; library 43 < 60 |
| Starter Kit Tremere antitribu   | Third Edition         | 2006 |     6 |      44 |       **80%** | no          | crypt 6 < 12; library 44 < 60 |
| Starter Kit Tzimisce            | Third Edition         | 2006 |     6 |      44 |       **44%** | no          | crypt 6 < 12; library 44 < 60 |
| Tremere antitribu               | Third Edition         | 2006 |    12 |      77 |       **72%** | yes         | —                             |
| Tzimisce                        | Third Edition         | 2006 |    12 |      77 |       **39%** | yes         | —                             |
| Assamite                        | Lords of the Night    | 2007 |    12 |      77 |       **27%** | yes         | —                             |
| Followers of Set                | Lords of the Night    | 2007 |    12 |      77 |       **29%** | yes         | —                             |
| Giovanni                        | Lords of the Night    | 2007 |    12 |      77 |       **36%** | yes         | —                             |
| Ravnos                          | Lords of the Night    | 2007 |    12 |      77 |       **42%** | yes         | —                             |
| Brujah                          | Keepers of Tradition  | 2008 |    12 |      77 |       **57%** | yes         | —                             |
| Malkavian                       | Keepers of Tradition  | 2008 |    12 |      77 |       **46%** | yes         | —                             |
| Toreador                        | Keepers of Tradition  | 2008 |    12 |      77 |       **65%** | yes         | —                             |
| Ventrue                         | Keepers of Tradition  | 2008 |    12 |      77 |       **58%** | yes         | —                             |
| Gargoyles                       | Heirs to the Blood    | 2010 |    12 |      77 |       **48%** | yes         | —                             |
| Kiasyd                          | Heirs to the Blood    | 2010 |    12 |      77 |       **33%** | yes         | —                             |
| Salubri antitribu               | Heirs to the Blood    | 2010 |    12 |      77 |       **58%** | yes         | —                             |
| Samedi                          | Heirs to the Blood    | 2010 |    12 |      77 |       **49%** | yes         | —                             |
| Den of Fiends                   | Sabbat Preconstructed | 2019 |    12 |      77 |       **58%** | yes         | —                             |
| Libertine Ball                  | Sabbat Preconstructed | 2019 |    12 |      77 |       **69%** | yes         | —                             |
| Pact with Nephandi              | Sabbat Preconstructed | 2019 |    12 |      77 |       **69%** | yes         | —                             |
| Parliament of Shadows           | Sabbat Preconstructed | 2019 |    12 |      77 |       **55%** | yes         | —                             |
| Malkavian                       | First Blood           | 2019 |     6 |      49 |       **51%** | no          | crypt 6 < 12; library 49 < 60 |
| Nosferatu                       | First Blood           | 2019 |     6 |      49 |       **89%** | no          | crypt 6 < 12; library 49 < 60 |
| Toreador                        | First Blood           | 2019 |     6 |      49 |       **85%** | no          | crypt 6 < 12; library 49 < 60 |
| Tremere                         | First Blood           | 2019 |     6 |      49 |       **87%** | no          | crypt 6 < 12; library 49 < 60 |
| Ventrue                         | First Blood           | 2019 |     6 |      49 |       **89%** | no          | crypt 6 < 12; library 49 < 60 |

**40 of 49 are a legal deck shape.** The 9 that are not are half decks
by design, exactly as the New Blood starters are: First Blood's five are
6 crypt / 49 library and Third Edition's four Starter Kits are smaller again.
That is a fact about the product, not a defect in the pool.

## Regenerating

```
node scripts/card-status-by-set.cjs > docs/card-status-by-set.md
```
