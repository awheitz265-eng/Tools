# Plan Wetterkonsens

## Vorgaben (Stand 10.11.2026)
- Geräte: Android-Handy und iPad → Progressive Web App, gehostet auf GitHub Pages
- Vorhersage: stündlich, 48 Stunden (seit 10.11.2026, vorher 24); Temperatur, Niederschlag, Wind und Böen, Gewitter, Nebel
- Ort: aktueller Standort oder Ortssuche, europaweit
- Darstellung: animierte Sequenz in der App (keine Videodatei)
- Sprache Deutsch, eigener Look, nur private Nutzung
- Kein Zwischendienst (Proxy): nur Quellen, die der Browser direkt abfragen kann

## Methode
- Pro Stunde: gewichteter Median von Temperatur, Niederschlagsmenge und Bewölkung über alle Quellen
- Niederschlagsrisiko: Anteil der Quellen mit ≥ 0.1 mm, gemittelt mit deren eigenen Wahrscheinlichkeiten
- Konfidenz (hoch/mittel/tief): Faustregel aus Temperaturspanne und Einigkeit beim Niederschlag; bei weniger als 3 Quellen immer «tief». Nicht kalibriert.

## Stand der Prüfung gegen die Dokumentation (11.11.2026)
Die öffentlichen Quellcode- und Dokumentations-Repos der Dienste wurden gelesen (Stand: Open-Meteo 10.11.2026, Bright Sky 20.10.2026, MeteoSchweiz 10.11.2026, MET Norway 7.3.2023). Die MET-Norway-Doku im Repo ist alt; die Angaben dazu können überholt sein. Damit geprüft:
- Open-Meteo (Quellcode): Modellnamen, Variablennamen, Parameter, Zeitstempel in UTC, Feld `elevation`, Fehler 400 ausserhalb des Modellgebiets.
- MET Norway (Doku): Feldnamen, Endpunkt `complete`, Abruf aus dem Browser für Seiten mit wenig Verkehr erlaubt, Modell ausserhalb Nordeuropas ist ECMWF (9 km), Lizenz CC BY 4.0.
- Bright Sky (Quellcode): Feldnamen, Arten `historical`/`current`/`forecast`, Parameter `max_dist`.
- MeteoSchweiz (Doku): Dateinamen, Spalten `tre200s0` und `rre150z0`, Zeitformat `dd.mm.yyyy HH:MM` in UTC, Zeitstempel = Ende des Intervalls, Datei `now` reicht von gestern 12 UTC bis jetzt.

Nicht geprüft, weil die Dienste selbst aus der Entwicklungsumgebung nicht erreichbar sind:
- ob data.geo.admin.ch den Abruf aus dem Browser zulässt (CORS). Falls nicht, zeigt die Statuszeile der Auswertung «MeteoSchweiz: nicht erreichbar» und es gilt die Modellanalyse.
- welche Regionalmodelle für einen Ort tatsächlich Werte liefern und ob sie alle abgefragten Grössen haben. Rückmeldung vom Gerät (Raum Basel, 12.11.2026): alle liefern ausser GeoSphere; dort war das eingestellte Modell AROME eingetragen, jetzt C-LAEF.
- Rückmeldung vom Gerät: Der Abruf der Messwerte von MeteoSchweiz aus dem Browser funktioniert (Station Basel / Binningen).
- ob MET Norway ausserhalb Nordeuropas Böen liefert.

## Zusätzliche Quellen (11.11.2026)
Sechs Regionalmodelle über Open-Meteo, je nur für einen Teil Europas: MeteoSchweiz ICON-CH, GeoSphere Austria C-LAEF (Nachfolger des am 4.11.2026 eingestellten AROME Austria), ItaliaMeteo ICON-2I, CHMI ALADIN, KNMI HARMONIE, DMI HARMONIE. Abgefragt wird jeweils das Einzelmodell, nicht die «seamless»-Variante: Diese fällt ausserhalb des Gebiets auf ECMWF zurück und würde ECMWF mehrfach zählen.

Ausgangsgewicht je 0.8 statt 1.0, weil sie zu Modellfamilien gehören, die schon vertreten sind. Das ist eine Setzung.

