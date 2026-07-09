<div align="center">

[![Open Science Desktop — Local-first AI research workbench](./docs/assets/banner.webp)](https://github.com/ai4s-research/open-science)

# Open Science Desktop

**Atelier de recherche IA local-first et agnostique au modèle pour macOS, Windows & Linux.**

Formerly Open Science. Une alternative desktop open source à Claude Science et aux workbenches AI-for-science similaires, construite avec Tauri, MCP, agent skills et des artefacts reproductibles. Elle relie agents, notebooks, fichiers, figures, rapports, exécutions et revue dans un flux desktop auditable.

<p>
  <a href="./README.md">English</a> ·
  <a href="./README.zh.md">简体中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <b>Français</b> ·
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

## Sommaire

- [✨ Ce que fait Open Science](#ce-que-fait-open-science)
- [🎬 Captures](#captures)
- [🧪 Fonctionnalités actuelles](#fonctionnalités-actuelles)
- [🔌 Skills et connecteurs](#skills-et-connecteurs)
- [📦 Installation](#installation)
- [🚀 Construire depuis le code source](#construire-depuis-le-code-source)
- [🔒 Sécurité et confidentialité](#sécurité-et-confidentialité)
- [🗂️ Structure du dépôt](#structure-du-dépôt)
- [📌 État](#état)

## Ce que fait Open Science

- **Atelier, pas seulement chat** : planifier, approuver, exécuter, inspecter les artefacts, revoir et reproduire dans une seule app.
- **Artefacts traçables** : figures, tables, rapports, notebooks et sorties d'exécution peuvent revenir au code, aux entrées, à l'environnement, au modèle et à la conversation.
- **Local-first** : les sessions vivent dans des dossiers locaux ; fichiers, provenance, notebooks, aperçus et run records restent sur votre machine par défaut.
- **Agnostique au modèle** : l'UI passe par `packages/sdk` vers un sidecar OpenCode épinglé ; fournisseurs, skills et serveurs MCP restent remplaçables.
- **Reproductibilité d'abord** : les exécutions locales, SSH/Slurm, Modal et notebook-batch peuvent être enregistrées comme run records reproductibles.

## Captures

![End-to-end dose-response analysis](./docs/assets/showcase-workflow.webp)

![Artifact inspector showing provenance](./docs/assets/showcase-provenance.webp)

![Literature survey producing a rendered PDF manuscript](./docs/assets/showcase-literature.webp)

<details>
<summary><b>Autres captures</b></summary>

<br>

![Jupyter notebook](./docs/assets/showcase-notebook.webp)

![Experiment sweep](./docs/assets/showcase-experiment.webp)

![Skills library](./docs/assets/showcase-skills.webp)

</details>

## Fonctionnalités actuelles

| Domaine | État actuel |
| --- | --- |
| Desktop | Tauri 2 + React + TypeScript + Vite, avec cibles macOS, Windows et Linux. |
| Runtime | Sidecar OpenCode inclus, démarré par l'app et isolé de la configuration/données OpenCode de l'utilisateur. |
| Sessions | Chat multi-session, historique, dossiers workspace datés, historique global, commandes `/` et mode shell `!`. |
| Fichiers | Navigation globale et par session, menu contextuel, ouvrir/révéler, copier le chemin, serveur local de preview. |
| Notebooks | Fichiers `.ipynb` réels, création Python/R, kernel local, environnement Jupyter géré via `uv`, action Open JupyterLab. |
| Exécutions | Run logs append-only, index SQLite global, recherche/facettes/pagination, surfaces locales/distantes, liens de sorties, logs et prompts de reproduction. |
| Provenance | `.openscience/provenance.jsonl` enregistre les versions de fichiers et relie les artefacts à l'exécution ou l'édition qui les a créés. |
| Visionneuses | PDF, image, vidéo, HTML, Markdown, code, CSV/TSV avec graphiques, DOCX, XLSX, PPTX, molécules, 3D mesh, génome, FITS, DOS/DOSCAR, EIGENVAL bands, qcode, cartes d'anomalies et fichiers phase. |
| Langues de l'UI | English, 简体中文, 日本語, Español, Deutsch, Français et 한국어. Portuguese (Brazil) et Arabic sont enregistrés mais pas encore sélectionnables. |

## Skills et connecteurs

Au build, le projet récupère `ai4s-skills`, les skills `docx`/`pdf`/`pptx`/`xlsx` de `anthropics/skills`, et les skills internes de `runtime/skills/core/` : `traceability-review`, `stats-integrity`, `domain-check`, `large-file`, `publication-figures`, `remote-compute` et `modal-run`.

Connecteurs MCP scientifiques en un clic : recherche bibliographique, bases biomédicales, Materials Project, FRED, Space weather, Open-Meteo et USGS water data. Tout serveur MCP local ou distant peut aussi être ajouté depuis Settings.

## Installation

Téléchargez la dernière version depuis [Releases](https://github.com/ai4s-research/open-science/releases/latest).

- **macOS** : `.dmg` / `.app`, Apple Silicon et Intel, macOS 13 Ventura ou plus récent.
- **Windows** : `.exe` NSIS et `.msi`, Windows 10/11 x64.
- **Linux** : `.deb` et `.rpm` pour x86_64.

Les builds ne sont pas encore signés. Si macOS bloque l'app :

```bash
xattr -cr "/Applications/Open Science.app"
```

Sous Windows, choisissez **More info -> Run anyway** dans SmartScreen.

## Construire depuis le code source

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

Vérifications :

```bash
pnpm test
pnpm typecheck
pnpm lint
```

## Sécurité et confidentialité

Les fichiers du workspace, données brutes, historique, provenance, notebooks et run records restent locaux par défaut. Exécution de commandes, suppression de fichiers, installation de dépendances et connexions distantes passent par une approbation humaine. Les identifiants sont stockés dans la configuration privée de l'app, pas dans le workspace, la provenance, git, les exports ni la configuration OpenCode globale.

## Structure du dépôt

| Chemin | Rôle |
| --- | --- |
| `apps/desktop/` | App desktop Tauri + React. |
| `packages/sdk/` | `OpenCodeClient`, couche qui évite les appels directs UI -> OpenCode. |
| `packages/shared/` | Types partagés et palette de graphiques. |
| `runtime/skills/core/` | Skills scientifiques internes. |
| `runtime/skills/external/` | Skills externes récupérés au build. |
| `examples/` | Workspaces d'exemple inclus. |
| `scripts/dev/` | Fetchers sidecar, `uv`, skills et tests ciblés. |
| `docs/` | Notes produit, technique, operator, connecteurs et recherche. |

## État

Version actuelle : **v0.1.7**. Le journal d'implémentation le plus fiable est [`PROGRESS.md`](./PROGRESS.md). Les prochains travaux portent sur les releases signées/notarisées, la vérification Windows/Linux, l'auto-update, le durcissement des connecteurs et la revue de reproductibilité. Pour discuter du projet, rejoignez le [Discord Open Science](https://discord.gg/fWNMDKcd5P).

[MIT](./LICENSE). Open Science Desktop est un outil de recherche beta : traitez les sorties comme des brouillons et vérifiez nombres, citations, code et conclusions avant publication ou décision.
