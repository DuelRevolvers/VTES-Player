# Audyt kart w przygotowanych taliach

Zakres: 42 talii dostępnych w wyborze (`shell.ts`: `playable || halfDeck`): 28 pełnych i 14 half-decków. Źródło talii: `src/cards/registry.json`, snapshot 2026-11-01T20:12:30.427Z.

To zestawienie aktualnych wpisów audytu, nie ponowna weryfikacja wszystkich klauzul 727 kart. Do identyfikacji statusów użyto `docs/card-audit/manual-findings.json`; statusy i uzasadnienia mogą wymagać aktualizacji. Sama flaga `supported`, handler ani brak wykrytych błędów nie dowodzą pełnej poprawności.

## Podsumowanie

- Unikalne karty: **727**; z wpisem w audycie: **727**; bez wpisu: **0**. Brakujące ID w registry: **0**; karty bez flagi supported: **0**.
- Otwarte ustalenia dotyczą **39 różnych kart**: CODE_DISCREPANCY 0, PARTIAL_FIX 39, CONFIRMED_BUG 0, UNRESOLVED 0. UNRESOLVED oznacza kwestię nierozstrzygniętą, nie potwierdzony błąd.
- **24/42 talii** zawiera co najmniej jeden otwarty lub niezweryfikowany wpis. Pozostałe talie nie mają takich wpisów, ale to nadal nie dowód kompletnej poprawności.
- REVIEWED_NO_ISSUE_FOUND: **590** kart; FIXED_TARGETED: **98**. Obie klasy oznaczają ograniczony zakres sprawdzenia/naprawy, a nie certyfikat wszystkich interakcji.

## Dodatkowe scenariusze odtworzone w silniku

- **Blood Doll (100199)**: Nie zaoferowano zagrania na ally w tym scenariuszu; nie dowodzi to pełnej poprawności karty. Liczba talii: 17.
- **Villein (102121)**: Po zagraniu pierwszej Villein na wampira z 5 blood i przeniesieniu 2, druga opcja na tego wampira ma koszt **1 pool** — zgodny z wymaganym +1 pool w tym scenariuszu. To kontrola konkretnego scenariusza, nie wszystkich klauzul. Liczba talii: 17.

Regeneracja: `npx tsx scripts/card-audit-precons.mts`. Scenariusze używają syntetycznych fixture'ów z `tests/engine/fixtures.ts`; dane produkcyjne i silnik są takie jak w aplikacji.

## Zestawienie talii

Liczby to **różne ID kart**, a nie liczba kopii. Listy obejmują tylko otwarte ustalenia i brakujące wpisy; szczegółową ewidencję wszystkich kart i ich dowodów zawiera `preconstructed-cards.csv`.

