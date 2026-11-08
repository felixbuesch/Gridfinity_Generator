# Gridfinity Planer – Sitzungszusammenfassung

Stand: 8. November 2026. Zweck: das Projekt in Claude Code (eigenes Repo) weiterführen.

## 1. Ziel

Eine Web-App, in die man das **Innenmaß einer Box** eingibt. Sie berechnet automatisch:

- das passende **Gridfinity-Raster** (42-mm-Zellen, optional halbe Zellen à 21 mm),
- **Abstandshalter** (Leisten), die den Rest bis zur Boxwand füllen,
- die **Aufteilung** der Grundplatten, sodass jedes Teil auf das Druckbett passt,
- **gestapelte Druckjobs**: mehrere Platten übereinander in PLA, dazwischen PETG zum Trennen,
- **Downloads** als ZIP mit STL- und 3MF-Dateien, die direkt druckbar sind.

Drucker: **Bambu Lab X2D** (zwei Düsen). Druckraum beim Druck mit beiden Düsen 235,5 × 256 × 256 mm, mit einer Düse 256 × 256 × 260 mm.

Live-Version: https://claude.ai/artifact/88EJZ4xHnvYb4ixMEW1Nfg

## 2. Dateien

Alles liegt im Projektordner `gridfinity-planer/`:

```
gridfinity-planer/
├── gridfinity-planer.html   fertige Einzeldatei (offline im Browser öffnen)
├── gf.js                    Geometrie- und Layout-Kern (Kopie von src/gf.js)
├── ZUSAMMENFASSUNG.md       dieses Dokument
└── src/
    ├── gf.js                Kern: Layout, Netze, STL/3MF/ZIP, ohne Abhängigkeiten, läuft in Node und im Browser
    ├── app_head.html        <title>, CSS (Design-Tokens hell/dunkel), Formular, Layout
    ├── app_js.html          UI-Logik: Formular, three.js-Ansichten, Auswahl, Hover, Tooltips, Downloads
    ├── build.py             setzt die drei Teile zu gridfinity-planer.html zusammen (gf.js wird bei /*__GF__*/ eingesetzt)
    └── tests/
        ├── manifold-check.mjs   prüft mit manifold-3d, ob alle Netze geschlossen sind (mehrere Boxgrößen)
        ├── export-sample.mjs    schreibt S1.3mf, S1_PLA.stl, S1_PETG.stl als Beispiel
        └── screenshot.js        Playwright-Screenshot der App
```

Bauen: `python3 src/build.py`. Testen: `npm i manifold-3d@3.0.1` und dann `node src/tests/manifold-check.mjs`.

Externe Bibliotheken nur in der App: three.js r128 (UMD von cdnjs) und `OrbitControls` (jsDelivr, three@0.128.0). `gf.js` selbst kommt ohne Abhängigkeiten aus.

## 3. Architektur und Kernlogik (`gf.js`)

### 3.1 Geometrie ohne CSG

Die Netze werden **direkt aus Dreiecken** aufgebaut, ohne Boolesche Operationen. Grund: Die Sandbox der Artifacts blockiert den Abruf von WASM, deshalb funktioniert manifold-3d dort nicht. Ein Vertex-Dedupe (auf 1e-4 gerundet) sorgt für ein geschlossenes, mannigfaltiges Netz (manifold).

- **Gridfinity-Profil der Grundplatte** (z / Einzug von der Zellkante): `0/2.85 → 0.7/2.15 → 2.5/2.15 → 4.65/0`. Plattenhöhe H = 4,65 mm, Eckradius oben R = 4 mm. Die Platte ist ein offener Rahmen ohne Boden.
  - Felix' vorhandene SimpleBase-STLs sind nur 4,25 mm hoch, sie folgen also nicht der Norm.
- **Kacheln (Tiles):** Jedes Teil ist ein Raster aus Kacheln.
  - Eine Taschenkachel ist eine Zelle mit Fasenprofil.
  - Eine Vollkachel ist ein massiver Block, etwa ein Rand oder eine Leistenschiene.
  - Kacheln mit gemeinsamer Kante teilen exakt dieselben Vertices, deshalb gibt es keine T-Kreuzungen.
  - An Schneidenebenen (Kante mit Einzug 0) bekommen Vollkacheln zusätzliche Punkte bei Ecke ± 4 mm.
  - Außenwände entstehen nur an Kanten ohne Nachbarkachel.
- Bausteine: `ring()` (abgerundetes Rechteck bei Einzug t), `loft()` (Fläche zwischen zwei Ringen), `rectAnnulus()`, `ringAnnulus()`, `perimeter()` (mit abgerundeten Ecken), `walls()`, `addPlate()`.

### 3.2 Layout (`compute(o)`)

1. **`axisLayout`** pro Achse:
   - nutzbares Maß = Innenmaß − Spiel,
   - n = floor(nutzbar / 42), optional eine halbe Zelle,
   - der Rest wird je nach Ausrichtung (start/center/end) auf die beiden Ränder verteilt,
   - Reste unter der Mindestbreite bleiben als Spalt.
