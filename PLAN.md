# Plan Wetterkonsens

## Vorgaben (Stand 10.11.2026)
- Geräte: Android-Handy und iPad → Progressive Web App, gehostet auf GitHub Pages
- Vorhersage: stündlich, 24 Stunden, Temperatur und Niederschlag
- Ort: aktueller Standort oder Ortssuche, europaweit
- Darstellung: animierte Sequenz in der App (keine Videodatei)
- Sprache Deutsch, eigener Look, nur private Nutzung
- Kein Zwischendienst (Proxy): nur Quellen, die der Browser direkt abfragen kann

## Methode
- Pro Stunde: Median von Temperatur, Niederschlagsmenge und Bewölkung über alle Quellen
- Niederschlagsrisiko: Anteil der Quellen mit ≥ 0.1 mm, gemittelt mit deren eigenen Wahrscheinlichkeiten
- Konfidenz (hoch/mittel/tief): Faustregel aus Temperaturspanne und Einigkeit beim Niederschlag; bei weniger als 3 Quellen immer «tief». Nicht kalibriert.

## Etappen
1. [x] MVP: PWA, Ortssuche, Standort, Quellen, Konsens, Animation, Stundentabelle
2. [ ] Test mit echten Daten auf den Geräten (siehe offene Punkte)
3. [ ] GitHub Pages aktivieren, App auf Handy und iPad installieren
4. [ ] Feinschliff nach Rückmeldung (z.B. Favoriten, Gewichtung der Quellen)

## Offene Punkte
- Die echten Schnittstellen konnten in der Entwicklungsumgebung nicht aufgerufen werden (Netzwerk gesperrt). Getestet ist nur mit nachgebildeten Antworten. Adressen, Parameter und Modellnamen stammen aus dem Gedächtnis und sind nicht gegen die Dokumentation geprüft.
- MET Norway und Bright Sky: unklar, ob der direkte Abruf aus dem Browser erlaubt ist. Falls nicht, zeigt die App die Quelle als «nicht erreichbar» und rechnet ohne sie.
- Bright Sky deckt vermutlich nur Orte in der Nähe von DWD-Stationen ab.
- Die fünf Open-Meteo-Modelle kommen über denselben Dienst: fällt Open-Meteo aus, fehlen alle fünf.
