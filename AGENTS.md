# Wskazówki dla pracy nad regułami VTES

Przed implementacją lub audytem karty sprawdź jej aktualny tekst oraz
lokalne interpretacje: `npm run rules:lookup -- "nazwa karty"` lub ID.
Dokumentacja, wersja migawki, licencja i odnośniki do rulebooka oraz
pozostałych oficjalnych źródeł są w `docs/rules-reference/README.md`.
Wynik obejmuje interpretacje bezpośrednie i grupowe; brak wyniku nie
potwierdza poprawności, a nowsze rulings lub erraty wymagają osobnej kontroli.

Pełny rulebook PDF i jego ekstrakt mogą być lokalnymi plikami wykluczonymi
przez `.gitignore` — nie zakładaj, że istnieją w każdym checkoutcie. Projektowe
opracowania w `docs/` nie zastępują źródeł oficjalnych. Rozróżniaj poprawki
częściowe, potwierdzone błędy i nierozstrzygnięte kwestie; zachowuj źródła w
`docs/card-audit/manual-findings.json` i dodawaj odpowiednie testy.
