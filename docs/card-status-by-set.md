# Card status by set

> **Generated 2026-09-11 from `data/vtes-raw.json` and `src/cards/registry.json`** by
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
| Jyhad (1994)                             |   437 |   172 |  **39%** |               0 |       39% |   98 |   56 |    0 |      54 |       57 |      0 |
| Vampire: The Eternal Struggle (1995)     |   436 |   173 |  **40%** |               0 |       40% |   96 |   56 |    0 |      54 |       57 |      0 |
| Dark Sovereigns (1995)                   |   173 |    28 |  **16%** |               0 |       16% |   67 |    9 |   18 |      11 |       40 |      0 |
| 1996 Promo (1996)                        |     2 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       1 |        1 |      0 |
| Ancient Hearts (1996)                    |   179 |    20 |  **11%** |               0 |       11% |   64 |   16 |   24 |      16 |       39 |      0 |
| Sabbat (1996)                            |   410 |   123 |  **30%** |               0 |       30% |   97 |   51 |   29 |      48 |       62 |      0 |
| Sabbat War (2000)                        |   437 |   147 |  **34%** |               0 |       34% |   99 |   51 |   41 |      40 |       59 |      0 |
| Final Nights promo (2001)                |     3 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        3 |      0 |
| Final Nights (2001)                      |   386 |    82 |  **21%** |               0 |       21% |   86 |   33 |   79 |      22 |       84 |      0 |
| Bloodlines promo (2001)                  |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Bloodlines (2001)                        |   196 |     4 |   **2%** |               0 |        2% |   33 |    7 |   89 |       4 |       59 |      0 |
| Winter 2002 Storyline promo (2002)       |     1 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        0 |      0 |
| Camarilla Edition promo (2002)           |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Sabbat War promo (2002)                  |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Camarilla Edition (2002)                 |   547 |   198 |  **36%** |               0 |       36% |  115 |   69 |   11 |      46 |      108 |      0 |
| Fall 2002 Storyline promo (2002)         |     1 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        0 |      0 |
| 2003 Tournament promo (2002)             |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| Anarchs promo (2003)                     |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Anarchs (2003)                           |   260 |    81 |  **31%** |               0 |       31% |   68 |   28 |    1 |      21 |       61 |      0 |
| Summer 2003 Storyline promo (2003)       |     2 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        1 |      0 |
| Black Hand promo (2003)                  |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Black Hand (2003)                        |   286 |    58 |  **20%** |               0 |       20% |   89 |   35 |   14 |      27 |       63 |      0 |
| Prophecies league promo (2004)           |     2 |     0 |   **0%** |               0 |        0% |    2 |    0 |    0 |       0 |        0 |      0 |
| 2004 promo (2004)                        |     3 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        3 |      0 |
| Gehenna promo (2004)                     |     1 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        0 |      0 |
| Gehenna (2004)                           |   150 |    13 |   **9%** |               0 |        9% |   64 |    7 |   16 |       6 |       44 |      0 |
| Fall 2004 Storyline promo (2004)         |     2 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        1 |      0 |
| Tenth Anniversary (2004)                 |   190 |     9 |   **5%** |               0 |        5% |   36 |    5 |    4 |      60 |       76 |      0 |
| Kindred Most Wanted promo (2005)         |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2005 Tournament promo (2005)             |     2 |     0 |   **0%** |               0 |        0% |    2 |    0 |    0 |       0 |        0 |      0 |
| Kindred Most Wanted (2005)               |   314 |    68 |  **22%** |               0 |       22% |   89 |   38 |   36 |      18 |       65 |      0 |
| Legacies of Blood promo (2005)           |     2 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        2 |      0 |
| 2005 Storyline promo (2005)              |     3 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        3 |      0 |
| Legacies of Blood (2005)                 |   461 |    72 |  **16%** |               0 |       16% |  132 |   34 |  124 |      24 |       75 |      0 |
| 2006 Tournament promo (2006)             |     7 |     1 |  **14%** |               0 |       14% |    4 |    1 |    0 |       0 |        1 |      0 |
| Nights of Reckoning (2006)               |    60 |     0 |   **0%** |               0 |        0% |   14 |    0 |   26 |       0 |        0 |     20 |
| 2006 Championship promo (2006)           |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Third Edition promo (2006)               |     2 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        2 |      0 |
| Third Edition (2006)                     |   537 |   168 |  **31%** |               0 |       31% |  150 |   47 |   39 |      48 |       85 |      0 |
| 2006 Storyline promo (2006)              |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2006 EC Tournament promo (2006)          |     1 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        0 |      0 |
| Sword of Caine promo (2007)              |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Sword of Caine (2007)                    |    60 |     4 |   **7%** |               0 |        7% |   26 |    7 |    3 |       0 |       20 |      0 |
| 2007 Promo (2007)                        |     1 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        0 |      0 |
| Lords of the Night (2007)                |   295 |    64 |  **22%** |               0 |       22% |   73 |   31 |   63 |      16 |       48 |      0 |
| 2008 Tournament promo (2008)             |    16 |     1 |   **6%** |               0 |        6% |   13 |    1 |    0 |       0 |        1 |      0 |
| Blood Shadowed Court (2008)              |   100 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |      35 |       65 |      0 |
| Twilight Rebellion (2008)                |    60 |    10 |  **17%** |               0 |       17% |   20 |    0 |   10 |       3 |       17 |      0 |
| 2008 Storyline promo (2008)              |     2 |     0 |   **0%** |               0 |        0% |    2 |    0 |    0 |       0 |        0 |      0 |
| Keepers of Tradition (2008)              |   457 |   137 |  **30%** |               0 |       30% |  138 |   48 |   10 |      26 |       98 |      0 |
| 2009 Tournament / Storyline promo (2009) |    13 |     1 |   **8%** |               0 |        8% |   10 |    0 |    0 |       0 |        2 |      0 |
| Ebony Kingdom (2009)                     |    62 |     0 |   **0%** |               0 |        0% |   32 |    5 |    5 |       6 |       14 |      0 |
| Heirs to the Blood (2010)                |   324 |    57 |  **18%** |               0 |       18% |   73 |   12 |   86 |      19 |       77 |      0 |
| 2010 Storyline promo (2010)              |     5 |     0 |   **0%** |               0 |        0% |    3 |    0 |    0 |       0 |        2 |      0 |
| Danse Macabre (2013)                     |    34 |     3 |   **9%** |               0 |        9% |    5 |    3 |    1 |       4 |       18 |      0 |
| The Unaligned (2014)                     |    76 |     4 |   **5%** |               0 |        5% |   11 |    1 |   10 |      11 |       39 |      0 |
| 2015 Storyline Rewards (2015)            |    13 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |       12 |      0 |
| Anarch Unbound (2016)                    |    42 |     5 |  **12%** |               1 |       14% |    6 |    2 |    6 |       3 |       19 |      0 |
| Anthology (2017)                         |    65 |     7 |  **11%** |               0 |       11% |   10 |    2 |    3 |      13 |       30 |      0 |
| Keepers of Tradition Reprint (2018)      |   166 |    16 |  **10%** |               0 |       10% |   11 |   11 |    2 |      27 |       99 |      0 |
| Lost Kindred (2018)                      |    41 |     2 |   **5%** |               0 |        5% |    9 |    0 |    7 |       2 |       21 |      0 |
| Heirs to the Blood Reprint (2018)        |   134 |     2 |   **1%** |               0 |        1% |   33 |    0 |   41 |       4 |       54 |      0 |
| 2018 Humble Bundle (2018)                |     5 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        5 |      0 |
| Sabbat Preconstructed (2019)             |   125 |    64 |  **51%** |               0 |       51% |   18 |    1 |   12 |      15 |       15 |      0 |
| 2019 Promo Pack 1 (2019)                 |    11 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |       11 |      0 |
| 2019 SAC Promo (2019)                    |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       1 |        0 |      0 |
| 2019 Promo (2019)                        |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    1 |       0 |        0 |      0 |
| 2019 NAC Promo (2019)                    |     1 |     0 |   **0%** |               1 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2019 Grand Prix Promo (2019)             |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2019 DriveThruCards Promo (2019)         |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| Twenty-Fifth Anniversary (2019)          |    61 |    32 |  **52%** |               0 |       52% |   16 |    3 |    3 |       0 |        7 |      0 |
| 2019 EC Promo (2019)                     |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       1 |        0 |      0 |
| First Blood (2019)                       |   109 |    67 |  **61%** |               0 |       61% |    4 |    3 |    5 |       7 |       23 |      0 |
| 2019 AC Promo (2019)                     |     1 |     0 |   **0%** |               1 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2019 ACC Promo (2019)                    |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       1 |        0 |      0 |
| 2020 GP Promo (2019)                     |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2020 Promo Pack 2 (2020)                 |    11 |     2 |  **18%** |               2 |       36% |    1 |    1 |    1 |       3 |        1 |      0 |
| V5 Polish Edition promo (2020)           |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| ★ Fifth Edition (2020)                   |   191 |   144 |  **75%** |              47 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2021 Resellers Promo (2021)              |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2021 Mind’s Eye Theatre Promo (2021)     |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2021 Kickstarter Promo (2021)            |     7 |     2 |  **29%** |               0 |       29% |    2 |    0 |    0 |       1 |        2 |      0 |
| 2021 Promo Pack 3 (2021)                 |    11 |     2 |  **18%** |               0 |       18% |    4 |    0 |    0 |       0 |        5 |      0 |
| 2021 SAC Promo (2021)                    |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| ★ Fifth Edition (Anarch) (2021)          |   135 |   106 |  **79%** |              29 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| ★ New Blood (2022)                       |   130 |   114 |  **88%** |              16 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2022 European GP Promo (2022)            |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| ★ New Blood II (2022)                    |   119 |   106 |  **89%** |              13 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| Fall of London (2022)                    |    30 |     0 |   **0%** |               0 |        0% |   10 |    0 |    0 |       0 |       20 |      0 |
| 2022 Promo (2022)                        |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2022 Fee Stake Promo (2022)              |     3 |     0 |   **0%** |               0 |        0% |    3 |    0 |    0 |       0 |        0 |      0 |
| 2022 EC Promo (2022)                     |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2023 Spanish National Promo (2023)       |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2023 War of the Ages Promo (2023)        |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2023 Belgian Championship Promo (2023)   |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2023 Chapters Promo (2023)               |     1 |     0 |   **0%** |               0 |        0% |    0 |    0 |    0 |       0 |        1 |      0 |
| 2023 Andalusian Open Promo (2023)        |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| Echoes of Gehenna (2023)                 |    30 |     0 |   **0%** |               0 |        0% |   24 |    0 |    0 |       1 |        5 |      0 |
| Shadows of Berlin (2023)                 |     9 |     2 |  **22%** |               0 |       22% |    2 |    0 |    0 |       2 |        3 |      0 |
| Promo (2023)                             |    24 |     7 |  **29%** |               0 |       29% |    7 |    3 |    2 |       1 |        4 |      0 |
| 2023 Ropecon Promo (2023)                |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2023 Zaragosa Promo (2023)               |     1 |     0 |   **0%** |               0 |        0% |    1 |    0 |    0 |       0 |        0 |      0 |
| 2023 Mineiro Promo (2023)                |     1 |     1 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| ★ Fifth Edition (Companion) (2024)       |   115 |   103 |  **90%** |              12 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| Thirtieth Anniversary (2024)             |    55 |    22 |  **40%** |               0 |       40% |   16 |    3 |    0 |       2 |       12 |      0 |
| ★ New Blood III (2025)                   |   131 |   123 |  **94%** |               8 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2025 CC Promo (2025)                     |     2 |     2 | **100%** |               0 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| ★ Sabbat V5 (2025)                       |   146 |   124 |  **85%** |              22 |      100% |    0 |    0 |    0 |       0 |        0 |      0 |
| 2025 European GP Promo (2025)            |     1 |     0 |   **0%** |               0 |        0% |    0 |    1 |    0 |       0 |        0 |      0 |
| Print on Demand                          |   943 |    40 |   **4%** |               0 |        4% |  162 |    3 |  302 |      88 |      348 |      0 |
| **All unique cards**                     |  4149 |   681 |  **16%** |             118 |       19% | 1068 |  229 |  485 |     386 |     1162 |     20 |

## Totals

|                                            |    Cards |    % |
| ------------------------------------------ | -------: | ---: |
| Built                                      |      681 |  16% |
| Whole, no build (V5 crypt)                 |      118 |   3% |
| Planned T1 (library, no discipline)        |     1068 |  26% |
| Planned T2 (library, pool disciplines)     |      229 |   6% |
| Planned T3 (library, legacy discipline)    |      485 |  12% |
| Planned §7 gate (legacy vampire, whole)    |      386 |   9% |
| Planned §7 build (legacy vampire, ability) |     1162 |  28% |
| Imbued (out of scope)                      |       20 |   0% |
| **Total**                                  | **4149** | 100% |

Nothing is cut or blocked: every card not yet built is in one of the five
planned buckets, except the Imbued. No date is attached to a bucket — waves land on the owner's
"onto the next", in the order T1 → T2 → T3 → §7.

## Regenerating

```
node scripts/card-status-by-set.cjs > docs/card-status-by-set.md
```