2. **Aufteilung (`splitAxis`):** Dynamische Programmierung findet die kleinste Teilezahl pro Achse, bei der jedes Teil ≤ Bettmaß ist. Bei gleicher Teilezahl gewinnt die gleichmäßigste Aufteilung (kleinste Quadratsumme). Beide Ausrichtungen des Betts werden probiert. Wenn gestapelt wird, wird die Reserve für den Prime-Tower vorher vom Bett abgezogen.
3. **Abstandshalter**, zwei Modi:
   - `separate` (Standard): eigene Leisten. Die Leisten vorne und hinten gehen über die volle Breite, die Leisten links und rechts liegen dazwischen.
   - `integrated`: Der Rand wird an die Randplatten angesetzt.
4. **Leistenform „Leiter“:**
   - zwei Schienen, Standardbreite 1,2 mm,
   - eine Querstrebe alle 40 mm,
   - Höhe 2,4 mm,
   - Leisten mit weniger als 2 × Schiene + 1,5 mm Breite werden massiv.
   - Die Box-Eckradien werden an den Leistenenden abgerundet.
5. **Stapel (`buildStacks`):** gierig, größte Platte zuerst. Platte B darf auf Platte A, wenn ihre Zellen deckungsgleich auf A liegen (`axisFit`). Die Stapelhöhe ist durch Druckhöhe und `maxStack` begrenzt. Ist Stapeln aus, ist jede Platte ein eigener Job.
6. **Leisten aufs Plattenbett (`packSpacers`):**
   - Gleich lange Leisten werden zu **Türmen** gestapelt, wenn Stapeln an ist. Zwischen zwei Leisten liegt eine PETG-Platte mit genau ihrer Grundfläche.
   - Die Türme werden in die freien L-Bereiche neben der Platte gepackt (Bahnen, 3 mm Abstand).
   - Passt etwas nicht, wird mit kürzeren Teilstücken neu probiert (Faktoren 1 … 0,25).
   - Erst danach bekommen übrige Leisten ein eigenes Bett „L1…“.
7. **`stackMeshes`:** baut pro Druckbett ein PLA-Netz (Platten und Leisten) und ein PETG-Netz.

### 3.3 Export

- **STL** binär.
- **3MF:** ein Objekt mit Komponenten (PLA als Teil 1, PETG als Teil 2) plus `Metadata/model_settings.config` mit der Extruder-Zuordnung. **Nicht in Bambu Studio getestet.** Ausweichweg: PLA- und PETG-STL gemeinsam importieren und „als ein Objekt mit mehreren Teilen“ laden.
- **ZIP** selbst geschrieben (nur speichern, mit CRC32). Inhalt:
  - `druckbetten/` mit einer fertigen Datei pro Druckbett,
  - `einzelteile/platten/` und `einzelteile/leisten/`,
  - `LIESMICH.txt`.
- Im Artifact laufen Downloads über die Fähigkeit `downloads` (nur `.zip` ist erlaubt). Als lokale Datei startet der Download per `<a download>`.

## 4. PETG-Trennschicht – Entscheidungen

Das hat Felix entschieden, in dieser Reihenfolge:

1. **Ring mit Keil auf der Fase** (erster Entwurf): Unten am Keil stand eine 0,7 mm breite Kante frei in der Luft. ❌
2. **Keil wächst aus der Fase mit 45°:** Im Testdruck zerfiel er in viele kleine Inseln. Die ersten Schichten waren schmaler als eine Druckbahn und hielten nicht auf PLA, außerdem gab es Fäden. ❌
3. **Durchgehende Folie über die ganze Platte:** von Felix abgelehnt („keine ganze Schicht“). ❌
4. **Flaches Netz nur unter den Stegen:** Zwischenstand.
5. ✅ **Aktueller Standard „Aus Stegspitze“ (`sepStyle: 'grow'`), Felix' eigene Vorgabe:**
   - Das PETG beginnt **nur oben auf den Stegspitzen** (Schneiden und kleine flache Kreuzungspunkte) der unteren Platte.
   - Es wächst **im Überhangwinkel nach außen** (Standard 45° von der Senkrechten, einstellbar 20–70°), ohne Stützen, bis zum Einzug 2,85 mm. Das ist die volle Grundfläche der nächsten Platte, 5,7 mm pro Steg.
   - Darauf liegt eine **Basisschicht** von 0,6 mm, darauf die nächste Platte.
   - Pro Fuge ist das ein zusammenhängendes Gitter mit umgedrehtem V-Querschnitt.
   - Stapelabstand = H + 2,85 / tan(Winkel) + Basisschicht, bei 45° also etwa 8,1 mm pro Ebene.
   - Kosten: mehr PETG, beim Beispielstapel mit 3 Platten etwa 35 g.
   - Die anderen Formen (Netz, Netz + Keil, Folie) sind weiterhin auswählbar.
