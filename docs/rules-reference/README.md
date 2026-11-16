# Źródła reguł i interpretacji VTES

## Lokalna baza interpretacji kart

`vtes-rulings/` to niezmieniona kopia trzech plików bazy
[vtes-biased/vtes-rulings](https://github.com/vtes-biased/vtes-rulings):

- `rulings.yaml` — interpretacje poszczególnych kart i grup kart;
- `groups.yaml` — przynależność kart do grup, czasem z ograniczeniem wariantu;
- `references.yaml` — odnośniki do źródeł interpretacji;
- `LICENSE` — licencja MIT i informacja o prawach autorskich upstreamu.

**Wersja:** commit [`3020a12b6e2d79312700a129fe004d25c71cbcbe`](https://github.com/vtes-biased/vtes-rulings/commit/3020a12b6e2d79312700a129fe004d25c71cbcbe), 2026-11-02 02:02 UTC. Migawka nie aktualizuje się sama. Pliki bazy są używane w oryginalnym brzmieniu, nie zostały przetłumaczone.

Po `npm ci`, z katalogu głównego repozytorium:

```sh
npm run rules:lookup -- "The Sleeping Mind"
npm run rules:lookup -- 102082
```

Wyszukiwarka pokazuje bezpośrednie rulings, dotyczące karty grupy, ich
ograniczenia i odnośniki do źródeł. Wyszukiwanie nazw jest częściowe,
bez rozróżniania wielkości liter i akcentów; warianty krypt mają osobne ID.
Brak wpisu **nie potwierdza**, że karta nie ma istotnych interpretacji.
Zwracaj uwagę na daty, warianty i kontekst: wynik grupowy nie zawsze
stosuje się do każdego trybu, a wynik `[REMINDER]` może jedynie przypominać
tekst karty. Odnośniki to materiał źródłowy; nie wszystkie mogą być nadal
aktywne, a migawka może być starsza niż nowsze orzeczenie.

### Aktualizacja migawki

1. Sprawdź upstream i wybierz konkretny commit; porównaj zmiany w bazie,
   licencji oraz strukturze danych.
2. Zastąp **razem** wszystkie trzy pliki YAML i `LICENSE` plikami z tego
   samego commitu; zaktualizuj wersję powyżej. Nie zmieniaj ręcznie plików
   upstreamu. Zachowaj informację o prawach autorskich i licencję.
3. Uruchom `npx vitest run tests/scripts/rulings-lookup.test.ts`,
   `npm run typecheck` oraz przykładowe wyszukiwania po nazwie i ID.
4. Jeśli zmiana może wpływać na wcześniejsze ustalenia, ponownie zweryfikuj
   odnośne karty i zapisz źródła w `docs/card-audit/manual-findings.json`.

## Pozostałe źródła

- [Oficjalny rulebook VEKN](https://www.vekn.net/rulebook) oraz
  [wydania rulebooka Black Chantry (PDF)](https://www.blackchantry.com/utilities/rulebook/).
- [VEKN General Rulings](https://www.vekn.net/general-rulings).
- [VEKN Detailed Play Summary](https://www.vekn.net/detailed-play-summary) —
  opis przebiegu rozgrywki, nie zamiennik rulings poszczególnych kart.
- Aktualny tekst kart w repozytorium: `src/cards/registry.json`; sprawdź
  datę `fetchedAt` oraz ewentualną nowszą erratę w oficjalnej liście.
- Projektowe opracowania mechanik: `docs/*-design.md`; audyt kart:
  `docs/card-audit/`. Są to opracowania projektu, nie oficjalne reguły.

### Lokalne kopie stron VEKN

Strony VEKN zawierają zastrzeżenie praw do materiałów. Do prywatnego użytku
można pobrać kompletne strony HTML bezpośrednio z VEKN poleceniem:

```sh
npm run rules:fetch-vekn
```

Skrypt zapisuje pliki `docs/rules-reference/vekn/general-rulings.html` i
`detailed-play-summary.html` oraz `metadata.json` z adresami, czasem pobrania
i sumami SHA-256. Wymaga dostępu do `www.vekn.net`. W obecnym środowisku
agenta bezpośrednie połączenia z tą domeną są zablokowane, więc tych kopii
**jeszcze tu nie ma**; uruchom polecenie na komputerze z dostępem do strony
lub udostępnij zapisane pliki. Pobrane pliki są migawką, a nie automatycznie
aktualizowanym źródłem; mogą zawierać odnośniki i zasoby wymagające internetu.
Prywatny użytek nie oznacza automatycznie zezwolenia na dalszą publikację:
przed udostępnieniem kopii sprawdź warunki prawne źródła.

Starsza konfiguracja projektu wskazuje lokalny PDF rulebooka w katalogu
**nad** repozytorium. `.gitignore` wyklucza PDF-y oraz `rulebook_text.txt`,
więc taki PDF i jego ekstrakt mogą istnieć na komputerze użytkownika, ale
nie muszą być dostępne w świeżym checkoutcie lub środowisku agenta. Jeśli są
dostępne, sprawdź ich wydanie przed użyciem; w przeciwnym razie korzystaj z
oficjalnego źródła powyżej. Nie nazywaj projektowego streszczenia w
`src/ui/rules.ts` pełnym oficjalnym rulebookiem.