| Zestaw / talia | Typ | Różnych kart | Otwarte / bez wpisu | Karty z otwartym ustaleniem |
|---|---|---:|---:|---|
| Fifth Edition / Hecata | pełna | 39 | 1 | [Rolling with the Punches](#karta-101649) |
| Fifth Edition / Lasombra | pełna | 36 | 0 | — |
| Fifth Edition / Malkavian | pełna | 30 | 0 | — |
| Fifth Edition / Nosferatu | pełna | 35 | 0 | — |
| Fifth Edition / Toreador | pełna | 29 | 0 | — |
| Fifth Edition / Tremere | pełna | 33 | 0 | — |
| Fifth Edition / Ventrue | pełna | 32 | 0 | — |
| Fifth Edition (Anarch) / Banu Haqim | pełna | 34 | 1 | [Rego Motum](#karta-101588) |
| Fifth Edition (Anarch) / Brujah | pełna | 37 | 0 | — |
| Fifth Edition (Anarch) / Gangrel | pełna | 38 | 0 | — |
| Fifth Edition (Anarch) / Ministry | pełna | 36 | 3 | [Heart of Nizchetus](#karta-100903), [Revelation of the Serpent](#karta-102233), [Nonu Dis (G6)](#karta-201608) |
| Fifth Edition (Companion) / Ravnos | pełna | 39 | 1 | [Shilmulo Tarot](#karta-101767) |
| Fifth Edition (Companion) / Salubri | pełna | 43 | 3 | [Rolling with the Punches](#karta-101649), [Touch of Valeren](#karta-102262), [Opikun (G7)](#karta-201680) |
| Fifth Edition (Companion) / Tzimisce | pełna | 40 | 2 | [War Ghoul](#karta-102144), [Childe of the Revolution](#karta-102246) |
| New Blood / Malkavian | half-deck | 30 | 0 | — |
| New Blood / Nosferatu | half-deck | 32 | 0 | — |
| New Blood / Toreador | half-deck | 27 | 0 | — |
| New Blood / Tremere | half-deck | 30 | 1 | [Rego Motum](#karta-101588) |
| New Blood / Ventrue | half-deck | 28 | 0 | — |
| New Blood II / Banu Haqim | half-deck | 32 | 1 | [Blur](#karta-100227) |
| New Blood II / Brujah | half-deck | 30 | 1 | [Childe of the Revolution](#karta-102246) |
| New Blood II / Gangrel | half-deck | 31 | 0 | — |
| New Blood II / Ministry | half-deck | 33 | 1 | [Revelation of the Serpent](#karta-102233) |
| New Blood III / Hecata | half-deck | 25 | 0 | — |
| New Blood III / Lasombra | half-deck | 24 | 0 | — |
| New Blood III / Ravnos | half-deck | 31 | 1 | [AK-47](#karta-100032) |
| New Blood III / Salubri | half-deck | 27 | 3 | [Touch of Valeren](#karta-102262), [Tranquility Shield](#karta-102362), [Opikun (G7)](#karta-201680) |
| New Blood III / Tzimisce | half-deck | 34 | 0 | — |
| Sabbat V5 / Path of Caine | pełna | 36 | 3 | [Yawp Court](#karta-102199), [Dance with the Devil](#karta-102315), [Rage of Apedemak](#karta-102336) |
| Sabbat V5 / Path of Cathari | pełna | 35 | 1 | [Gostoso (G6)](#karta-201754) |
| Sabbat V5 / Path of Death | pełna | 41 | 3 | [Obedience](#karta-101309), [Dance of the Dead](#karta-102314), [Eulogio Sánchez de los Reyes (G6)](#karta-201750) |
| Sabbat V5 / Path of Power and the Inner Voice | pełna | 42 | 1 | [Věnceslava, The Implacable (G6)](#karta-201776) |
| 🏆 Tournament Winners 2025 / 2025-10-19 — Shalmath Toolbox (EC Day 2, Aarhus — Nerijus Mikalajūnas, 50p) | pełna | 36 | 14 | [Enkil Cog](#karta-100645), [Eye of Hazimel](#karta-100678), [Heart of Nizchetus](#karta-100903), [Hourglass of the Mind](#karta-100941), [Nephandus](#karta-101272), [Outside the Hourglass](#karta-101338), [Summon History](#karta-101897), [Talbot's Chainsaw](#karta-101931), [Alex Wilkins (G5)](#karta-200048), [Anarch Convert (ANY)](#karta-200076), [Donald Cargill (G5)](#karta-200365), [New Blood (ANY)](#karta-201052), [Shalmath (G6)](#karta-201274), [Walker Grimes (G5)](#karta-201462) |
| 🏆 Tournament Winners 2025 / 2025-06-21 — Gangrel Death Star (NAC 2025, Columbus — Martin Weinmayer, 62p, Wall) | pełna | 41 | 2 | [Heart of Nizchetus](#karta-100903), [André the Manipulator (G5)](#karta-200081) |
| 🏆 Tournament Winners 2024 / 2024-06-22 — Govern Resistance (NAC 2024, Columbus — Bill Troxel, 54p, Tzimisce Toolbox) | pełna | 35 | 1 | [New Blood (ANY)](#karta-201052) |
| 🏆 Tournament Winners 2024 / 2024-11-16 — Gangrel Swarm v3 (Slovak NC, Bratislava — Jakub Rypar, 22p, Wall/Swarm) | pełna | 38 | 0 | — |
| 🏆 Tournament Winners 2024 / 2024-02-10 — Malkavian 95 Bleed (Mexico NC — Melissa Avilés, 10p, Stealth & Bleed) | pełna | 28 | 1 | [Alabástrom (G6)](#karta-200039) |
| 🏆 Tournament Winners 2024 / 2024-07-21 — Usurper High Council (Helsinki, Martin Weinmayer, 22p, Vote) | pełna | 25 | 0 | — |
| 🏆 Tournament Winners 2026 / 2026-06-27 — Lasombra Potato Groove (Spanish NC, Leganés — Miquel Jorge, 158p, Vote/Bleed) | pełna | 35 | 1 | [Obedience](#karta-101309) |
| 🏆 Tournament Winners 2024 / 2024-06-21 — The Unnamed Six Demon Bag (Origins Friday 2, Columbus — Darby Keeney, 44p, Baali Bleed) | pełna | 31 | 3 | [Anarch Convert (ANY)](#karta-200076), [Zubeida (G5)](#karta-201510), [Heart of Nizchetus](#karta-100903) |
| 🏆 Tournament Winners 2023 / 2023-10-15 — Tupdog Brick Wall (EC 2023 Finalist — Rush Wall) | pełna | 34 | 3 | [Anarch Convert (ANY)](#karta-200076), [Hrothulf (G3)](#karta-200608), [Cedric (G4)](#karta-200257) |
| 🏆 Tournament Winners 2024 / 2024-03-09 — Weenie Animalism (Oceania NC, Auckland — Rush/Bleed) | pełna | 27 | 1 | [Anarch Convert (ANY)](#karta-200076) |

## Otwarte ustalenia — karty

Poniższe opisy przytoczono z audytu. CODE_DISCREPANCY bywa oparte wyłącznie na analizie statycznej; CONFIRMED_BUG jest statusem historycznym i nie zawsze oznacza odtworzenie nowym testem. Nie wolno traktować UNRESOLVED jako potwierdzonego błędu.

<a id="karta-100032"></a>
### AK-47 (100032) — PARTIAL_FIX

Występuje w **1** taliach. Dodatkowy strike jest nadal przyznawany po strike'u z broni, ale jest OPCJONALNY: w dodatkowej sub-rundzie strzelec może wybrać 'strike:decline' (bez obrażeń, zwalnia zobowiązanie do broni). Flaga CombatFrame.optionalAdditionalStrike jest ustawiana tylko dla opcjonalnych przyznań (AK-47, Caseless Rounds); zwykłe dodatkowe strike'i jej nie mają. Testy: tests/cards/weapon-riders.test.ts + last-equipment-modifiers.test.ts + tests/cards/additional-strike-limit.test.ts: 63 testy łącznie, w tym 'the optional extra strike can be DECLINED' oraz nowe testy potwierdzające, że AK-47 equipped jest oferowane w combat.grantAdditionalStrikes obok Blur z ręki, a po użyciu jednego źródła limited drugie nie jest oferowane. Kontrola mutacyjna: testy w additional-strike-limit.test.ts failują bez obsługi grant window dla broni z additionalStrikeSelf. NIEZROBIONE: wybór innego limitowanego źródła zamiast grantu AK-47 (kolejność przed grantem), docs/additional-strike-followups.md.

<a id="karta-100227"></a>
### Blur (100227) — PARTIAL_FIX

Występuje w **1** taliach. Zweryfikowano: basic daje 1 dodatkowy strike, superior 2 (limited), grant po pierwszej parze; tests/cards/combat-strikes.test.ts (Blur superior: 3 uderzenia M, 2 dodatkowe sub-rundy) i Quickness współistniejący z Blur (Quickness nieograniczony nie zużywa źródła limitowanego); limit egzekwowany przez usedLimitedAddl (tests/cards/weapon-riders.test.ts + additional-strike-limit.test.ts: AK-47 i limitowany Blur). Kontrola mutacyjna: testy w additional-strike-limit.test.ts potwierdzają, że Blur jest oferowane w combat.grantAdditionalStrikes obok AK-47 equipped, a po użyciu Blur (limited) AK-47 nie jest już oferowane (usedLimitedAddl). NIEZROBIONE, WSPÓLNE Z SILNIKIEM: kolejność okna kolejnych źródeł przy oczekujących strike'ach (LSJ 20001206, docs/additional-strike-followups.md) nie jest jeszcze przebudowana; dotyczy źródeł nieograniczonych, nie zmienia liczby strike'ów Blur. Nie jest błędem specyficznym dla Blur.

<a id="karta-100645"></a>
### Enkil Cog (100645) — PARTIAL_FIX

Występuje w **1** taliach. Po successful bleed przeciw prey karta jest teraz unikalnym permanentem na aktorze capacity >=10 i daje mu stałe +1 bleed. tests/cards/enkil-cog-audit.test.ts. Kontrola mutacyjna: usunięcie handlera enkil-cog z cards.ts powoduje fail testów enkil-cog-audit.test.ts (brak bonusu bleed i unikalności). Wciąż brak dodatkowej akcji w dowolnej minion phase, a relacja prey po oust wymaga weryfikacji. Paczka 2: LSJ 20081213-1 (anulowana akcja przy zagraniu nie zużywa Cog) nie ma testu; dodatkowa akcja w minion phase nadal brakuje. Status bez zmian.

<a id="karta-100678"></a>
### Eye of Hazimel (100678) — PARTIAL_FIX

Występuje w **1** taliach. Paczka 2: 5 unpreventable environmental damage na bearera przy spaleniu przez burnPermanent (onLeavePlay, eye-hazimel-audit.test.ts). Paczka 3: upkeep w unlock phase — "burn 1 pool or burn this equipment" przez hook onControllerUnlock i wybór permanentPoolOrBurn; bez puli karta spala się od razu (tests/cards/eye-hazimel-unlock.test.ts). Zakaz przenoszenia/kradzieży przy gotowym bearerze: statyka untouchableWhileBearerReady filtruje cele kradzieży (enumeratePermanentTargets) i blokuje ControlChanged w changePermanentControl; test w tym samym pliku. Spalenie bearera razem z kartą (burnMinion emituje PermanentBurned dla dołączonych kart, bez burnPermanent): hook obrażeń nie działa, ale bearer jest już poza grą, więc obrażenia nie mają adresata i wynik jest ten sam. Nie jest to luka reguły; nie ma rulingu dla tego przypadku. Kontrola mutacyjna: usunięcie hooku onControllerUnlock w cards.ts powoduje fail testów eye-hazimel-unlock.test.ts (brak wyboru pool/burn przy unlock). Nadal otwarte: ogólny ruch sprzętu między wampirami nie jest modelowany, więc zakaz pokrywa tylko przypadki, które silnik zna.

<a id="karta-100903"></a>
### Heart of Nizchetus (100903) — PARTIAL_FIX

Występuje w **4** taliach. Celowana naprawa: liczony draw Heart jest wznawiany po każdym wyborze źródła (w tym Tarot/Cache) i po save/load; dopiero po draw następuje wybór do przesunięcia na spód, w liczbie rzeczywiście dobranych kart. Opcje liczby uwzględniają aktywne store; heart-draw-redirect.test.ts. Nadal brak reprezentacji właściciela karty w ręce i poprawnego skierowania do biblioteki właściciela (np. Agaitas), niezweryfikowana kompletna semantyka choice/up to i kolejność wszystkich efektów; inne ścieżki wielokrotnego draw nie zostały naprawione. Historycznie: Odtworzony błąd: przy Heart i Shilmulo Tarot w fazie unlock wybór draw 2 natychmiast pyta o przesunięcie karty na spód, przed rozwiązaniem któregokolwiek przekierowanego dobierania; świeżo dobranych kart nie można wtedy wybrać. W compile.ts drawCards tworzy oczekujące wybory, lecz bury jest umieszczane nad nimi. Ponadto liczba opcji draw jest ograniczona długością biblioteki bez uwzględnienia store; pozostałe interakcje wymagają sprawdzenia. Poprzednia wąska ocena: Wąski zakres: opcjonalne draw do 3 i umieszczenie takiej samej liczby na spodzie biblioteki; cheap-tail.test.ts. Stan kodu sprawdzony ponownie: CardInstance w ręce nie ma pola owner (tylko MinionState i PermanentInPlay je mają), więc bury nie może trafić do biblioteki właściciela karty (RTR 19970425, LSJ 20060921); bury zawsze wraca do biblioteki kontrolera. Wymaga reprezentacji właściciela kart w ręce, niezbędnej także dla Agaitas (dotąd tylko cryptPerm).

<a id="karta-100941"></a>
### Hourglass of the Mind (100941) — PARTIAL_FIX

Występuje w **1** taliach. Częściowo naprawiono: odrębne warianty [pot]/[tem]; [tem] dobiera cztery karty bez discard, następnie wybiera do czterech kart z ręki na wierzch w zadanej kolejności i unlockuje przed zakończeniem akcji. Uwzględniono przekierowanie draw, zapis/wznowienie oraz pustą bibliotekę (tests/cards/hourglass-audit.test.ts). Przy niepełnej ręce/bibliotece przyjęto wykonanie możliwej części efektu analogicznie do G00160 (LSJ 20060620: 'draw as much as you can') — testy 'moves available cards even if fewer than four can be drawn', 'unlocks even with an empty hand' oraz nowe '[tem] draws as many cards as available when the library is short' i '[tem] with empty library and empty hand still unlocks' w tests/cards/hourglass-audit.test.ts (13 testów). Usunięto nieuprawnione +1 hand size superior bez counterów, lecz [TEM] nadal nie obsługuje opłacania counterów ani ich wpływu na hand size. Logi wyboru są maskowane, ale identyfikatory zakrytych kart w projekcji stanu nadal mogą umożliwiać ich śledzenie (istniejący szerszy problem prywatności). Kontrola mutacyjna: testy w hourglass-audit.test.ts pokrywają działanie [tem] przy niepełnej bibliotece i ręce. Pozostaje PARTIAL_FIX.

<a id="karta-101272"></a>
### Nephandus (101272) — PARTIAL_FIX

Występuje w **1** taliach. Zweryfikowano end-to-end: pełna walka (bleed, blok przez Nephandus, strike wyboru) oferuje „Nephandus: strike (1R)” obok hand strike; wybór ranged strike zabiera 1 krew opozycji, a jego własne życie nie spada przy hand strike przeciwnika (redukcja 1, tests/cards/nephandus.test.ts, 7 testów). Wcześniej: redukcja tylko w combat i tylko od strike/damaging effect przeciwnika; negatywne przypadki poza walką i środowiskowe. Kontrola mutacyjna: usunięcie reduzji obrażeń Nephandusa z cards.ts powoduje fail testów nephandus.test.ts (brak redukcji 1 przy ranged strike). Nadal nieweryfikowane: zachowanie przy kilku źródłach obrażeń jednocześnie oraz pełny zakres efektów strike 1R poza tym przebiegiem.

<a id="karta-101309"></a>
### Obedience (101309) — PARTIAL_FIX

Występuje w **2** taliach. Dodano sprawdzanie młodszego działającego vampire z uwzględnieniem capacity, właściwego blockera i powodzenia próby bloku; dodano reakcję celu niezablokowanego rush w state C. tests/cards/end-action.test.ts. Reakcja na rush korzysta z istniejącego okna C, a nie odrębnego impulsu bezpośrednio przed rozpoczęciem combat po zakończeniu innych efektów resolution; pełny timing i pozostałe interakcje nadal wymagają pracy. Paczka 1: pokryte przez end-action.test.ts (tylko blocker, młodszy vampire, rush, basic/superior). Nieobjęte: ANK 20171212 (zastąpiony przez slave nie może grać) — w modelu nieosiągalne: silnik nigdy nie przypisuje ponownie af.acting, więc zastąpienie wampira nie zmienia przeciwnika w akcji. LSJ 19991025 (starszy unlocked vampire przed nową walką) — otwarte. Sonda: Psyche! superior jest oferowana w combat.endOfRound (gdy Bob nie kontynuuje) i tworzy drugą walkę; Obedience nie ma okna przed startem tej walki. Bramka beforeCombatWithYoungerActor (compile.ts ~5435) obejmuje tylko walkę z akcji (stan C, blok, rush), nie walkę kolejkowaną. Domknięcie wymaga nowego okna 'przed startem kolejkowanej walki' w silniku — zmiana w przepływie walki, do akceptacji. Status bez zmian.

<a id="karta-101338"></a>
### Outside the Hourglass (101338) — PARTIAL_FIX

Występuje w **1** taliach. Dodano wariant basic tem maneuver i limit superior per vampire/runda. Superior jest jednorazowy i pochodzi od wampira, nie environmental, a pending damage rozstrzygane jest przed strike; tests/cards/outside-hourglass-audit.test.ts obejmuje oba wampiry, save/load i źródło. Zweryfikowano ANK 20180104 (tests/cards/outside-hourglass-premature.test.ts): obrażenia superior zostają zadane, gdy walka kończy się przedwcześnie w beforeRange; silnik naprawiony (engine.ts: oczekujące obrażenia przed range rozstrzygane przed zakończeniem). Kontrola mutacyjna: usunięcie rozstrzygania pendingDamage przed range w engine.ts powoduje fail testów outside-hourglass-premature.test.ts (obrażenia nie są zadawane przed endOfRound). Otwarte: prevention ma być dostępny w tym samym oknie przed range co inne efekty.

<a id="karta-101588"></a>
### Rego Motum (101588) — PARTIAL_FIX

Występuje w **2** taliach. Oba tryby ograniczono do obrażeń ze strike przeciwnika, nie dowolnego damage. tests/cards/prevention-provenance-audit.test.ts. Stare pakiety bez strikePhase nie są traktowane jako obrażenia ze strike (test w prevention-provenance-audit.test.ts: Rego Motum basic nie oferuje prewencji dla pakietu bez strikePhase); inne interakcje nieweryfikowane. Paczka 1: prevention-provenance-audit.test.ts pokrywa ograniczenie do strike przeciwnika. Zweryfikowano RTR 20041202 dla obu trybów (tests/cards/rego-motum-ruling.test.ts, 3 testy: 1 punkt przy basic zapobiega 1 i nic nie przechodzi dalej; superior zapobiega 3 z 3; basic przy 3 zapobiega 2 i zostawia 1; mutacja nieograniczonego zapobiegania wykrywana). Status bez zmian.

<a id="karta-101649"></a>
### Rolling with the Punches (101649) — PARTIAL_FIX

Występuje w **2** taliach. Superior działa tylko na strike przeciwnika, także na kolejne pakiety w rundzie, a nie na environmental lub unpreventable damage; respektuje zakaz prevention przez dyscyplinę. tests/cards/prevention-provenance-audit.test.ts. Stare pakiety bez strikePhase nie są traktowane jako obrażenia ze strike (test w prevention-provenance-audit.test.ts: Rolling with the Punches superior nie oferuje prewencji dla pakietu bez strikePhase); inne interakcje nieweryfikowane. Paczka 1: prevention-provenance-audit.test.ts pokrywa strike i brak wpływu na environmental/unpreventable. Zweryfikowano ANK 20210226 dla superior (tests/cards/rolling-punches-burn.test.ts: bramka wymaga 1 krwi na spalenie, a redukcja kosztu nie zmniejsza spalenia; mutacja bramki wykryta). Status bez zmian.

<a id="karta-101767"></a>
### Shilmulo Tarot (101767) — PARTIAL_FIX

Występuje w **1** taliach. Naprawiono: napełnienie z biblioteki (2 karty) tylko gdy Tarot wchodzi do gry wyposażony na minionie (onlyWhenEquipped); samo put into play nie bierze kart (LSJ 20090506). Test: tests/cards/library-search.test.ts. Heart i Black Market Cache: wybór przy każdym przekierowanym dobraniu, refill do rozmiaru ręki wznawiany po wyborze Tarot (draw-up-redirect.test.ts, heart-draw-redirect.test.ts, multiple-draw-redirects.test.ts). Nowe: wycofanie (p. 38) nie jest dostępne, dopóki Tarot z kartami może jeszcze dobrać (G00160, LSJ 20060620: dobieraj tyle, ile się da) — tests/cards/shilmulo-withdrawal.test.ts (3 testy, mutacja wykryta). Interpretacja: przy pustej bibliotece nadal wolno wybrać 'dobierz z biblioteki' i zakończyć (test draw-up-redirect 'stops if the chosen library is empty'). Kontrola mutacyjna: usunięcie onlyWhenEquipped z handlera Shilmulo Tarot w cards.ts powoduje fail testów library-search.test.ts (karta bierze karty nawet bez bycia wyposażoną). Otwarte: w oknie unlock nie ma dobrania z Tarot, bo karta mówi o zastąpieniu dobrania, a unlock nim nie jest; dobór następuje przy najbliższym dobieraniu do rozmiaru ręki. Kolejki wielokrotnego dobierania nadal otwarte.

<a id="karta-101897"></a>
### Summon History (101897) — PARTIAL_FIX

Występuje w **1** taliach. Basic [tem] i superior [TEM] wdrożone: X wybierane przy zagraniu i płacone wtedy (LSJ 20100314); szukanie w bibliotece i/lub stosie odrzuconych allies, retainers i equipment o koszcie <= X (krew albo pool), wejście na tego vampira z życiem startowym; ally wchodzi jako osobny minion (AllyEnteredPlay, nie recruited, więc może działać w tej turze, LSJ 20100302-1), bez zapłaty; superior: wybór non-scarce vampira z krypty lub stosu o capacity <= X, wejście bez krwi, krypta tasowana. Usunięto stub actionStealth 1, którego karta nie drukuje. beforeVampireEnteredPlay nie dotyczy tej karty: hook działa tylko przy przejściu z regionu niekontrolowanego w fazie influence (New Blood), a Summon History jest akcją. Kontrola mutacyjna: usunięcie handlera Summon History z cards.ts powoduje fail testów summon-history.test.ts (brak efektu X i wyszukiwania). Otwarte: retainer i equipment wchodzą przez attachFromZone bez jawnego wyboru wersji inferior (RBK equip, G00110); nie zweryfikowano, czy karty z wersją superior wymagającą dyscypliny dostają wersję podstawową. Ally na vampira: przyjęto odczyt, że ally jest osobnym minionem, a nie załącznikiem, bo silnik nie modeluje przypinania allies. Wampiry spalone przed zmianą nie mają migawki. Testy: tests/cards/summon-history.test.ts (17 testów).

<a id="karta-101931"></a>
### Talbot's Chainsaw (101931) — PARTIAL_FIX

Występuje w **1** taliach. Paczka 4: upkeep z karty — "If the bearer is ready during your unlock phase, this weapon inflicts 3 unpreventable damage on a ready minion you control". Wybiera KONTROLER (nie prey): unlockPhaseDamage.chooser = "controller" (spec.ts, compile.ts), bez wyboru gdy nosiciel nie jest gotowy lub nie ma gotowego miniona; tests/cards/talbot-chainsaw-unlock.test.ts. Press: "1 press (mandatory), only usable to continue combat during the first round" — nowa pula mandatoryFirstRoundContinuePress (state.ts, engine.ts): w rundzie 1 press jest obowiązkowy, a pula wygasa przy końcu rundy; tests/cards/talbot-chainsaw-press.test.ts (2 testy, mutacja wykryta). Kontrola mutacyjna: usunięcie mandatoryFirstRoundContinuePress z engine.ts powoduje fail testów talbot-chainsaw-press.test.ts (press nie jest wymagany w rundzie 1). Wcześniej: cannotHunt, rush z stealth 1, prevent 1 per combat, blokada hunt przy 0 blood (bots-hunt.test.ts). Nadal nieweryfikowane: rush/prevent i ich interakcje z innymi kartami wymagają przeglądu.

<a id="karta-102144"></a>
### War Ghoul (102144) — PARTIAL_FIX

Występuje w **1** taliach. Overlay wymaga rekrutującego Tzimisce i uwzględnia modyfikatory kosztu; testy rush-cards.test.ts i retainer-wave.test.ts. Zweryfikowano RTR 19961113 (Ghoul jako jedyny sojusznik musi spalić się sam) i ANK 20170309-2 (wejście każdą drogą): tests/cards/war-ghoul-burn-rule.test.ts, 3 testy; mutacja usuwająca opcję 'self' wykryta. Kontrola mutacyjna potwierdzona. Pozostałe interakcje alternatywnych kosztów i rekrutacji wymagają dalszej weryfikacji.

<a id="karta-102199"></a>
### Yawp Court (102199) — PARTIAL_FIX

Występuje w **1** taliach. Naprawiono kolejkę walk przed referendum i jego anulowanie po opuszczeniu ready przez działającego wampira. tests/cards/crypt-and-uncontrolled.test.ts: rzeczywisty torpor (także w drugiej walce Psyche!), torpor samego przeciwnika, symulowany powrót i save/load, damage między walkami. Kontrola mutacyjna: 7 testów w crypt-and-uncontrolled.test.ts nie przechodzi bez obsługi queuedCombats w engine.ts (afterResolution ambush window). Zweryfikowano RTR 19970630 (crypt-and-uncontrolled.test.ts: obrażenia ambush są zadawane po CombatEnded jako środowiskowe, bez DamageInflicted). Faktyczne użycie Warsaw Station w środku akcji nie jest zaimplementowane; Rötschreck i pozostałe interakcje timingów/prevention niezweryfikowane. Rulings LSJ 20060902, LSJ 20090325-1, ANK 20180910-1.

<a id="karta-102233"></a>
### Revelation of the Serpent (102233) — PARTIAL_FIX

Występuje w **2** taliach. Superior oferuje wybór corruption tylko po rozstrzygnięciu oust i okna Life Boon; po oust celu nie oferuje unlock [ANK 20220210], po uratowaniu celu umożliwia wybór również po save/load; Sleeping Mind blokuje unlock. Testy revelation-of-the-serpent.test.ts. Pozostałe efekty sukcesu, kolejność i interakcje wymagają weryfikacji. Paczka 1: ANK 20220210 (ousted przez bleed nie odblokowuje) pokryte przez revelation-of-the-serpent.test.ts; nie sprawdzono pozostałych efektów sukcesu i kolejności. Status bez zmian.

<a id="karta-102246"></a>
### Childe of the Revolution (102246) — PARTIAL_FIX

Występuje w **2** taliach. Osobny obowiązek hunt trwa do ogłoszenia hunt lub końca tury nawet po uzyskaniu blood; tests/cards/token-vampire.test.ts. Pozostałe interakcje i granice tury wymagają dalszej weryfikacji. Aktualizacja: obowiązek nie przechodzi na kolejną turę, jeżeli Childe został przeniesiony do uncontrolled (test emitujący zdarzenie Banishment i save/load w token-vampire.test.ts). Wybór źródeł wyszukania i pozostałe interakcje nadal wymagają audytu. Kontrola mutacyjna: usunięcie handlera hunt obligation z Childe w cards.ts powoduje fail testów token-vampire.test.ts (brak obowiązku hunt po wejściu). Paczka 1: pokryte przez token-vampire.test.ts (obowiązek hunt, uncontrolled, Anarch). Zweryfikowano LSJ 20041201-2 w zakresie osiągalnym w silniku (tests/cards/childe-token-burn.test.ts: spalony token trafia do ash heap, crypt bez zmian; silnik nie ma ścieżki wkładania tokena z biblioteki do crypt). Status bez zmian.

<a id="karta-102262"></a>
### Touch of Valeren (102262) — PARTIAL_FIX

Występuje w **2** taliach. Combat ograniczono do strike przeciwnika; prevention-provenance-audit.test.ts bada dostępność i źródła. Action dopuszcza pełnego aktora, jeśli koszt krwi zostawia miejsce, respektuje ochronę przed wyborem i limit starting life ally; minion-target-actions.test.ts. Stare pakiety bez strikePhase nie są traktowane jako obrażenia ze strike (test w prevention-provenance-audit.test.ts: Touch of Valeren basic nie oferuje prewencji dla pakietu bez strikePhase). Pełne przejście superior oraz dalsze interakcje pozostają otwarte. Paczka 1: minion-target-actions.test.ts i prevention-provenance-audit.test.ts pokrywają akcję i combat. Zweryfikowano LSJ 20001114 dla basic combat (tests/cards/touch-valeren-ruling.test.ts: opcja jest oferowana tylko przy obrażeniach do zapobieżenia, nie bez nich). Status bez zmian.

<a id="karta-102314"></a>
### Dance of the Dead (102314) — PARTIAL_FIX

Występuje w **1** taliach. Zdolność można teraz aktywować w dalszych oknach walki, w tym w kroku press. wraith-zombie.test.ts sprawdza press, zużycie ostatniego countera i spalenie karty, limit na combat, kontrolę celu oraz maneuver zachowany do następnej rundy po save/restore. Dodano okno damage resolution (wraith-zombie.test.ts: opcja jest oferowana i zdejmuje licznik). Kontrola mutacyjna: usunięcie grantu combatgrant z Dance of the Dead handlera powoduje fail testów wraith-zombie.test.ts. Pozostają do zbadania pozostałe okna oraz interakcje z ograniczeniami ruchu i timingiem. Uwaga: ogólna legalność kart library wymagających Path nadal wymaga egzekwowania; samo pole Path przywrócono do registry.

<a id="karta-102315"></a>
### Dance with the Devil (102315) — PARTIAL_FIX

Występuje w **1** taliach. Superior nie pobiera blood automatycznie; w kroku range można opcjonalnie zapłacić za dodatkowy close maneuver, a bez blood nadal zagrać kartę. round-end.test.ts. Zakup jest obecnie dostępny tylko w range przy long, nie dowolnie w rundzie; wymagane są dalsze prace nad timingiem i ograniczeniami dyscyplin.

<a id="karta-102336"></a>
### Rage of Apedemak (102336) — PARTIAL_FIX

Występuje w **1** taliach. Bonus dotyczy hand strike, nie strength ani melee weapon; testy hand, Roundhouse i Femur oraz hand size. tests/cards/frenzy-direction-audit.test.ts i temporary-hand-size.test.ts. Wygaszanie wszystkich wcześniejszych efektów frenzy przez Shield wymaga dalszej weryfikacji.

<a id="karta-102362"></a>
### Tranquility Shield (102362) — PARTIAL_FIX

Występuje w **1** taliach. Zachowuje niezależne ograniczenia przy anulowaniu frenzy, zarówno nałożone przed nim, jak po nim, także po save/load; testy frenzy-direction-audit.test.ts. W starych zapisach brak wystarczającej informacji o pochodzeniu ograniczeń, dlatego zachowywane są niejednoznaczne flagi. Pełna zgodność wszystkich możliwych efektów frenzy wymaga dalszej weryfikacji; wcześniejsza ocena była tylko wąska.

<a id="karta-200039"></a>
### Alabástrom (G6) (200039) — PARTIAL_FIX

Występuje w **1** taliach. Dodano once-per-turn unlock innego własnego ready Gargoyle podczas własnej tury, wraz z ready/locked i negatywnymi testami; crypt-wave-5.test.ts. Nie wszystkie okna i interakcje unlock zweryfikowane.

<a id="karta-200048"></a>
### Alex Wilkins (G5) (200048) — PARTIAL_FIX

Występuje w **1** taliach. Dodano opcję końcowego celu successful bleed po rozstrzygnięciu: zapłata 1 pool i przejęcie Alexa albo odmowa. tests/cards/alex-wilkins-audit.test.ts obejmuje przekierowanie, zero bleed i save/load. Wymaga weryfikacji kolejności względem oust i innych efektów rozstrzygnięcia.

<a id="karta-200076"></a>
### Anarch Convert (ANY) (200076) — PARTIAL_FIX

Występuje w **4** taliach. Opcjonalny wybór przed contestem przy wejściu, usunięcie Convert, zmiana sekty nietytułowanego wampira i wybór pool lub crypt draw; wybór przeżywa serializację. tests/cards/anarch-convert-audit.test.ts. Dalsza weryfikacja wszystkich interakcji wejścia i następstwa zdarzeń. Aktualizacja: wybór draw jest dostępny również przy pustym crypt [LSJ 20060620]; conversion nadal następuje, pool się nie zmienia. tests/cards/anarch-convert-audit.test.ts obejmuje także save/load. Hackerspace: Convert wchodzi (counter) przed usunięciem i zmianą sekty; counter za zmianę tylko przy realnej zmianie. Pokryte przez tests/cards/hackerspace-audit.test.ts.

<a id="karta-200081"></a>
### André the Manipulator (G5) (200081) — PARTIAL_FIX

Występuje w **1** taliach. +2 hand size wyliczane dla ready, także locked; torpor usuwa bonus, test crypt-wave-1.test.ts. Automatyczny draw/discard przy zmianie stanu i wszystkie przejścia wejścia/wyjścia nadal wymagają poprawy.

<a id="karta-200257"></a>
### Cedric (G4) (200257) — PARTIAL_FIX

Występuje w **1** taliach. Dodano możliwość zapłacenia 1 blood za unlock po blokowaniu akcji directed, w oknie po rozstrzygnięciu i walce; tests/cards/cedric-audit.test.ts obejmuje brak celu przy akcji undirected, zapłatę, odmowę i save/load. Flight importowany i testowany. Nadal brak implementacji Tremere slave, a ścisły timing po natychmiastowym zakończeniu akcji i przy kontynuacji po bloku wymaga dalszego przeglądu. Źródła: https://www.vekn.net/179-rules/vtes-rulebook oraz https://www.vekn.net/forum/rules-questions/75320-rules-questions-for-someone-coming-back-in-to-v-tes.

<a id="karta-200365"></a>
### Donald Cargill (G5) (200365) — PARTIAL_FIX

Występuje w **1** taliach. Po passed referendum wywołanym przez predatora spala 1 blood; test pass/fail i innego kontrolera w referendum-outcomes.test.ts. Predator odczytywany z chwili wezwania referendum (predatorAtCall): spalenie działa także, gdy predator zostaje usunięty przez to referendum [LSJ 20090115-2]; test w referendum-outcomes.test.ts (Treachery). Dodano sprawdzenie inTorpor: Donald w torporze nie spala krwi (test w referendum-outcomes.test.ts; fix w cards.ts: m.inTorpor). Kontrola mutacyjna: test torpor nie przechodzi bez sprawdzenia inTorpor. Nadal otwarte: niestandardowe referendum.

<a id="karta-200608"></a>
### Hrothulf (G3) (200608) — PARTIAL_FIX

Występuje w **1** taliach. Dodano directed rush Hrothulfa na ready miniona innego Methuselah, tylko przy posiadaniu Edge; koszt spalany przy sukcesie, zgodnie z rulingiem LSJ 20030519. tests/cards/hrothulf-audit.test.ts obejmuje targety, blok, sukces, Go-getter i save/restore. Kontrola mutacyjna: test 'cannot pay the effect if the Edge changes hands before resolution' nie przechodzi bez obsługi utraty Edge w akcji Hrothulfa. Po utracie Edge przed rozpatrzeniem przyjęto interpretację: akcja pozostaje udana, ale nie dochodzi do walki; ten przypadek wymaga potwierdzenia rulingiem i pozostaje otwarty.

<a id="karta-201052"></a>
### New Blood (ANY) (201052) — PARTIAL_FIX

Występuje w **2** taliach. Dodano wybór dowolnego nazwanego circle albo circle jednego znanego wampira przed wejściem i contest, model identyfikacji circle oraz dobór crypt w swojej influence; wybór przeżywa save/load i jest usuwany po powrocie do uncontrolled. Wykorzystują go Unwholesome Bond i Camaraderie (także circle of one oraz save/load); pozostałe karty Sanguinus nie są jeszcze zintegrowane z modelem, a wszystkie sposoby wejścia i interakcje contest wymagają kontroli. tests/cards/new-blood-audit.test.ts, blood-brother-circle-audit.test.ts, unwholesome-bond-circle-audit.test.ts. Korekta poprzedniego ustalenia: późniejszy ruling Rules Director z 13.11.2021 pozwala New Blood dołączyć do circle of one innego wampira, wbrew starszej interpretacji z 2019: https://www.vekn.net/forum/rules-questions/79465-unwholesome-bond-angelo-circle-of-one-new-blood-and-circle. Paczka 2: ANK 20211113 (dwa uncontrolled New Blood w różnych kręgach) nie ma osobnego testu w tej paczce. Status bez zmian.

<a id="karta-201274"></a>
### Shalmath (G6) (201274) — PARTIAL_FIX

Występuje w **1** taliach. Częściowo naprawiono unlock Shalmatha raz na każdą turę w obsługiwanych oknach impulsu, z zakazem w card.asPlayed oraz The Sleeping Mind. Testy shalmath-audit.test.ts obejmują własną i cudzą turę, unlock phase, limit, save/restore oraz torpor. Zakaz Celerity i Scarce importowane i testowane wcześniej. Nie potwierdzono kompletności wszystkich okien czasowych ani wszystkich ścieżek zakazu dyscypliny; wpis pozostaje otwarty.

<a id="karta-201462"></a>
### Walker Grimes (G5) (201462) — PARTIAL_FIX

Występuje w **1** taliach. Dodatkowy pool dla master targetujących Walkera i kontrolera; cena, płatność, limit pool i zmiana kontroli testowane w granted-bleed-target-costs.test.ts. Naprawiono też bramkę affordability dla attachAnyMinion/attachClan; inne ścieżki zagrania master i regiony wymagają weryfikacji.

<a id="karta-201510"></a>
### Zubeida (G5) (201510) — PARTIAL_FIX

Występuje w **1** taliach. Naprawiono warunkowe bleed i usunięto błędne staty bezwarunkowe tam, gdzie występowały; testy tests/cards/crypt-conditional-wave.test.ts sprawdzają dodatnie i ujemne warunki, a dla strength także rzeczywiste hand strike. Pozostałe opisane w historycznej analizie zdolności lub warunki nadal wymagają pracy; nie oznacza pełnej naprawy karty. Historyczna analiza (może opisywać już naprawione klauzule): Aktualizacja: drukowany niemerged Scarce importowany i kara za wejście w fazie influence testowana w crypt-scarce.test.ts; inne problemy pozostają otwarte. Historyczna analiza sprzed poprawki Scarce: Aktualizacja: import drukowanego Sterile naprawiono i sprawdzono w crypt-sterile.test.ts; inne opisane poniżej rozbieżności pozostają otwarte. Historyczna analiza (twierdzenie o braku importu sterile jest już nieaktualne): Spec daje stały +1 bleed zamiast tylko przeciw kontrolerowi bez ready vampire capacity powyżej 6; Black Hand, Scarce i sterile nie importowane. Porównano tekst i spec oraz wyszukano osobne implementacje; bez nowego testu scenariuszowego. Aktualizacja: drukowana cecha Black Hand/Seraph jest obecnie importowana i używana we wskazanych wymaganiach bibliotecznych; pozostałe ustalenia i interakcje nie zostały tym zamknięte (black-hand-traits.test.ts).

<a id="karta-201608"></a>
### Nonu Dis (G6) (201608) — PARTIAL_FIX

Występuje w **1** taliach. Poprawiono ofertę: opcjonalny wybór bezpośrednio po konkretnym zagraniu mastera (także po zagnieżdżonych wyborach), odmowa nie zużywa użycia; limit raz na fazę i jego reset. Regresje crypt-wave-7.test.ts obejmują Blood Doll, dwa mastery, legalność celu i save/restore. Wcześniejsze założenie o braku limitu było błędne: ruling Rules Directora potwierdza szablon „during X, do Y” (https://www.vekn.net/forum-es/rules-questions/79835-nonu-dis-and-during-x-do-y). Kontrola mutacyjna: usunięcie obsługi afterMasterPlayed w compile.ts powoduje fail testów crypt-wave-7.test.ts (brak oferty masterBlood). Wpływ anulowania i nietypowych sposobów zagrania mastera wymaga dalszego ustalenia i testów; obecny hook przyjmuje również anulowane zagranie.

<a id="karta-201680"></a>
### Opikun (G7) (201680) — PARTIAL_FIX

Występuje w **2** taliach. Opikun może chronić siebie lub innego kontrolowanego vampire przed nieaggravated damage ze strike przeciwnika, bez zmiany wymogu another u Huldu. tests/cards/hecata-huldu-audit.test.ts. Stare zapisy z pakietem bez strikePhase nie są traktowane jako obrażenia ze strike (test 'does not guess later strike identity in a legacy save with no phase id' w tests/cards/hecata-huldu-audit.test.ts). Zapobieganie obejmuje wiele nieaggravated pakietów tego samego strike, z wyłączeniem unpreventable, innego strike i environmental. Nadal ograniczenia starszych zapisów oraz okna/właściwej kolejności obrażeń. Paczka 2: ponownie sprawdzono tekst (independent, do 2 nieaggravated z jednego strike). Wciąż otwarte: okno kolejności obrażeń i stare zapisy bez pochodzenia; status bez zmian.

<a id="karta-201750"></a>
### Eulogio Sánchez de los Reyes (G6) (201750) — PARTIAL_FIX

Występuje w **1** taliach. grantedAction reorderTop 5, +1 stealth, 1 blood i unlockActor; porównano spec i kompilator. Ograniczony zakres; bez nowego scenariusza. Aktualizacja: Unlock przy reorderTop pomijany przy superior Sleeping Mind; brak osobnego testu end-to-end tego połączenia.

<a id="karta-201754"></a>
### Gostoso (G6) (201754) — PARTIAL_FIX

Występuje w **1** taliach. Po successful bleed prey gracz wybiera gain blood lub odmowę, wybór można zapisać i wznowić; crypt-wave-4.test.ts. Wybór jest kolejkwany przez resolver akcji, timing względem wszystkich efektów rozstrzygnięcia wymaga weryfikacji.

<a id="karta-201776"></a>
### Věnceslava, The Implacable (G6) (201776) — PARTIAL_FIX

Występuje w **1** taliach. Gain pool jest opcjonalny; odmowa nie zużywa once-per-turn i działa późniejsza kwalifikująca akcja, także po zapisie. crypt-wave-4.test.ts. Brak zysku, gdy kontroler został ousted (ANK 20220808; guard w compile.ts, test w crypt-wave-4.test.ts). Kontrola mutacyjna: usunięcie guarda ousted w compile.ts powoduje fail testu 'offers no gain once her controller is ousted before the action resolves'. Identyfikacja prey i kolejność przy zmianie/oust oraz wszystkich zagnieżdżonych zdarzeniach wymagają weryfikacji.