Bewusst nicht eingebaut:
- ECMWF AIFS (KI-Modell): nur 6-stündliche Werte, für stündliche Aussagen zu grob.
- Weitere Globalmodelle (Kanada GEM, Japan JMA, China, Australien): grob aufgelöst, für Europa kein erkennbarer Gewinn.
- Dienste mit Schlüssel (OpenWeatherMap, WeatherAPI, meteoblue u.a.): Ein Schlüssel im öffentlichen Repo wäre für alle sichtbar.
- GeoSphere Austria direkt: Datensatz wurde 2026 umgestellt; über Open-Meteo ist dasselbe Modell verfügbar.

## Hinweise auf markantes Wetter (11.11.2026)
Hinweise der App, keine amtlichen Warnungen. Schwellen: Böen ab 50 km/h (Beaufort 7) als Hinweis, ab 62 (Beaufort 8) hervorgehoben, ab 75 «Sturmböen», ab 89 «Schwere Sturmböen»; Regen ab 5 mm pro Stunde, «Starkregen» ab 15; Frost ab 0 Grad; Hitze ab 30 Grad; dazu Gewitter, Schneefall, Nebel. Die Schwellen sind Setzungen.

## Animation: Flimmern behoben, Darstellung überarbeitet (12.11.2026)
- Ursache des Flimmerns (gemessen): Die Zahlen im Bild wurden zwischen den Stunden laufend mitgerechnet und änderten sich bis zu 30-mal pro Sekunde; weil Ziffern verschieden breit sind, rückte der Text daneben hin und her. Jetzt zeigt der Text die Werte der aktuellen Stunde, wechselt nur beim Stundenwechsel (rund einmal pro Sekunde bei Tempo 1×) und setzt Ziffern mit fester Breite.
- Die Bildgrösse hängt nicht mehr von der ein- und ausfahrenden Adressleiste ab.
- Wolken aus einem Rauschfeld statt aus einzelnen Ballen, Gebirge in zwei Ketten mit Schattenflanken und Schneegrenze, Grasstruktur, feines Korn.
- Gebirge, Landschaft, Text, Zeitleiste und Bildabschluss werden zwischengespeichert und nur bei Änderungen neu gezeichnet. Zeichenzeit pro Bild im Testbrowser (ohne Grafikbeschleunigung, 1336×1195 Punkte): im Mittel 17.9 ms statt 21.0 ms.

## Animation: weichere Übergänge, Nebel überarbeitet (12.11.2026)
- Licht und Wetter im Bild folgen den Zielwerten mit Trägheit (Zeitkonstante 0.65 s bei Tempo 1×) und zielen eine knappe halbe Stunde voraus. Der Wechsel zwischen zwei Wetterlagen läuft über fast die ganze Stunde statt nur um die Stundenmitte. Die Dämmerung reicht von -9 bis +9 Grad Sonnenhöhe statt von -6 bis +6.
- Gemessen im Testbrowser: Die Bewölkung ändert sich pro Bild höchstens um 1.3 % (vorher rund 5 %).
- Folge: Eine Wetterlage, die nur eine Stunde dauert, erreicht im Bild nicht mehr die volle Stärke (Regen rund 60 %). Die Beschriftung zeigt sie weiterhin an.
- Nebel: oben dünner, damit die Wolkendecke erkennbar bleibt; ziehende Nebelschichten, durchscheinende Sonne, Schwaden ohne Kanten.

## Wind, Gewitter, Nebel (Stand 10.11.2026)
- Wind und Böen: gewichteter Median der Quellen mit Angabe, in km/h. MET Norway liefert keine Böen.
- Gewitter: wird angezeigt, sobald Quellen mit zusammen mindestens 30 % des Gewichts eines melden. Die Schwelle ist bewusst tief, weil Gewitter örtlich und schwer vorherzusagen sind; sie ist eine Setzung, nicht gemessen.
- Nebel: wird angezeigt, wenn die Mehrheit (nach Gewicht) ihn meldet und es nicht regnet oder schneit.
- Quelle der Angaben: Wettercode (Open-Meteo), Wettersymbol (MET Norway), Wetterzustand (Bright Sky). Feldnamen aus dem Gedächtnis, nicht gegen die Dokumentation geprüft.
- Wind, Gewitter und Nebel fliessen nicht in die Auswertung der Trefferquote ein. Diese bewertet weiterhin nur die ersten 24 Stunden.

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

