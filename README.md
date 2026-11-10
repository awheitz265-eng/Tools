# Tools

## Wetterkonsens

Private Wetter-App (PWA) für Android-Handy und iPad. Sie liest mehrere kostenlose Wetterquellen, bildet daraus die wahrscheinlichste Vorhersage für die nächsten 24 Stunden (stündlich, Temperatur und Niederschlag) und zeigt sie als kurze animierte Sequenz. Ort: aktueller Standort oder Ortssuche.

- Kein Build-Schritt, kein Server, keine API-Schlüssel: reine statische Dateien.
- Quellen: Open-Meteo (Modelle von DWD, ECMWF, Météo-France, UK Met Office, NOAA), MET Norway, DWD MOSMIX via Bright Sky. Fällt eine Quelle aus, rechnet die App mit den übrigen; der Abschnitt «Quellen und Methode» in der App zeigt den Status jeder Quelle.
- Nur für private, nichtkommerzielle Nutzung (Bedingung der Gratis-Tarife).

### Lokal starten

```bash
python3 -m http.server 8765
```

Danach `http://localhost:8765/` öffnen.

### Tests

```bash
node --test tests/ensemble.test.mjs
```

Plan und offene Punkte: [PLAN.md](PLAN.md)
