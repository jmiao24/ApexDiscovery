<div align="center">

[![Open Science — An open AI workbench for scientists](./docs/assets/banner.webp)](https://github.com/ai4s-research/open-science)

# Open Science

**Eine offene KI-Workbench für Wissenschaftlerinnen und Wissenschaftler.** Dein Forschungspartner für rigorose Wissenschaft.

Open Science ist eine quelloffene, **local-first**, **modellunabhängige** und **reproduzierbare** KI-Forschungs-Workbench. Es ist nicht nur ein Chat: Agenten, Notebooks, Dateien, Abbildungen, Berichte, Läufe und Reviews werden zu einem auditierbaren Desktop-Workflow verbunden. Die Desktop-UI wird derzeit in sieben auswählbaren Sprachen ausgeliefert.

<p>
  <a href="./README.md">English</a> ·
  <a href="./README.zh.md">简体中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.es.md">Español</a> ·
  <b>Deutsch</b> ·
  <a href="./README.fr.md">Français</a> ·
  <a href="./README.ko.md">한국어</a>
</p>

<p>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/version-v0.1.7-orange" alt="v0.1.7">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platforms">
  <img src="https://img.shields.io/badge/i18n-7%20languages-5B8DEF" alt="7 interface languages">
  <img src="https://img.shields.io/badge/built%20with-Tauri%202%20%2B%20React-24C8DB" alt="Built with Tauri + React">
  <img src="https://img.shields.io/badge/runtime-OpenCode-success" alt="OpenCode runtime">
  <a href="https://discord.gg/fWNMDKcd5P"><img src="https://img.shields.io/badge/Join-Discord-5865F2" alt="Join Discord"></a>
</p>

</div>

---

## Inhalt

- [✨ Was es leistet](#was-es-leistet)
- [🎬 Screenshots](#screenshots)
- [🧪 Aktuelle Funktionen](#aktuelle-funktionen)
- [🔌 Skills und Konnektoren](#skills-und-konnektoren)
- [📦 Installation](#installation)
- [🚀 Aus dem Quellcode bauen](#aus-dem-quellcode-bauen)
- [🔒 Sicherheit und Datenschutz](#sicherheit-und-datenschutz)
- [🗂️ Repository-Struktur](#repository-struktur)
- [📌 Status](#status)

## Was es leistet

- **Workbench statt nur Chat**: planen, genehmigen, ausführen, Artefakte prüfen, reviewen und reproduzieren in einer App.
- **Nachvollziehbare Artefakte**: Abbildungen, Tabellen, Berichte, Notebooks und Lauf-Ausgaben können auf Code, Inputs, Umgebung, Modellausgabe und Gespräch zurückgeführt werden.
- **Local-first**: Sitzungen liegen in lokalen Workspace-Ordnern; Dateien, Provenance, Notebooks, Vorschauen und Run Records bleiben standardmäßig auf dem Gerät.
- **Modellunabhängig**: Die UI spricht über `packages/sdk` mit einem gebündelten OpenCode-Sidecar; Provider, Skills und MCP-Server bleiben austauschbar.
- **Reproduzierbarkeit zuerst**: Lokale, SSH/Slurm-, Modal- und Notebook-Batch-Läufe können als reproduzierbare Run Records gespeichert werden.

## Screenshots

![End-to-end dose-response analysis](./docs/assets/showcase-workflow.webp)

![Artifact inspector showing provenance](./docs/assets/showcase-provenance.webp)

![Literature survey producing a rendered PDF manuscript](./docs/assets/showcase-literature.webp)

<details>
<summary><b>Weitere Screenshots</b></summary>

<br>

![Jupyter notebook](./docs/assets/showcase-notebook.webp)

![Experiment sweep](./docs/assets/showcase-experiment.webp)

![Skills library](./docs/assets/showcase-skills.webp)

</details>

## Aktuelle Funktionen

| Bereich | Aktueller Stand |
| --- | --- |
| Desktop | Tauri 2 + React + TypeScript + Vite, mit Build-Zielen für macOS, Windows und Linux. |
| Runtime | Gebündeltes OpenCode-Sidecar, von der App gestartet und von der OpenCode-Konfiguration des Nutzers isoliert. |
| Sitzungen | Multi-Session-Chat, Verlauf, datierte Workspace-Ordner, globaler Verlauf, `/`-Befehle und `!`-Shell-Modus. |
| Dateien | Globale und sitzungsbezogene Dateiansicht, Kontextmenü, extern öffnen/anzeigen, Pfad kopieren, lokaler Preview-Server. |
| Notebooks | Echte `.ipynb`-Dateien, Python/R-Notebook-Erstellung, lokaler Kernel, Jupyter-Umgebung über gebündeltes `uv`, JupyterLab öffnen. |
| Läufe | Append-only Run Logs, globaler SQLite-Index, Suche/Facetten/Paginierung, lokale und entfernte Oberflächen, Output-Links, Logs und Reproduce-Prompts. |
| Provenance | `.openscience/provenance.jsonl` zeichnet Dateiversionen auf und verbindet Artefakte mit dem erzeugenden Lauf oder Edit. |
| Viewer | PDF, Bild, Video, HTML, Markdown, Code, CSV/TSV mit Charts, DOCX, XLSX, PPTX, Moleküle, 3D Mesh, Genom, FITS, DOS/DOSCAR, EIGENVAL bands, qcode, Anomaly Maps und Phase-Dateien. |
| UI-Sprachen | English, 简体中文, 日本語, Español, Deutsch, Français und 한국어. Portuguese (Brazil) und Arabic sind registriert, aber noch nicht auswählbar. |

## Skills und Konnektoren

Beim Build werden `ai4s-skills`, die `docx`/`pdf`/`pptx`/`xlsx`-Skills aus `anthropics/skills` und First-Party-Skills aus `runtime/skills/core/` geholt: `traceability-review`, `stats-integrity`, `domain-check`, `large-file`, `publication-figures`, `remote-compute` und `modal-run`.

Ein-Klick-MCP-Konnektoren: Literatursuche, biomedizinische Datenbanken, Materials Project, FRED, Space weather, Open-Meteo und USGS water data. Beliebige lokale oder entfernte MCP-Server können in Settings ergänzt werden.

## Installation

Lade den neuesten Installer von [Releases](https://github.com/ai4s-research/open-science/releases/latest).

- **macOS**: `.dmg` / `.app`, Apple Silicon und Intel, macOS 13 Ventura oder neuer.
- **Windows**: NSIS `.exe` und `.msi`, Windows 10/11 x64.
- **Linux**: `.deb` und `.rpm` für x86_64.

Die Builds sind noch nicht signiert. Falls macOS die App blockiert:

```bash
xattr -cr "/Applications/Open Science.app"
```

Unter Windows in SmartScreen **More info -> Run anyway** wählen.

## Aus dem Quellcode bauen

```bash
git clone https://github.com/ai4s-research/open-science
cd open-science
pnpm install
bash scripts/dev/fetch-opencode.sh
bash scripts/dev/fetch-uv.sh
bash scripts/dev/fetch-skills.sh
pnpm --filter @ai4s/desktop tauri dev
pnpm --filter @ai4s/desktop tauri build
```

Checks:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

## Sicherheit und Datenschutz

Workspace-Dateien, Rohdaten, Sitzungsverlauf, Provenance, Notebooks und Run Records bleiben standardmäßig lokal. Befehlsausführung, Dateilöschung, Dependency-Installation und Remote-Verbindungen laufen über menschliche Genehmigung. Zugangsdaten werden in app-privater Runtime-Konfiguration gespeichert, nicht im Workspace, in Provenance, git, Exporten oder globaler OpenCode-Konfiguration.

## Repository-Struktur

| Pfad | Zweck |
| --- | --- |
| `apps/desktop/` | Tauri + React Desktop-App. |
| `packages/sdk/` | `OpenCodeClient`, damit die UI OpenCode nicht direkt aufruft. |
| `packages/shared/` | Gemeinsame Typen und Chart-Palette. |
| `runtime/skills/core/` | First-Party-Wissenschafts-Skills. |
| `runtime/skills/external/` | Beim Build geholte externe Skills. |
| `examples/` | Mitgelieferte Beispiel-Workspaces. |
| `scripts/dev/` | Fetcher für Sidecar, `uv`, Skills und fokussierte Regressionstests. |
| `docs/` | Produkt-, Technik-, Operator-, Konnektor- und Forschungsnotizen. |

## Status

Aktuelle App-Version: **v0.1.7**. Das verlässlichste Implementierungslog ist [`PROGRESS.md`](./PROGRESS.md). Nahe Arbeiten: signierte/notarisierte Releases, breitere Windows/Linux-Verifikation, Auto-Update, robustere Konnektoren und weitere Reproduzierbarkeits-Reviews. Für Diskussionen gibt es den [Open Science Discord](https://discord.gg/fWNMDKcd5P).

[MIT](./LICENSE). Open Science ist Beta-Forschungstooling. Ausgaben sind Entwürfe: Zahlen, Zitate, Code und Schlussfolgerungen vor Veröffentlichung oder Entscheidung prüfen.