## Eigene Auswertung der Trefferquote (Stand 10.11.2026)
- Bei jedem Laden merkt sich die App die Vorhersage jeder Quelle für die kommenden 24 Stunden (pro Ort, nur auf dem Gerät). Bewertet wird die früheste gemerkte Vorhersage einer Stunde.
- Beim nächsten Laden desselben Orts werden vergangene Stunden mit dem eingetretenen Wetter verglichen: mittlerer Temperaturfehler, Tendenz (zu warm/zu kalt), Trefferquote nass/trocken (Schwelle 0.1 mm).
- Vergleichsdaten: Stationsmessung, wenn eine Station höchstens 12 km entfernt und höchstens 150 m höher oder tiefer liegt (Schweiz: MeteoSchweiz SwissMetNet, Zehnminutenwerte; Deutschland: DWD via Bright Sky). Für Stunden ohne Messung die Modellanalyse von Open-Meteo. Die App zählt mit, wie viele Vergleiche auf Messungen beruhen.
- Bei jedem Laden werden auch bis zu drei andere gemerkte Orte ausgewertet.
- Gewichte: ab 24 ausgewerteten Stunden fliesst die Auswertung ein, ab 168 Stunden zählt nur noch sie. Temperatur: Kehrwert des quadrierten mittleren Fehlers. Niederschlag: Kehrwert der Fehlerquote nass/trocken. Begrenzt auf 0.3 bis 2.5.
- Vorhersagen ohne Vergleichsdaten verfallen nach 72 Stunden. Die App muss also mindestens alle zwei bis drei Tage geöffnet werden.

Grenzen:
- Die Modellanalyse ist keine Messung. Sie stammt selbst aus einem Wettermodell und kann verwandte Quellen bevorzugen.
- Die Messdatei von MeteoSchweiz reicht nur bis gestern 12 UTC zurück. Ältere Stunden werden mit der Modellanalyse verglichen.
- Ausserhalb der Schweiz und Deutschlands gibt es keine Stationsmessungen; dort gilt nur die Modellanalyse.
- Die Auswertung fasst alle Orte zusammen und unterscheidet nicht nach Vorlaufzeit.
- Die Abhängigkeit zwischen ECMWF und MET Norway wird durch gelernte Gewichte nicht mehr berücksichtigt.

## Etappen
1. [x] MVP: PWA, Ortssuche, Standort, Quellen, Konsens, Animation, Stundentabelle
2. [x] Test mit echten Daten auf dem Gerät: alle sieben Quellen liefern (Rückmeldung 10.11.2026)
3. [x] GitHub Pages aktivieren, App auf Handy und iPad installieren
4. [x] Gewichtung der Quellen, detailliertere Animation (Titelbild, Zusammenfassung, Landschaft, Zeitleiste)
5. [x] Eigene Auswertung der Trefferquote mit lernenden Gewichten
6. [x] Wind und Böen, Gewitter, Nebel, 48 Stunden
7. [x] Tagesübersicht, Hinweise, Abspieltempo, sechs Regionalmodelle, Stationsmessungen für die Auswertung, Dorf und hellere Nacht in der Animation
8. [ ] Weiterer Feinschliff nach Rückmeldung (z.B. Favoriten)

## Offene Punkte
- Die echten Schnittstellen konnten in der Entwicklungsumgebung nicht aufgerufen werden (Netzwerk gesperrt). Getestet ist nur mit nachgebildeten Antworten. Adressen, Parameter und Modellnamen stammen aus dem Gedächtnis und sind nicht gegen die Dokumentation geprüft.
- MET Norway und Bright Sky: unklar, ob der direkte Abruf aus dem Browser erlaubt ist. Falls nicht, zeigt die App die Quelle als «nicht erreichbar» und rechnet ohne sie.
- Bright Sky deckt vermutlich nur Orte in der Nähe von DWD-Stationen ab.
- Die fünf Open-Meteo-Modelle kommen über denselben Dienst: fällt Open-Meteo aus, fehlen alle fünf.
