# Gridfinity Planer

Web-App: Innenmaß einer Box eingeben, heraus kommen

- das passende **Gridfinity-Raster** (42-mm-Zellen, optional halbe Zellen),
- **Abstandshalter** (Leisten) bis zur Boxwand,
- die **Aufteilung** der Grundplatten aufs Druckbett (Standard: Bambu Lab X2D, 235,5 × 256 × 256 mm),
- **gestapelte Druckjobs**: Platten in PLA übereinander, dazwischen eine PETG-Trennschicht,
- **Downloads** als ZIP mit STL- und 3MF-Dateien.

**Live:** https://felixbuesch.github.io/Gridfinity_Generator/ (wird bei jedem Push auf `main` neu gebaut)

Hintergrund, Entscheidungen und offene Punkte: [`docs/ZUSAMMENFASSUNG.md`](docs/ZUSAMMENFASSUNG.md).

## Entwicklung

```bash
npm install
npm run dev        # Entwicklungsserver
npm test           # vitest: alle Netze mit manifold-3d auf Geschlossenheit prüfen
npm run build      # dist/: Website mit getrennten Dateien (so läuft sie auf GitHub Pages)
npm run build:single   # dist-single/index.html: eine einzige Datei, offline per Doppelklick
npm run export-sample   # Beispiel-STL/3MF nach tests/out/
```

## Aufbau

| Datei | Inhalt |
| --- | --- |
| `src/gf.js` | Kern: Layout, Netze, STL/3MF/ZIP. ES-Modul ohne Abhängigkeiten, läuft in Node und im Browser. |
| `src/intro.js` | Startbildschirm: 3D-Auswahl Schreibtisch / Schublade / Box, Maße eingeben, Raster live im Modell |
| `src/main.js` | Oberfläche: Formular, three.js-Ansichten, Auswahl, Hover, Tooltips, Downloads |
| `src/style.css` | Design-Tokens hell/dunkel, Layout |
| `index.html` | Formular und Seitengerüst |
| `tests/manifold.test.js` | Mehrere Boxgrößen × Abstandshalter-Modi × alle PETG-Formen, jedes Netz muss mannigfaltig sein |
