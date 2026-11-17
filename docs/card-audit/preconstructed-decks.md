# Audyt kart w przygotowanych taliach

Zakres: 42 talii dostępnych w wyborze (`shell.ts`: `playable || halfDeck`): 28 pełnych i 14 half-decków. Źródło talii: `src/cards/registry.json`, snapshot 2026-11-01T20:12:30.427Z.

To zestawienie aktualnych wpisów audytu, nie ponowna weryfikacja wszystkich klauzul 727 kart. Do identyfikacji statusów użyto `docs/card-audit/manual-findings.json`; statusy i uzasadnienia mogą wymagać aktualizacji. Sama flaga `supported`, handler ani brak wykrytych błędów nie dowodzą pełnej poprawności.

## Podsumowanie

- Unikalne karty: **727**; z wpisem w audycie: **727**; bez wpisu: **0**. Brakujące ID w registry: **0**; karty bez flagi supported: **0**.
- Otwarte ustalenia dotyczą **57 różnych kart**: CODE_DISCREPANCY 1, PARTIAL_FIX 56, CONFIRMED_BUG 0, UNRESOLVED 0. UNRESOLVED oznacza kwestię nierozstrzygniętą, nie potwierdzony błąd.
- **29/42 talii** zawiera co najmniej jeden otwarty lub niezweryfikowany wpis. Pozostałe talie nie mają takich wpisów, ale to nadal nie dowód kompletnej poprawności.
- REVIEWED_NO_ISSUE_FOUND: **590** kart; FIXED_TARGETED: **80**. Obie klasy oznaczają ograniczony zakres sprawdzenia/naprawy, a nie certyfikat wszystkich interakcji.

## Dodatkowe scenariusze odtworzone w silniku

- **Blood Doll (100199)**: Nie zaoferowano zagrania na ally w tym scenariuszu; nie dowodzi to pełnej poprawności karty. Liczba talii: 17.
- **Villein (102121)**: Po zagraniu pierwszej Villein na wampira z 5 blood i przeniesieniu 2, druga opcja na tego wampira ma koszt **1 pool** — zgodny z wymaganym +1 pool w tym scenariuszu. To kontrola konkretnego scenariusza, nie wszystkich klauzul. Liczba talii: 17.

Regeneracja: `npx tsx scripts/card-audit-precons.mts`. Scenariusze używają syntetycznych fixture'ów z `tests/engine/fixtures.ts`; dane produkcyjne i silnik są takie jak w aplikacji.

## Zestawienie talii

Liczby to **różne ID kart**, a nie liczba kopii. Listy obejmują tylko otwarte ustalenia i brakujące wpisy; szczegółową ewidencję wszystkich kart i ich dowodów zawiera `preconstructed-cards.csv`.

