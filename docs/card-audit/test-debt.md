# Testy: aktualny katalog i pozostały dług

Zielony wynik nie oznacza, że wszystkie karty są kompletne. Pole `supported` w rejestrze jest etykietą, a nie dowodem zgodności z tekstem; informacje o konkretnych rozbieżnościach znajdują się w `manual-findings.json` i raportach audytu.

## Świadomie otwarte kontrole

- Dwie kontrole w `pool-widening.test.ts` są oznaczone `it.fails`: bieżący rejestr ma szerszą pulę krypt niż konfiguracja w `config/crypt-groups.json` i stary generator `scripts/build-registry.mts`. Regeneracja rejestru bez uzgodnienia polityki puli może zmienić lub usunąć karty. Testy powinny zostać zmienione na zwykłe po naprawie generatora i konfiguracji. Kontrola importu Laibon oraz kompletności referencji talii działa normalnie.
- `justicars.test.ts` zawiera `it.fails` dla braku wyboru celu Gangrel Justicar. Ponadto ma `todo` dla nadania tytułu i głosów. Wyjątkowość *tytułu* nie jest automatycznie dowodem, że sama karta jest unikalna; rozstrzyganie contestu wymaga osobnej weryfikacji.
- `praxis-seizure.test.ts`, `path-cards.test.ts` i `granted-action-requirements.test.ts` mają zadania `todo` dotyczące Venice, Path of the Void i interakcji Keegana ze Skaald. Obecność karty w rejestrze i etykieta `supported` nie oznaczają, że te scenariusze działają.
- `tests/cards/fixtures/library-coverage-debt.json` przechowuje identyfikatory kart biblioteki nieodnalezionych po nazwie w korpusie testów podczas tworzenia baseline (1125 pozycji). Test blokuje nowe braki względem baseline, ale nie wymaga natychmiastowej likwidacji istniejących. Sama obecność nazwy w tekście testu nie dowodzi scenariuszowego pokrycia. Nie dopisywać nowych braków do baseline bez osobnego przeglądu.

Kontrole `it.fails` mają przejść w trybie zwykłym, kiedy naprawimy przyczyny; Vitest zgłasza je jako błąd, jeśli przestaną zawodzić. Zadania `todo` nie są wykonywane. Należy osobno zgłaszać zarówno `todo`, jak i oczekiwane porażki, także przy zielonym przebiegu.