- **Leisten-Türme nicht ändern:** flache PETG-Platten mit genau der Leisten-Grundfläche. Laut Felix hat das gepasst.

## 5. Oberfläche (Wünsche von Felix)

- Box als 3D-Ansicht mit Maßlinien (Innenmaß).
- Das Teil unter der Maus wird hervorgehoben (orange), und es erscheint ein kurzer Hinweis.
- Ein Klick wählt ein Teil aus. Rechts erscheinen dann eine **3D-Ansicht nur dieses Teils** mit Maßen, Position und Gewicht und darunter **immer** ein kleines Fenster mit der **Druckansicht**.
  - Ohne Auswahl zeigt die Druckansicht alle Druckbetten.
  - Mit Auswahl zeigt sie den Druckjob des Teils, mit Ebene und Download.
- 3×3-Auswahl, an welcher Wand oder Ecke das Raster anliegt.
- **Hover-Tooltips** für alle Bedienelemente, auch für jedes neue.
- Ziel: so wenige Druckjobs wie möglich. Die Leisten kommen mit aufs Plattenbett.
- Sprache der Oberfläche: Deutsch. Felix schreibt auf Deutsch.

## 6. Druck- und Slicer-Hinweise (Bambu Studio, X2D)

- 3MF des Druckbetts öffnen. Alternativ PLA- und PETG-STL zusammen importieren und „als ein Objekt mit mehreren Teilen“ laden.
- PLA auf die linke Düse, PETG auf die rechte. **Stützen aus**, denn die Trennschichten sind schon modelliert.
- Prime-Tower an. Die App hält dafür 40 mm frei, einstellbar.
- Schichthöhe 0,2 mm.
- PETG: etwa 240 °C, Lüfter 30–50 %, 0,8 mm Rückzug, „Wipe while retracting“.
- „Avoid crossing walls“ an, „Thick bridges“ an. Die Wartetemperatur der gerade nicht druckenden Düse senken, damit sie nicht nachtropft.
- Die Leisten sind 2,4 mm hoch, die Platten 4,65 mm. Deshalb liegen die Materialwechsel in Leisten-Türmen und Plattenstapeln auf unterschiedlichen Höhen.

## 7. Offene Punkte

- **Testdruck der Form „Aus Stegspitze“** steht noch aus. Danach eventuell Winkel und Basisschicht anpassen.
- **3MF in Bambu Studio prüfen:** Werden die Extruder automatisch zugeordnet? Wenn nicht, auf das Projektformat von Bambu umbauen (`3D/Objects/*.model` plus `model_settings.config`).
- **Außenmaße der Box:** Bisher werden nur Innenmaße angezeigt. Dafür bräuchte die App ein Eingabefeld für die Wandstärke.
- **STEP-Export** fehlt, denn er ist im Browser nicht machbar. Möglich wäre eine Python/CadQuery-Variante, die dieselbe Layoutlogik nutzt.
- **Höhen abstimmen:** Die PETG-Ebenen der Leisten-Türme könnten auf die Fugen der Plattenstapel gelegt werden, damit es weniger Materialwechsel gibt.
- **Gemischte Stapel:** Eine kleinere Platte auf einer größeren funktioniert nur ohne Rand. Rand auf Tasche wird nicht gestapelt.

## 8. Startprompt für Claude Code

```
Ich baue den "Gridfinity Planer" als eigenes Repo weiter. Lies zuerst ZUSAMMENFASSUNG.md
und src/gf.js. Ziel: Web-App, die aus dem Innenmaß einer Box ein Gridfinity-Layout mit
Abstandshaltern berechnet, Platten aufs Druckbett aufteilt (Bambu Lab X2D, 235,5×256×256 mm),
Platten in PLA mit PETG-Trennschicht stapelt und alles als STL/3MF im ZIP exportiert.

Bitte:
1. Lege ein Repo an: src/gf.js als ES-Modul (Node + Browser), die App als Vite-Projekt
   (oder vorerst weiter als Einzeldatei über src/build.py), three.js als npm-Abhängigkeit.
2. Mach aus src/tests/manifold-check.mjs einen echten Test (vitest), der für mehrere
   Boxgrößen und alle sepStyle-Varianten prüft, dass jedes Netz geschlossen ist (manifold-3d).
3. Behalte alle Entscheidungen aus Abschnitt 4 und 5 bei, besonders die PETG-Form
   "Aus Stegspitze" (Start nur auf den Stegspitzen, 45° nach außen bis Einzug 2,85 mm,
   0,6 mm Basisschicht, keine durchgehende Schicht) und die unveränderten Leisten-Türme.
4. Danach die offenen Punkte aus Abschnitt 7 angehen, zuerst den 3MF-Export im
   Bambu-Studio-Projektformat.
Antworte auf Deutsch.
```