| Zestaw / talia | Typ | Różnych kart | Otwarte / bez wpisu | Karty z otwartym ustaleniem |
|---|---|---:|---:|---|
| Fifth Edition / Hecata | pełna | 39 | 1 | [Rolling with the Punches](#karta-101649) |
| Fifth Edition / Lasombra | pełna | 36 | 2 | [The Sleeping Mind](#karta-101805), [Touch of Oblivion](#karta-102283) |
| Fifth Edition / Malkavian | pełna | 30 | 0 | — |
| Fifth Edition / Nosferatu | pełna | 35 | 0 | — |
| Fifth Edition / Toreador | pełna | 29 | 0 | — |
| Fifth Edition / Tremere | pełna | 33 | 1 | [Magic of the Smith](#karta-101143) |
| Fifth Edition / Ventrue | pełna | 32 | 1 | [Anarch Troublemaker](#karta-100058) |
| Fifth Edition (Anarch) / Banu Haqim | pełna | 34 | 1 | [Rego Motum](#karta-101588) |
| Fifth Edition (Anarch) / Brujah | pełna | 37 | 0 | — |
| Fifth Edition (Anarch) / Gangrel | pełna | 38 | 0 | — |
| Fifth Edition (Anarch) / Ministry | pełna | 36 | 3 | [Heart of Nizchetus](#karta-100903), [Revelation of the Serpent](#karta-102233), [Nonu Dis (G6)](#karta-201608) |
| Fifth Edition (Companion) / Ravnos | pełna | 39 | 1 | [Shilmulo Tarot](#karta-101767) |
| Fifth Edition (Companion) / Salubri | pełna | 43 | 4 | [Anarch Troublemaker](#karta-100058), [Rolling with the Punches](#karta-101649), [Touch of Valeren](#karta-102262), [Opikun (G7)](#karta-201680) |
| Fifth Edition (Companion) / Tzimisce | pełna | 40 | 2 | [War Ghoul](#karta-102144), [Childe of the Revolution](#karta-102246) |
| New Blood / Malkavian | half-deck | 30 | 0 | — |
| New Blood / Nosferatu | half-deck | 32 | 0 | — |
| New Blood / Toreador | half-deck | 27 | 0 | — |
| New Blood / Tremere | half-deck | 30 | 3 | [Fragment of the Book of Nod](#karta-100785), [Magic of the Smith](#karta-101143), [Rego Motum](#karta-101588) |
| New Blood / Ventrue | half-deck | 28 | 0 | — |
| New Blood II / Banu Haqim | half-deck | 32 | 2 | [Blur](#karta-100227), [Khabar: Glory](#karta-101043) |
| New Blood II / Brujah | half-deck | 30 | 1 | [Childe of the Revolution](#karta-102246) |
| New Blood II / Gangrel | half-deck | 31 | 0 | — |
| New Blood II / Ministry | half-deck | 33 | 2 | [Waters of Duat](#karta-102159), [Revelation of the Serpent](#karta-102233) |
| New Blood III / Hecata | half-deck | 25 | 1 | [Psychophagia](#karta-102302) |
| New Blood III / Lasombra | half-deck | 24 | 1 | [Raising the Portcullis](#karta-102303) |
| New Blood III / Ravnos | half-deck | 31 | 2 | [AK-47](#karta-100032), [Terror Frenzy](#karta-101960) |
| New Blood III / Salubri | half-deck | 27 | 4 | [Vast Wealth](#karta-102092), [Touch of Valeren](#karta-102262), [Tranquility Shield](#karta-102362), [Opikun (G7)](#karta-201680) |
| New Blood III / Tzimisce | half-deck | 34 | 0 | — |
| Sabbat V5 / Path of Caine | pełna | 36 | 4 | [Yawp Court](#karta-102199), [Augury of Doom](#karta-102310), [Dance with the Devil](#karta-102315), [Rage of Apedemak](#karta-102336) |
| Sabbat V5 / Path of Cathari | pełna | 35 | 3 | [Anarch Troublemaker](#karta-100058), [Fever Pitch](#karta-102321), [Gostoso (G6)](#karta-201754) |
| Sabbat V5 / Path of Death | pełna | 41 | 3 | [Obedience](#karta-101309), [Dance of the Dead](#karta-102314), [Eulogio Sánchez de los Reyes (G6)](#karta-201750) |
| Sabbat V5 / Path of Power and the Inner Voice | pełna | 42 | 1 | [Věnceslava, The Implacable (G6)](#karta-201776) |
| 🏆 Tournament Winners 2025 / 2025-10-19 — Shalmath Toolbox (EC Day 2, Aarhus — Nerijus Mikalajūnas, 50p) | pełna | 36 | 16 | [Big Game](#karta-100159), [Enkil Cog](#karta-100645), [Eye of Hazimel](#karta-100678), [Heart of Nizchetus](#karta-100903), [Hourglass of the Mind](#karta-100941), [Nephandus](#karta-101272), [Outside the Hourglass](#karta-101338), [Summon History](#karta-101897), [Talbot's Chainsaw](#karta-101931), [Tye Cooper](#karta-102053), [Alex Wilkins (G5)](#karta-200048), [Anarch Convert (ANY)](#karta-200076), [Donald Cargill (G5)](#karta-200365), [New Blood (ANY)](#karta-201052), [Shalmath (G6)](#karta-201274), [Walker Grimes (G5)](#karta-201462) |
| 🏆 Tournament Winners 2025 / 2025-06-21 — Gangrel Death Star (NAC 2025, Columbus — Martin Weinmayer, 62p, Wall) | pełna | 41 | 2 | [Heart of Nizchetus](#karta-100903), [André the Manipulator (G5)](#karta-200081) |
| 🏆 Tournament Winners 2024 / 2024-06-22 — Govern Resistance (NAC 2024, Columbus — Bill Troxel, 54p, Tzimisce Toolbox) | pełna | 35 | 1 | [New Blood (ANY)](#karta-201052) |
| 🏆 Tournament Winners 2024 / 2024-11-16 — Gangrel Swarm v3 (Slovak NC, Bratislava — Jakub Rypar, 22p, Wall/Swarm) | pełna | 38 | 0 | — |
| 🏆 Tournament Winners 2024 / 2024-02-10 — Malkavian 95 Bleed (Mexico NC — Melissa Avilés, 10p, Stealth & Bleed) | pełna | 28 | 3 | [Alabástrom (G6)](#karta-200039), [The Sleeping Mind](#karta-101805), [Spirit Marionette](#karta-101848) |
| 🏆 Tournament Winners 2024 / 2024-07-21 — Usurper High Council (Helsinki, Martin Weinmayer, 22p, Vote) | pełna | 25 | 0 | — |
| 🏆 Tournament Winners 2026 / 2026-06-27 — Lasombra Potato Groove (Spanish NC, Leganés — Miquel Jorge, 158p, Vote/Bleed) | pełna | 35 | 1 | [Obedience](#karta-101309) |
| 🏆 Tournament Winners 2024 / 2024-06-21 — The Unnamed Six Demon Bag (Origins Friday 2, Columbus — Darby Keeney, 44p, Baali Bleed) | pełna | 31 | 3 | [Anarch Convert (ANY)](#karta-200076), [Zubeida (G5)](#karta-201510), [Heart of Nizchetus](#karta-100903) |
| 🏆 Tournament Winners 2023 / 2023-10-15 — Tupdog Brick Wall (EC 2023 Finalist — Rush Wall) | pełna | 34 | 4 | [Anarch Convert (ANY)](#karta-200076), [Hrothulf (G3)](#karta-200608), [Cedric (G4)](#karta-200257), [Drawing Out the Beast](#karta-100585) |
| 🏆 Tournament Winners 2024 / 2024-03-09 — Weenie Animalism (Oceania NC, Auckland — Rush/Bleed) | pełna | 27 | 4 | [Anarch Convert (ANY)](#karta-200076), [Cry Wolf](#karta-100475), [Drawing Out the Beast](#karta-100585), [Terror Frenzy](#karta-101960) |

## Otwarte ustalenia — karty

Poniższe opisy przytoczono z audytu. CODE_DISCREPANCY bywa oparte wyłącznie na analizie statycznej; CONFIRMED_BUG jest statusem historycznym i nie zawsze oznacza odtworzenie nowym testem. Nie wolno traktować UNRESOLVED jako potwierdzonego błędu.

<a id="karta-100032"></a>
### AK-47 (100032) — PARTIAL_FIX

Występuje w **1** taliach. Dodatkowy strike jest nadal przyznawany po strike'u z broni, ale jest OPCJONALNY: w dodatkowej sub-rundzie strzelec może wybrać 'strike:decline' (bez obrażeń, zwalnia zobowiązanie do broni). Flaga CombatFrame.optionalAdditionalStrike jest ustawiana tylko dla opcjonalnych przyznań (AK-47, Caseless Rounds); zwykłe dodatkowe strike'i jej nie mają. Testy: tests/cards/weapon-riders.test.ts + last-equipment-modifiers.test.ts: 57 testów łącznie, w tym 'the optional extra strike can be DECLINED'. Pełne tests/cards+tests/engine: 398 plików, exit 0. NIEZROBIONE: wybór innego limitowanego źródła zamiast grantu AK-47 (kolejność przed grantem), docs/additional-strike-followups.md.

<a id="karta-100058"></a>
### Anarch Troublemaker (100058) — PARTIAL_FIX

Występuje w **3** taliach. Naprawiono wybór vampire przeciwnika: karta nie wymaga ani ready, ani unlocked, więc uwzględnia vampire w torpor i już locked (bez fałszywego zdarzenia zmiany stanu). Wyklucza uncontrolled i allies. tests/cards/anarch-troublemaker-audit.test.ts; zasada celu w torpor: https://www.vekn.net/forum/rules-questions/81293-touch-of-valeren; wybór locked: https://www.vekn.net/forum/rules-questions/39816-ec-2012-can-you-answer-these?start=12. Nadal nierozstrzygnięte, czy aktualne „up to two” pozwala przekazać kartę bez żadnego celu; historyczny RTR 19950413 mówi o jednym lub dwóch.

<a id="karta-100159"></a>
### Big Game (100159) — PARTIAL_FIX

Występuje w **1** taliach. Usunięto błędnie przyznawane każdemu celowi maneuver i press. tests/cards/rush-cards.test.ts potwierdza rush na zwykły cel bez obu bonusów i bez unlock. Red List nie jest jeszcze modelowana: prawidłowy opcjonalny maneuver albo press i unlock przy celu Red List pozostają do zrobienia; karta nie jest w pełni poprawna. Paczka 2: tekst (Ⓓ, Red List: optional maneuver lub press i unlock przy końcu akcji) pozostaje częściowo niezaimplementowany wg ustaleń paczki 1; status bez zmian.

<a id="karta-100227"></a>
### Blur (100227) — PARTIAL_FIX

Występuje w **1** taliach. Zweryfikowano: basic daje 1 dodatkowy strike, superior 2 (limited), grant po pierwszej parze; tests/cards/combat-strikes.test.ts (Blur superior: 3 uderzenia M, 2 dodatkowe sub-rundy) i Quickness współistniejący z Blur (Quickness nieograniczony nie zużywa źródła limitowanego); limit egzekwowany przez usedLimitedAddl (tests/cards/weapon-riders.test.ts: AK-47 i limitowany Blur). NIEZROBIONE, WSPÓLNE Z SILNIKIEM: kolejność okna kolejnych źródeł przy oczekujących strike'ach (LSJ 20001206, docs/additional-strike-followups.md) nie jest jeszcze przebudowana; dotyczy źródeł nieograniczonych, nie zmienia liczby strike'ów Blur. Nie jest błędem specyficznym dla Blur.

<a id="karta-100475"></a>
### Cry Wolf (100475) — PARTIAL_FIX

Występuje w **1** taliach. Paczka 4: zablokowana zagrywka (recruit) wysyła działającego anarcha do torporu (hook onActionBlockedAsPlayed); werewolf pozostaje locked (bearerDoesNotUnlock), a jeśli jest locked w unlock phase, zostaje spalony. tests/cards/cry-wolf.test.ts z kontrolą bez bloku. Nadal brak obowiązkowego Ⓓ rush na minion innego Methuselah i pressa przy walce (press jest statycznie). LSJ 20090226 i LSJ 20031014 nieprzetestowane osobno.

<a id="karta-100585"></a>
### Drawing Out the Beast (100585) — PARTIAL_FIX

Występuje w **2** taliach. Oba poziomy niedostępne przeciw ally [PIB 20121028]; superior zadaje unpreventable environmental damage w press step przed decyzjami o press, nie po wcześniejszym końcu walki. frenzy-direction-audit.test.ts: kolejność, torpor, dwie rundy, save/load na decyzji press, Flesh of Marble i Bloodform. Stare zapisy bez pochodzenia ograniczeń oraz inne interakcje nadal wymagają przeglądu. Paczka 1: ponownie sprawdzono rulings (PIB 20121028, RTR 19970630, LSJ 20010312); pokryte przez frenzy-direction-audit.test.ts (w tym przerwanie przez combat-ends). Status bez zmian: brak przeglądu starych zapisów.

<a id="karta-100645"></a>
### Enkil Cog (100645) — PARTIAL_FIX

Występuje w **1** taliach. Po successful bleed przeciw prey karta jest teraz unikalnym permanentem na aktorze capacity >=10 i daje mu stałe +1 bleed. tests/cards/enkil-cog-audit.test.ts. Wciąż brak dodatkowej akcji w dowolnej minion phase, a relacja prey po oust wymaga weryfikacji. Paczka 2: LSJ 20081213-1 (anulowana akcja przy zagraniu nie zużywa Cog) nie ma testu; dodatkowa akcja w minion phase nadal brakuje. Status bez zmian.

<a id="karta-100678"></a>
### Eye of Hazimel (100678) — PARTIAL_FIX

Występuje w **1** taliach. Naprawiono jednoczesne nadawanie superior Potence i Chimerstry; tests/cards/eye-hazimel-audit.test.ts sprawdza oba poziomy oraz usunięcie bonusów po utracie karty. Nadal brak zakazu przenoszenia/kradzieży, upkeep 1 pool i 5 unpreventable damage przy spaleniu; te istotne błędy pozostają otwarte. Paczka 2: dodano 5 unpreventable environmental damage na bearera przy spaleniu przez burnPermanent (onLeavePlay, eye-hazimel-audit.test.ts). Nadal brak: upkeep w unlock phase (1 pool albo spalenie karty), zakaz przenoszenia/kradzieży przy ready bearerze; spalenia poza burnPermanent nie wywołują hooka.

<a id="karta-100785"></a>
### Fragment of the Book of Nod (100785) — PARTIAL_FIX

Występuje w **1** taliach. Fragment of the Book of Nod: osobny handler realizuje draw/discard i ogranicza ability do faz własnej tury; jego komentarz wskazuje możliwe szersze okno. Tekst nie określa timingu; potrzebne rozstrzygnięcie zasad oraz testy poza własną turą. Aktualizacja: Poszerzono dostępność o zwykłe impulsy w turze innych Methuselahów, akcjach i walce, z wyłączeniem as-played. Dwa dobierania są kontynuowane przed discard down także przy przekierowaniu i po save/load; tests/cards/fragment-impulse-audit.test.ts. Zakres innych specjalnych okien nadal wymaga sprawdzenia; ruling ANK 20200616 https://www.vekn.net/forum/rules-questions/78687-the-erciyes-fragments-fragment-of-the-book-of-nod-barrens-impulse#100110. Paczka 2: RTR 20040501 (nie można użyć, gdy karta jest zagrywana, by dobrać kartę anulującą 'as it is played') nieweryfikowane. Status bez zmian.

<a id="karta-100903"></a>
### Heart of Nizchetus (100903) — PARTIAL_FIX

Występuje w **4** taliach. Celowana naprawa: liczony draw Heart jest wznawiany po każdym wyborze źródła (w tym Tarot/Cache) i po save/load; dopiero po draw następuje wybór do przesunięcia na spód, w liczbie rzeczywiście dobranych kart. Opcje liczby uwzględniają aktywne store; heart-draw-redirect.test.ts. Nadal brak reprezentacji właściciela karty w ręce i poprawnego skierowania do biblioteki właściciela (np. Agaitas), niezweryfikowana kompletna semantyka choice/up to i kolejność wszystkich efektów; inne ścieżki wielokrotnego draw nie zostały naprawione. Historycznie: Odtworzony błąd: przy Heart i Shilmulo Tarot w fazie unlock wybór draw 2 natychmiast pyta o przesunięcie karty na spód, przed rozwiązaniem któregokolwiek przekierowanego dobierania; świeżo dobranych kart nie można wtedy wybrać. W compile.ts drawCards tworzy oczekujące wybory, lecz bury jest umieszczane nad nimi. Ponadto liczba opcji draw jest ograniczona długością biblioteki bez uwzględnienia store; pozostałe interakcje wymagają sprawdzenia. Poprzednia wąska ocena: Wąski zakres: opcjonalne draw do 3 i umieszczenie takiej samej liczby na spodzie biblioteki; cheap-tail.test.ts. Stan kodu sprawdzony ponownie: CardInstance w ręce nie ma pola owner (tylko MinionState i PermanentInPlay je mają), więc bury nie może trafić do biblioteki właściciela karty (RTR 19970425, LSJ 20060921); bury zawsze wraca do biblioteki kontrolera. Wymaga reprezentacji właściciela kart w ręce, niezbędnej także dla Agaitas (dotąd tylko cryptPerm).

<a id="karta-100941"></a>
### Hourglass of the Mind (100941) — PARTIAL_FIX

Występuje w **1** taliach. Częściowo naprawiono: odrębne warianty [pot]/[tem]; [tem] dobiera cztery karty bez discard, następnie wybiera do czterech kart z ręki na wierzch w zadanej kolejności i unlockuje przed zakończeniem akcji. Uwzględniono przekierowanie draw, zapis/wznowienie oraz pustą bibliotekę (tests/cards/hourglass-audit.test.ts). Przy niepełnej ręce przyjęto wykonanie możliwej części efektu; interpretacja wymaga potwierdzenia. Usunięto nieuprawnione +1 hand size superior bez counterów, lecz [TEM] nadal nie obsługuje opłacania counterów ani ich wpływu na hand size. Logi wyboru są maskowane, ale identyfikatory zakrytych kart w projekcji stanu nadal mogą umożliwiać ich śledzenie (istniejący szerszy problem prywatności). Pozostaje PARTIAL_FIX.

<a id="karta-101043"></a>
### Khabar: Glory (101043) — PARTIAL_FIX

Występuje w **1** taliach. Dodano kontrolę poprzednich non-mandatory actions i liczenie akcji wbudowanych, z kart i przyznanych; mandatory hunt jest wyjątkiem. tests/cards/action-attachments.test.ts. Inne rodzaje obowiązkowych akcji i anulowanie wymagają dalszej weryfikacji. Aktualizacja: Ten sam warunkowy unlock on attach nie działa przy superior Sleeping Mind; wspólny kod testowany przez Abbot, sam scenariusz Khabar niezweryfikowany.

<a id="karta-101143"></a>
### Magic of the Smith (101143) — PARTIAL_FIX

Występuje w **2** taliach. Wąski zakres: wyszukanie/equip po sukcesie, koszt i tasowanie; library-search.test.ts. Pozostałe interakcje nie są w pełni sprawdzone. Aktualizacja: koszt wyszukanego equipment uwzględnia wymagany klan, a własna kopia Unique nie jest oferowana; library-search.test.ts. Sprzęt z wyszukania nie generuje już CardPlayed, a koszty uwzględniają tagi, w tym podatek od broni; tests/cards/library-search.test.ts. Zgodność pozostałych skutków i anulowania nadal trzeba zweryfikować (https://www.vekn.net/forum/rules-questions/82962-meditative-grove-vs-rotschreck). Paczka 1: ruling 'equipment can be a location in play' (LSJ 19971001-2) i zniżki Equip/Employ (ANK 20180817) nie mają osobnego testu; library-search.test.ts pokrywa wybór przy rozwiązaniu, koszt i tasowanie. Status bez zmian.

<a id="karta-101272"></a>
### Nephandus (101272) — PARTIAL_FIX

Występuje w **1** taliach. Spec ma statystyki, press i akcję burn vampire, ale brak ranged strike 1R i redukcji damage ze strike i damaging effects; nie znaleziono osobnego handlera tej nazwy. Porównano tekst i spec oraz wyszukano osobne implementacje; bez nowego testu odtwarzającego. Aktualizacja: naprawiono wymaganie nadrukowanej ikony klanu dla wampira zagrywającego kartę (tests/cards/library-clan-icons.test.ts); wcześniejsze wzmianki o jego braku są już nieaktualne. Inne ustalenia powyżej i nieweryfikowane interakcje pozostają otwarte.

<a id="karta-101309"></a>
### Obedience (101309) — PARTIAL_FIX

Występuje w **2** taliach. Dodano sprawdzanie młodszego działającego vampire z uwzględnieniem capacity, właściwego blockera i powodzenia próby bloku; dodano reakcję celu niezablokowanego rush w state C. tests/cards/end-action.test.ts. Reakcja na rush korzysta z istniejącego okna C, a nie odrębnego impulsu bezpośrednio przed rozpoczęciem combat po zakończeniu innych efektów resolution; pełny timing i pozostałe interakcje nadal wymagają pracy. Paczka 1: pokryte przez end-action.test.ts (tylko blocker, młodszy vampire, rush, basic/superior). Nieobjęte: ANK 20171212 (zastąpiony przez slave nie może grać), LSJ 19991025 (starszy unlocked vampire przed nową walką). Status bez zmian.

<a id="karta-101338"></a>
### Outside the Hourglass (101338) — PARTIAL_FIX

Występuje w **1** taliach. Dodano wariant basic tem maneuver i limit superior per vampire/runda. Superior jest jednorazowy i pochodzi od wampira, nie environmental, a pending damage rozstrzygane jest przed strike; tests/cards/outside-hourglass-audit.test.ts obejmuje oba wampiry, save/load i źródło. Otwarte: prevention ma być dostępny w tym samym oknie przed range co inne efekty, a także zachowanie gdy walka kończy się przedwcześnie [ANK 20180104].

<a id="karta-101588"></a>
### Rego Motum (101588) — PARTIAL_FIX

Występuje w **2** taliach. Oba tryby ograniczono do obrażeń ze strike przeciwnika, nie dowolnego damage. tests/cards/prevention-provenance-audit.test.ts. Nowe zapisy przechowują pochodzenie damage, stare pakiety bez strikePhase (np. bonus ammunition) nie pozwalają odtworzyć źródła i wymagają dalszego rozwiązania; inne interakcje nieweryfikowane. Paczka 1: prevention-provenance-audit.test.ts pokrywa ograniczenie do strike przeciwnika. Nie zweryfikowano RTR 20041202 (niewykorzystane punkty nie przechodzą dalej) dla obu trybów. Status bez zmian.

<a id="karta-101649"></a>
### Rolling with the Punches (101649) — PARTIAL_FIX

Występuje w **2** taliach. Superior działa tylko na strike przeciwnika, także na kolejne pakiety w rundzie, a nie na environmental lub unpreventable damage; respektuje zakaz prevention przez dyscyplinę. tests/cards/prevention-provenance-audit.test.ts. Stare zapisy z pakietem bez strikePhase mają niejednoznaczne pochodzenie; inne interakcje nieweryfikowane. Paczka 1: prevention-provenance-audit.test.ts pokrywa strike i brak wpływu na environmental/unpreventable. Nie zweryfikowano ANK 20210226 (burn blood nie zmniejszany przez redukcje kosztu) w kontekście kosztu karty. Status bez zmian.

<a id="karta-101767"></a>
### Shilmulo Tarot (101767) — PARTIAL_FIX

Występuje w **1** taliach. Aktualizacja: Heart może rozstrzygnąć każdy przekierowany draw przed wyborem kart do przesunięcia; heart-draw-redirect.test.ts. Celowana poprawka wspólnego refill: po wybraniu karty z Tarot dalsze dobieranie do rozmiaru ręki jest wznawiane, także po save/load; draw-up-redirect.test.ts i nehemiah.test.ts. Nadal brak stale dostępnej możliwości dobrania z Tarot przy pustej bibliotece i niepełnej ręce, potwierdzonej w rulingu LSJ; w odtworzonym oknie unlock oferowane są wycofanie, Edge i pass, nie dobór z Tarot. Aktualizacja: wybór pomiędzy Tarot i Black Market Cache przy pojedynczym draw oraz refill przetestowany w multiple-draw-redirects.test.ts; kolejki wielokrotnego dobierania nadal otwarte. Dodatkowo onEnterPlay napełnia Tarot również przy samym put into play, nie tylko przy zagraniu/wyposażeniu; ruling LSJ https://groups.google.com/g/rec.games.trading-cards.jyhad/c/887DQTpntKI/m/uTcPGmJbHRYJ wyklucza Alastor. Istniejący test library-search.test.ts używa putPermanentInPlay i oczekuje napełnienia, więc nie jest dowodem poprawnego rozróżnienia wejścia w grę. Poprzednia ocena: Wąski zakres: unique equipment Ravnos odkłada dwie karty, umożliwia redirect draw z ready bearer i dodawanie karty w unlock; library-search.test.ts.

<a id="karta-101805"></a>
### The Sleeping Mind (101805) — PARTIAL_FIX

Występuje w **2** taliach. Superior nie wymaga już wyboru locked vampire ani nie zabrania mu bloku; test bez celu i test zakazu unlock w tests/cards/block-tax.test.ts. Poprawiono też zakaz po nieudanym bloku dla onlyAsAnnounced, ale inne przejścia okna ogłoszenia nie są w pełni zweryfikowane. Wcześniejsze ustalenie: Superior w spec nie tylko zabrania unlock, ale również nakazuje wybór locked vampire i zakazuje mu bloku, chociaż tekst superior nie zawiera basic. block-tax.test.ts oczekuje wyboru celu również w superior, więc nie bada wersji bez dodatkowego ograniczenia. Porównano tekst i spec oraz wyszukano osobne implementacje; bez nowego testu odtwarzającego. Aktualizacja: po zagraniu zwykłego action modifier lub reaction w stanie A okno „as announced” zostaje zamknięte także po anulowaniu karty i po save/load; testy obejmują Seduction, The Sleeping Mind, Club Illusion oraz replacement karty akcji (tests/cards/audit-action-and-shadow.test.ts). Nie obejmuje jeszcze wszystkich zwykłych zdolności kart w grze ani starych zapisów bez flagi; kwestia innych krawędzi pozostaje otwarta. Źródła: https://www.vekn.net/rulebook oraz https://vtesone.wordpress.com/category/rules/did-you-know/. Aktualizacja: zakaz unlock superior obejmuje teraz Freak Drive w oknie po rozstrzygnięciu, Change of Target przed rozstrzygnięciem bloku i objęte nim zdolności; zachowano efekty as if unlocked. Testy tests/cards/sleeping-mind-unlock-audit.test.ts obejmują także inferior oraz zapis/wznowienie. Inne ścieżki automatycznego unlock i wszystkie interakcje wymagają dalszego przeglądu. Źródła: https://www.vekn.net/forum/rules-questions/81780-the-sleeping-mind-and-change-of-target oraz https://vtesone.wordpress.com/category/rules/did-you-know/. Aktualizacja: zablokowano także Revelation corruption unlock, Warsaw Station po sukcesie, Forward Momentum oraz wariant unlock Dabbler i Monster w trakcie akcji. Testy sleeping-mind-unlock-audit.test.ts i revelation-of-the-serpent.test.ts; pozostałe ścieżki wymagają kontroli. Aktualizacja: superior wyklucza zagranie wersji Majesty/Earth Meld, która nakazuje unlock w walce, oraz nie oferuje płatnego unlock Truth in Darkness; wersja strike combat ends bez unlock pozostaje legalna. Zabezpieczono też rozstrzygnięcie wcześniej wybranego strike w starszym stanie. Ruling: https://www.vekn.net/forum-es/rules-questions/68051-the-sleeping-mind-vs-as-though-untapped. tests/cards/sleeping-mind-unlock-audit.test.ts. Inne źródła unlock nadal wymagają przeglądu. Aktualizacja: Zablokowano Helicopter, Horrific Countenance oraz znane opcje basic Cats' Guidance i Forced Vigilance w aktualnym oknie blokady; podczas resolve pomijane są unlock Abbot/Khabar: Glory, Precognizant Mobility, Psychophagia oraz Eulogio. Sprawdzono superior/inferior i Abbot w tests/cards/sleeping-mind-unlock-audit.test.ts. Inne ścieżki pozostają otwarte; wcześniejszy osobny błąd czasu Cats' Guidance po wszystkich walkach naprawiono i przetestowano w post-block-unlock.test.ts oraz psyche-post-block-audit.test.ts. Aktualizacja: testy sleeping-mind-unlock-audit.test.ts i master-intercept.test.ts obejmują Special Report, Organized Resistance, Guard Duty, Under Siege i Eternal Vigilance; niepłatne próby bloku bez rzeczywistego unlock pozostają legalne. Eagle’s Sight zagrać można po realnym wake bez unlock. Inne nieprzejrzane ścieżki nadal są otwarte. Aktualizacja: basic może wybrać również samego działającego zablokowanego wampira (tekst nie wymaga „another”); tests/cards/block-restrictions.test.ts. Paczka 1: sleeping-mind-unlock-audit.test.ts pokrywa wake (Eagle's Sight) i zakaz unlock po resolution (PIB 20150703); block-tax.test.ts pokrywa superior bez celu. Status bez zmian; sprawdzenie innych przejść okna 'as announced' nadal otwarte.

<a id="karta-101848"></a>
### Spirit Marionette (101848) — PARTIAL_FIX

Występuje w **1** taliach. Rozdzielono [dom] i [obe]; [obe] przy sukcesie pozwala aktorowi wybrać miniona pierwotnego prey nawet po redirect, z kontrolą dostępności przy announcement. tests/cards/spirit-marionette-audit.test.ts. Moment wyboru wymaga weryfikacji; [OBE] nadal błędny: brak czasowego przejęcia i wymuszonego bleed/hunt.

<a id="karta-101897"></a>
### Summon History (101897) — CODE_DISCREPANCY

Występuje w **1** taliach. Stan: karta nadal jest atrapą (basic: tylko actionStealth; superior: brak). Tekst: [tem] szukanie ally/retainer/equipment z kosztem X lub mniej (krew albo pool) w bibliotece i/lub stosie odrzuconych, wejście na tego vampira z życiem równym startowemu; [TEM] szukanie non-scarce vampire z krypty/stosu z pojemnością X lub mniej, wejście bez krwi. Brakuje: (1) koszt X przy zagraniu (rulings: X ustalany przy zagraniu, może być 0; LSJ 20100314, LSJ 20030502); (2) wyszukiwanie w krypcie z wyborem vampira (attachFromZone obsługuje tylko library/hand/ashHeap); (3) wejście allies 'na tego vampira' z życiem startowym: ally jest osobnym minionem, sposób umieszczenia wymaga rozstrzygnięcia; (4) ignorowanie wymagań Dyscypliny: wejście w wersji inferior (rulings RBK equip/recruit, LSJ 20100204, PIB 20111101 dla X = 0 przy Reanimated Corpse). Nie zaimplementowano; brak testu. Summon Soul i Summon the Serpent to te same atrapy w tej samej fali.

<a id="karta-101931"></a>
### Talbot's Chainsaw (101931) — PARTIAL_FIX

Występuje w **1** taliach. Dodano zakaz wszystkich akcji hunt dla nosiciela, w tym hunt z karty i granted hunt; wyjątek dla Howler, która nie może używać broni. Tests/cards/talbots-hunt.test.ts sprawdza m.in. stuck przy 0 blood. Nadal brak upkeep 3 unpreventable damage; jego źródłem jest broń, a nie environmental damage, i trzeba uwzględnić immunity. pressPerCombat nie deklaruje mandatory i ograniczenia do kontynuacji w pierwszej rundzie. Rush/prevent oraz inne interakcje wymagają dalszej weryfikacji.

<a id="karta-101960"></a>
### Terror Frenzy (101960) — PARTIAL_FIX

Występuje w **2** taliach. Basic działa przeciw minion, superior wyłącznie przeciw wampirowi; obsługiwane kierunki maneuver/press i zachowanie niezależnych ograniczeń po Tranquility Shield; tests/cards/frenzy-direction-audit.test.ts. Timing i inne źródła ograniczeń wymagają dalszej weryfikacji, jak również stare zapisy bez informacji o źródłach. Paczka 1: ANK 20180910-3 (koszt combat cards na końcu rundy) zweryfikowany testem batch1-frenzy-end-of-round.test.ts z kontrolą dodatnią (Telepathic Tracking superior, aus, bob z 1 blood nie płaci, z 5 płaci). Pozostaje: limit superior raz na walkę w starych zapisach i timing innych źródeł.

<a id="karta-102053"></a>
### Tye Cooper (102053) — PARTIAL_FIX

Występuje w **1** taliach. Spec ma unique wraith i podstawowe statystyki, ale grantedAction ogranicza burn do vampire w torpor zamiast dowolnego non-ready miniona; brak odzyskania library card i odporności na non-aggravated. Porównano tekst i spec oraz wyszukano osobne implementacje; bez nowego testu odtwarzającego. Aktualizacja: naprawiono wymaganie nadrukowanej ikony klanu dla wampira zagrywającego kartę (tests/cards/library-clan-icons.test.ts); wcześniejsze wzmianki o jego braku są już nieaktualne. Inne ustalenia powyżej i nieweryfikowane interakcje pozostają otwarte.

<a id="karta-102092"></a>
### Vast Wealth (102092) — PARTIAL_FIX

Występuje w **1** taliach. Wąski zakres: master na własnego ready miniona nadaje akcję equip pierwszego equipment z library; library-search.test.ts. Aktualizacja: sprawdzany jest pierwszy sprzęt, a przy niespełnionym wymogu klanu lub wymuszonym konflikcie Unique jest spalany bez kosztu zamiast przeszukania dalszych kart (library-search.test.ts; https://www.vekn.net/forum/rules-questions/79883-enkidu-vast-wealth). Wyposażenie z library nie emituje już błędnego CardPlayed, a koszt uwzględnia tagi broni; pozostaje brak wyboru nic nie znaleźć oraz niepełna obsługa innych ograniczeń i ceny. Zgodnie z https://www.vekn.net/forum/rules-questions/79511-vidal-jarbeaux ten sprzęt nie jest zagrywany.

<a id="karta-102144"></a>
### War Ghoul (102144) — PARTIAL_FIX

Występuje w **1** taliach. Overlay wymaga rekrutującego Tzimisce i uwzględnia modyfikatory kosztu; testy rush-cards.test.ts i retainer-wave.test.ts. Pozostałe interakcje alternatywnych kosztów i rekrutacji wymagają dalszej weryfikacji.

<a id="karta-102159"></a>
### Waters of Duat (102159) — PARTIAL_FIX

Występuje w **1** taliach. Osobny obowiązek hunt trwa do ogłoszenia hunt lub końca tury nawet po uzyskaniu blood; tests/cards/token-vampire.test.ts. Pozostałe interakcje i granice tury wymagają dalszej weryfikacji.

<a id="karta-102199"></a>
### Yawp Court (102199) — PARTIAL_FIX

Występuje w **1** taliach. Naprawiono kolejkę walk przed referendum i jego anulowanie po opuszczeniu ready przez działającego wampira. tests/cards/crypt-and-uncontrolled.test.ts: rzeczywisty torpor (także w drugiej walce Psyche!), torpor samego przeciwnika, symulowany powrót i save/load, damage między walkami. Faktyczne użycie Warsaw Station w środku akcji nie jest zaimplementowane; Rötschreck i pozostałe interakcje timingów/prevention niezweryfikowane. Rulings LSJ 20060902, LSJ 20090325-1, ANK 20180910-1.

<a id="karta-102233"></a>
### Revelation of the Serpent (102233) — PARTIAL_FIX

Występuje w **2** taliach. Superior oferuje wybór corruption tylko po rozstrzygnięciu oust i okna Life Boon; po oust celu nie oferuje unlock [ANK 20220210], po uratowaniu celu umożliwia wybór również po save/load; Sleeping Mind blokuje unlock. Testy revelation-of-the-serpent.test.ts. Pozostałe efekty sukcesu, kolejność i interakcje wymagają weryfikacji. Paczka 1: ANK 20220210 (ousted przez bleed nie odblokowuje) pokryte przez revelation-of-the-serpent.test.ts; nie sprawdzono pozostałych efektów sukcesu i kolejności. Status bez zmian.

<a id="karta-102246"></a>
### Childe of the Revolution (102246) — PARTIAL_FIX

Występuje w **2** taliach. Osobny obowiązek hunt trwa do ogłoszenia hunt lub końca tury nawet po uzyskaniu blood; tests/cards/token-vampire.test.ts. Pozostałe interakcje i granice tury wymagają dalszej weryfikacji. Aktualizacja: obowiązek nie przechodzi na kolejną turę, jeżeli Childe został przeniesiony do uncontrolled (test emitujący zdarzenie Banishment i save/load w token-vampire.test.ts). Wybór źródeł wyszukania i pozostałe interakcje nadal wymagają audytu. Paczka 1: pokryte przez token-vampire.test.ts (obowiązek hunt, uncontrolled, Anarch). Nie zweryfikowano LSJ 20041201-2 (wejście do crypt = spalenie) dla tokena. Status bez zmian.

<a id="karta-102262"></a>
### Touch of Valeren (102262) — PARTIAL_FIX

Występuje w **2** taliach. Combat ograniczono do strike przeciwnika; prevention-provenance-audit.test.ts bada dostępność i źródła. Action dopuszcza pełnego aktora, jeśli koszt krwi zostawia miejsce, respektuje ochronę przed wyborem i limit starting life ally; minion-target-actions.test.ts. Stare pakiety bez strikePhase i pełne przejście superior oraz dalsze interakcje pozostają otwarte. Paczka 1: minion-target-actions.test.ts i prevention-provenance-audit.test.ts pokrywają akcję i combat. Nie zweryfikowano LSJ 20001114 dla tej ścieżki prevention oraz starych pakietów bez strikePhase. Status bez zmian.

<a id="karta-102283"></a>
### Touch of Oblivion (102283) — PARTIAL_FIX

Występuje w **1** taliach. Basic dołącza counters, superior wysyła wampira do torpor lub spala ally. Naprawiono równoczesny strike oraz okno odroczenia bezpośredniego strike: torpor; tests/cards/entombment-audit.test.ts i touch-of-oblivion.test.ts. Pozostałe interakcje wymagają weryfikacji.

<a id="karta-102302"></a>
### Psychophagia (102302) — PARTIAL_FIX

Występuje w **1** taliach. Wąski zakres: Hecata hunt usuwa ally z ash heap za blood albo mniej blood i unlock; ash-heap-cards.test.ts. Aktualizacja: Unlock przy wariancie 2 blood jest pomijany przy superior Sleeping Mind, blood gain pozostaje; brak osobnego testu end-to-end tego połączenia.

<a id="karta-102303"></a>
### Raising the Portcullis (102303) — PARTIAL_FIX

Występuje w **1** taliach. Limit jednej kopii na kontrolera zamiast unique; test per-methuselah-audit.test.ts sprawdza dostępność i blokadę drugiej kopii. Pełna rezolucja dwóch kopii i interakcje contest wymagają dalszej weryfikacji.

<a id="karta-102310"></a>
### Augury of Doom (102310) — PARTIAL_FIX

Występuje w **1** taliach. Limit jednej kopii na kontrolera zamiast unique; test per-methuselah-audit.test.ts sprawdza dostępność i blokadę drugiej kopii. Pełna rezolucja dwóch kopii i interakcje contest wymagają dalszej weryfikacji.

<a id="karta-102314"></a>
### Dance of the Dead (102314) — PARTIAL_FIX

Występuje w **1** taliach. Zdolność można teraz aktywować w dalszych oknach walki, w tym w kroku press. wraith-zombie.test.ts sprawdza press, zużycie ostatniego countera i spalenie karty, limit na combat, kontrolę celu oraz maneuver zachowany do następnej rundy po save/restore. Pozostają do zbadania pozostałe okna (m.in. damage resolution) oraz interakcje z ograniczeniami ruchu i timingiem. Uwaga: ogólna legalność kart library wymagających Path nadal wymaga egzekwowania; samo pole Path przywrócono do registry.

<a id="karta-102315"></a>
### Dance with the Devil (102315) — PARTIAL_FIX

Występuje w **1** taliach. Superior nie pobiera blood automatycznie; w kroku range można opcjonalnie zapłacić za dodatkowy close maneuver, a bez blood nadal zagrać kartę. round-end.test.ts. Zakup jest obecnie dostępny tylko w range przy long, nie dowolnie w rundzie; wymagane są dalsze prace nad timingiem i ograniczeniami dyscyplin.

<a id="karta-102321"></a>
### Fever Pitch (102321) — PARTIAL_FIX

Występuje w **1** taliach. Przebudowano superior: jedno zagranie. Tryb bleed (+1 bleed) wstrzymuje kartę w akcji (heldAfterResolution, held w afterResolutionAttach); po rozstrzygnięciu akcji jest przypinana na aktywnym vampire tylko przy udanym bleedzie na co najmniej 1 i bez drugiego egzemplarza, w przeciwnym razie trafia na stos odrzuconych. Usunięto osobny tryb 'attach' z ręki, który pozwalał przypiąć kartę bez zagrania jej jako +1 bleed. Blokada exclusiveKey dotyczy teraz tylko trybów przypinających, więc zagranie drugiego egzemplarza za bleed na vampirze z jednym jest legalne (egzemplarz trafia na stos). Zdolność spalenia do nieudanego bloku była już zbudowana (feverPitch, abilityOptions) i jest sprawdzona testem. Testy: tests/cards/after-resolution.test.ts 19/19 (przypięcie po zagraniu, brak przypięcia bez zagrania, nieudany bleed odkłada kartę, drugi egzemplarz, burn do nieudanego bloku). ODSTĘPSTWO / NIEZROBIONE: tekst mówi 'you can', a przypięcie następuje automatycznie, gdy jest legalne; brak opcjonalnej rezygnacji.

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

Występuje w **1** taliach. Po passed referendum wywołanym przez predatora spala 1 blood; test pass/fail i innego kontrolera w referendum-outcomes.test.ts. Zmiana relacji predator po oust oraz przypadki torpor i niestandardowych referendum wymagają weryfikacji.

<a id="karta-200608"></a>
### Hrothulf (G3) (200608) — PARTIAL_FIX

Występuje w **1** taliach. Dodano directed rush Hrothulfa na ready miniona innego Methuselah, tylko przy posiadaniu Edge; koszt spalany przy sukcesie, zgodnie z rulingiem LSJ 20030519. tests/cards/hrothulf-audit.test.ts obejmuje targety, blok, sukces, Go-getter i save/restore. Po utracie Edge przed rozpatrzeniem przyjęto interpretację: akcja pozostaje udana, ale nie dochodzi do walki; ten przypadek wymaga potwierdzenia rulingiem i pozostaje otwarty.

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

Występuje w **1** taliach. Poprawiono ofertę: opcjonalny wybór bezpośrednio po konkretnym zagraniu mastera (także po zagnieżdżonych wyborach), odmowa nie zużywa użycia; limit raz na fazę i jego reset. Regresje crypt-wave-7.test.ts obejmują Blood Doll, dwa mastery, legalność celu i save/restore. Wcześniejsze założenie o braku limitu było błędne: ruling Rules Directora potwierdza szablon „during X, do Y” (https://www.vekn.net/forum-es/rules-questions/79835-nonu-dis-and-during-x-do-y). Wpływ anulowania i nietypowych sposobów zagrania mastera wymaga dalszego ustalenia i testów; obecny hook przyjmuje również anulowane zagranie.

<a id="karta-201680"></a>
### Opikun (G7) (201680) — PARTIAL_FIX

Występuje w **2** taliach. Opikun może chronić siebie lub innego kontrolowanego vampire przed nieaggravated damage ze strike przeciwnika, bez zmiany wymogu another u Huldu. tests/cards/hecata-huldu-audit.test.ts. Stare zapisy z pakietem bez strikePhase mają niejednoznaczne pochodzenie; pozostałe interakcje nieweryfikowane. Aktualizacja: zapobieganie obejmuje wiele nieaggravated pakietów tego samego strike, z wyłączeniem unpreventable, innego strike i environmental; test z pakietami i starym zapisem w tests/cards/hecata-huldu-audit.test.ts. Nadal ograniczenia starszych zapisów oraz okna/właściwej kolejności obrażeń. Paczka 2: ponownie sprawdzono tekst (independent, do 2 nieaggravated z jednego strike). Wciąż otwarte: okno kolejności obrażeń i stare zapisy bez pochodzenia; status bez zmian.

<a id="karta-201750"></a>
### Eulogio Sánchez de los Reyes (G6) (201750) — PARTIAL_FIX

Występuje w **1** taliach. grantedAction reorderTop 5, +1 stealth, 1 blood i unlockActor; porównano spec i kompilator. Ograniczony zakres; bez nowego scenariusza. Aktualizacja: Unlock przy reorderTop pomijany przy superior Sleeping Mind; brak osobnego testu end-to-end tego połączenia.

<a id="karta-201754"></a>
### Gostoso (G6) (201754) — PARTIAL_FIX

Występuje w **1** taliach. Po successful bleed prey gracz wybiera gain blood lub odmowę, wybór można zapisać i wznowić; crypt-wave-4.test.ts. Wybór jest kolejkwany przez resolver akcji, timing względem wszystkich efektów rozstrzygnięcia wymaga weryfikacji.

<a id="karta-201776"></a>
### Věnceslava, The Implacable (G6) (201776) — PARTIAL_FIX

Występuje w **1** taliach. Gain pool jest opcjonalny; odmowa nie zużywa once-per-turn i działa późniejsza kwalifikująca akcja, także po zapisie. crypt-wave-4.test.ts. Identyfikacja prey i kolejność przy zmianie/oust oraz wszystkich zagnieżdżonych zdarzeniach wymagają weryfikacji.

