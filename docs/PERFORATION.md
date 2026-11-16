# Machbarkeit: Trennung aus dem Druckmaterial selbst („Ein Material, Perforation“)

Stand: vor dem ersten Testdruck. Alle Werte sind hergeleitet, nicht gedruckt.

## Ergebnis

Machbar, mit Vorbehalt. Das Verfahren ist dasselbe wie bei Stützen aus dem gleichen Material: ein Luftspalt, den
der Drucker überbrückt, und wenige feste Verbindungen. Ob sich die Platten gut lösen, hängt an drei Werten
(Z-Abstand, Punktdurchmesser, Punktabstand). Die müssen einmal am Drucker ausprobiert werden, dafür gibt es
die Testdateien in `testdruck/`.

## Welche Flächen berühren sich

Die Platten liegen abwechselnd aufrecht und kopfüber. Dadurch gibt es zwei Arten von Fugen:

| Fuge | unten | oben | Kontaktfläche |
|---|---|---|---|
| Steg auf Steg | aufrechte Platte | Platte kopfüber | nur die flachen Stegoberkanten: 0,5 mm breite Linien im 42-mm-Raster |
| Fuß auf Fuß | Platte kopfüber | aufrechte Platte | das Fußgitter: 5,7 mm breite Stege (am Rand 2,85 mm) |

In beiden Fugen liegt Material genau über Material, weil die Platten zellgenau gestapelt werden.
Gestützt werden muss also nur die erste Schicht der oberen Platte, und nur auf diesen Flächen. Die Taschen
selbst bleiben frei: Kopfüber wachsen die Stege unter 45° nach außen, aufrecht stehen sie senkrecht bzw. 45° nach innen.

## Was die Punkte tun

- Zwischen zwei Platten bleibt ein Luftspalt (Z-Abstand). Darin stehen Punkte aus demselben Material.
- Die erste Schicht der oberen Platte liegt auf den Punkten auf und überbrückt den Rest.
- Die Punkte sind die Sollbruchstellen. Je kleiner und je weiter auseinander, desto leichter lösen sich die Platten,
  desto mehr hängt aber die erste Schicht durch.

Wo die Punkte sitzen:

- **Steg auf Steg:** eine Reihe auf der Mittellinie jeder Stegoberkante, dazu jede Stegkreuzung. Die erste Schicht ist
  dort eine einzelne Bahn längs des Stegs. Sie überbrückt von Punkt zu Punkt in ihrer eigenen Richtung, das druckt sauber.
- **Fuß auf Fuß:** zwei Reihen je Steg, je 0,6 mm innerhalb der Fußkante, und eine Reihe 0,6 mm innerhalb des Außenrands.
  Dort laufen die äußeren Bahnen der ersten Schicht. Die Füllung dazwischen hängt seitlich an diesen Bahnen.
- **Leisten-Türme:** Punkte mittig auf Schienen und Streben.
- Keine Punkte in Wandrundungen und über Verbindungstaschen (dort wäre unten kein Material).

## Standardwerte und warum

| Wert | Standard | Begründung |
|---|---|---|
| Z-Abstand | 0,4 mm | Zwei Schichten bei 0,2 mm. Bei nur einer Schicht (0,2 mm) sackt die erste Bahn auf die Platte darunter und klebt überall leicht fest, die Punkte wären dann wirkungslos. Der Wert muss ein Vielfaches der Schichthöhe sein. |
| Punktdurchmesser | 0,8 mm | Zwei Bahnen einer 0,4-mm-Düse. Bambu Studio lässt Inseln unter etwa einer Bahnbreite (0,42 mm) weg oder druckt sie als Klecks. 0,8 mm wird als kleiner Kreis sicher gedruckt. Bruchfläche 0,5 mm², etwa 15 N je Punkt. |
| Punktabstand | 6 mm | Eine einzelne PLA-Bahn überbrückt 6 mm fast ohne Durchhang. Teilt 42 mm in 7 gleiche Schritte, die Punkte liegen damit in jeder Zelle gleich. |

Der Abstand wird je Zelle auf einen ganzen Teiler gerundet (42 mm ÷ 7 = 6 mm).

## Verhalten des Slicers

- Punkte und Platten sind getrennte Körper, die sich flächig berühren. Bambu Studio verschmilzt sie beim Slicen.
- Der Z-Abstand wird nur eingehalten, wenn die Schichthöhe ihn teilt: 0,2 mm (Standard) oder 0,1 mm. Bei 0,16 oder 0,28 mm
  rundet der Slicer, dann stimmt der Spalt nicht. Erste Schicht ebenfalls 0,2 mm einstellen.
- Die Plattenhöhe 4,4 mm sind genau 22 Schichten, der Stapelschritt 4,8 mm genau 24.
- „Dünne Wände erkennen“ bzw. der Arachne-Wandgenerator (Standard) muss an sein, sonst fehlen Punkte.
- Stützen aus. Kein zweites Material, kein Prime-Tower, das ganze Bett ist nutzbar.

## Risiken

1. **Zu fest:** Im Fuß-auf-Fuß-Kontakt ist die Fläche groß. Hängt die erste Schicht durch und berührt die Platte
   darunter, verschweißt sie flächig. Gegenmittel: größerer Z-Abstand (0,6 mm), kleinerer Punktabstand, Lüfter 100 %.
2. **Zu lose:** Bei weitem Punktabstand kann sich eine Platte im Druck lösen oder die Ecken ziehen hoch, vor allem
   bei hohen Stapeln. Gegenmittel: kleinerer Abstand, größere Punkte.
3. **Oberfläche:** Die Unterseite der aufrechten Platten wird rau (überbrückte erste Schicht, Punktreste).
   Das ist die Auflagefläche am Schubladenboden, dort stört es kaum. Auf den Stegoberkanten bleiben Stummel bis
   0,4 mm stehen. Die Boxen sitzen nicht auf der Oberkante auf, die Stummel lassen sich abbrechen oder abziehen.
4. **Maßhaltigkeit:** Durchhang macht die Platte unten bis zu etwa 0,2 mm dicker. Bei Verbindungen (Zapfen/Brücken)
   kann das die Taschenhöhe verringern.
5. **Ungetestet:** Das Zusammenspiel von Bahnrichtung und Punktreihen im Fußgitter ist die größte Unbekannte.
   Deshalb zuerst die Testdatei mit drei Platten drucken, sie enthält beide Fugen.

## Empfehlung

Zuerst `testdruck/Test_Perforation_4Abstaende.3mf` drucken (vier kleine Stapel mit 4, 6, 9 und 12 mm Abstand),
dann den besten Abstand im Planer eintragen. Bis dahin bleibt „Wendeplatte“ mit PETG die sichere Wahl.
