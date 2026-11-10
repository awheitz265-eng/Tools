# Plan Wetterkonsens

## Vorgaben (Stand 10.11.2026)
- Geräte: Android-Handy und iPad → Progressive Web App, gehostet auf GitHub Pages
- Vorhersage: stündlich, 24 Stunden, Temperatur und Niederschlag
- Ort: aktueller Standort oder Ortssuche, europaweit
- Darstellung: animierte Sequenz in der App (keine Videodatei)
- Sprache Deutsch, eigener Look, nur private Nutzung
- Kein Zwischendienst (Proxy): nur Quellen, die der Browser direkt abfragen kann

## Methode
- Pro Stunde: gewichteter Median von Temperatur, Niederschlagsmenge und Bewölkung über alle Quellen
- Niederschlagsrisiko: Anteil der Quellen mit ≥ 0.1 mm, gemittelt mit deren eigenen Wahrscheinlichkeiten
- Konfidenz (hoch/mittel/tief): Faustregel aus Temperaturspanne und Einigkeit beim Niederschlag; bei weniger als 3 Quellen immer «tief». Nicht kalibriert.

## Gewichtung der Quellen (Stand 10.11.2026)
Gewichteter Median statt einfachem Median. Die Gewichte sind eine begründete Einschätzung, keine Messung.

| Quelle | Gewicht | Begründung |
|---|---|---|
| DWD MOSMIX (Bright Sky) | 1.5 | Statistisch nachbearbeitete Punktvorhersage; Nachbearbeitung schlägt bei der 2-m-Temperatur in der Regel die rohen Modelle |
| ECMWF IFS | 1.25 | Gilt in Vergleichen globaler Modelle als das stärkste |
| MET Norway | 0.75 | Liefert ausserhalb Nordeuropas ECMWF-Daten, ist also keine unabhängige Stimme; ECMWF + MET Norway zusammen 2.0 |
| DWD ICON, Météo-France, UK Met Office | 1.0 | Keine belastbaren Belege für eine Abweichung gefunden → neutral |
| NOAA GFS | 0.7 | In Vergleichen hinter ECMWF |

Belegstand: Die Angaben stützen sich nur auf Auszüge aus Suchergebnissen (ECMWF-, DWD-, MET-Norway- und meteoblue-Seiten). Die Originalseiten konnten in der Entwicklungsumgebung nicht geöffnet werden. Ein direkter Vergleich genau dieser sieben Quellen für Europa wurde nicht gefunden. Verlässlicher wäre eine eigene Auswertung: Vorhersagen speichern und später mit Messwerten vergleichen.

## Etappen
1. [x] MVP: PWA, Ortssuche, Standort, Quellen, Konsens, Animation, Stundentabelle
2. [x] Test mit echten Daten auf dem Gerät: alle sieben Quellen liefern (Rückmeldung 10.11.2026)
3. [x] GitHub Pages aktivieren, App auf Handy und iPad installieren
4. [x] Gewichtung der Quellen, detailliertere Animation (Titelbild, Zusammenfassung, Landschaft, Zeitleiste)
5. [ ] Weiterer Feinschliff nach Rückmeldung (z.B. Favoriten, eigene Auswertung der Trefferquote)

## Offene Punkte
- Die echten Schnittstellen konnten in der Entwicklungsumgebung nicht aufgerufen werden (Netzwerk gesperrt). Getestet ist nur mit nachgebildeten Antworten. Adressen, Parameter und Modellnamen stammen aus dem Gedächtnis und sind nicht gegen die Dokumentation geprüft.
- MET Norway und Bright Sky: unklar, ob der direkte Abruf aus dem Browser erlaubt ist. Falls nicht, zeigt die App die Quelle als «nicht erreichbar» und rechnet ohne sie.
- Bright Sky deckt vermutlich nur Orte in der Nähe von DWD-Stationen ab.
- Die fünf Open-Meteo-Modelle kommen über denselben Dienst: fällt Open-Meteo aus, fehlen alle fünf.
