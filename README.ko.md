<div align="center">

[![Open Science — An open AI workbench for scientists](./docs/assets/banner.webp)](https://github.com/ai4s-research/open-science)

# Open Science

**과학자를 위한 오픈 AI 워크벤치.** 엄밀한 과학 연구를 위한 연구 파트너입니다.

Open Science는 오픈소스, **로컬 우선**, **모델 독립**, **재현성 중심** AI 연구 워크벤치입니다. 단순한 채팅이 아니라 에이전트, 노트북, 파일, 그림, 보고서, 실행 기록, 리뷰를 하나의 감사 가능한 데스크톱 워크플로로 연결합니다. 데스크톱 UI는 현재 7개 선택 가능한 언어로 제공됩니다.

<p>
  <a href="./README.md">English</a> ·
  <a href="./README.zh.md">简体中文</a> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.de.md">Deutsch</a> ·
  <a href="./README.fr.md">Français</a> ·
  <b>한국어</b>
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

## 목차

- [✨ 무엇을 하나요](#무엇을-하나요)
- [🎬 스크린샷](#스크린샷)
- [🧪 현재 기능](#현재-기능)
- [🔌 스킬과 커넥터](#스킬과-커넥터)
- [📦 설치](#설치)
- [🚀 소스에서 빌드](#소스에서-빌드)
- [🔒 안전과 개인정보](#안전과-개인정보)
- [🗂️ 저장소 구조](#저장소-구조)
- [📌 상태](#상태)

## 무엇을 하나요

- **채팅이 아니라 워크벤치**: 계획, 승인, 실행, 산출물 검사, 리뷰, 재현을 하나의 앱에서 처리합니다.
- **추적 가능한 산출물**: 그림, 표, 보고서, 노트북, 실행 출력을 코드, 입력, 환경, 모델 출력, 대화로 연결할 수 있습니다.
- **로컬 우선**: 세션은 로컬 워크스페이스 폴더에 저장되며 파일, provenance, 노트북, 미리보기, 실행 기록은 기본적으로 로컬에 남습니다.
- **모델 독립**: UI는 `packages/sdk`를 통해 번들된 OpenCode sidecar와 통신하며 provider, skill, MCP 서버는 교체 가능합니다.
- **재현성 우선**: 로컬, SSH/Slurm, Modal, notebook-batch 실행을 단순 터미널 출력이 아닌 재현 가능한 run record로 기록할 수 있습니다.

## 스크린샷

![End-to-end dose-response analysis](./docs/assets/showcase-workflow.webp)

![Artifact inspector showing provenance](./docs/assets/showcase-provenance.webp)

![Literature survey producing a rendered PDF manuscript](./docs/assets/showcase-literature.webp)

<details>
<summary><b>추가 스크린샷</b></summary>

<br>

![Jupyter notebook](./docs/assets/showcase-notebook.webp)

![Experiment sweep](./docs/assets/showcase-experiment.webp)

![Skills library](./docs/assets/showcase-skills.webp)

</details>

## 현재 기능

| 영역 | 현재 상태 |
| --- | --- |
| 데스크톱 | Tauri 2 + React + TypeScript + Vite, macOS/Windows/Linux 빌드 대상. |
| 런타임 | 앱이 자동 시작하는 번들 OpenCode sidecar. 사용자의 OpenCode 설정/데이터와 격리됩니다. |
| 세션 | 다중 세션 채팅/히스토리, 날짜별 워크스페이스 폴더, 전역 히스토리, `/` 명령, `!` shell 모드. |
| 파일 | 전역/세션 파일 탐색, 컨텍스트 메뉴, 외부 열기/표시, 경로 복사, 로컬 미리보기 서버. |
| 노트북 | 실제 `.ipynb`, Python/R 노트북 생성, 로컬 커널 실행, 번들 `uv` 기반 Jupyter 환경, JupyterLab 열기. |
| 실행 기록 | append-only run log, 전역 SQLite 인덱스, 검색/필터/페이지네이션, 로컬/원격 surface, 출력 링크, 로그, 재현 prompt. |
| Provenance | `.openscience/provenance.jsonl`이 파일 버전을 기록하고 산출물을 생성한 실행 또는 편집과 연결합니다. |
| 뷰어 | PDF, 이미지, 비디오, HTML, Markdown, 코드, CSV/TSV와 차트, DOCX, XLSX, PPTX, 분자, 3D mesh, genome, FITS, DOS/DOSCAR, EIGENVAL bands, qcode, anomaly map, phase 파일. |
| UI 언어 | English, 简体中文, 日本語, Español, Deutsch, Français, 한국어. Portuguese (Brazil)와 Arabic은 등록되어 있지만 아직 선택할 수 없습니다. |

## 스킬과 커넥터

빌드 시 `ai4s-skills`, `anthropics/skills`의 `docx`/`pdf`/`pptx`/`xlsx`, 그리고 `runtime/skills/core/`의 first-party 스킬을 가져옵니다: `traceability-review`, `stats-integrity`, `domain-check`, `large-file`, `publication-figures`, `remote-compute`, `modal-run`.

원클릭 과학 MCP 커넥터: literature search, biomedical databases, Materials Project, FRED, Space weather, Open-Meteo, USGS water data. Settings에서 로컬 또는 원격 MCP 서버를 직접 추가할 수도 있습니다.

## 설치

[Releases](https://github.com/ai4s-research/open-science/releases/latest)에서 최신 설치 파일을 받으세요.

- **macOS**: `.dmg` / `.app`, Apple Silicon 및 Intel, macOS 13 Ventura 이상.
- **Windows**: NSIS `.exe` 및 `.msi`, Windows 10/11 x64.
- **Linux**: x86_64용 `.deb` 및 `.rpm`.

아직 코드 서명/공증이 없습니다. macOS에서 앱이 차단되면:

```bash
xattr -cr "/Applications/Open Science.app"
```

Windows에서는 SmartScreen에서 **More info -> Run anyway**를 선택합니다.

## 소스에서 빌드

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

검사:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

## 안전과 개인정보

워크스페이스 파일, 원본 데이터, 세션 히스토리, provenance, 노트북, run record는 기본적으로 로컬에 남습니다. 명령 실행, 파일 삭제, 의존성 설치, 원격 연결은 사용자 승인을 거칩니다. 자격 증명은 앱 전용 런타임 설정에 저장되며 워크스페이스, provenance, git, export, 전역 OpenCode 설정에는 들어가지 않습니다.

## 저장소 구조

| 경로 | 용도 |
| --- | --- |
| `apps/desktop/` | Tauri + React 데스크톱 앱. |
| `packages/sdk/` | UI가 OpenCode를 직접 호출하지 않도록 하는 `OpenCodeClient`. |
| `packages/shared/` | 공유 타입과 차트 팔레트. |
| `runtime/skills/core/` | First-party 과학 스킬. |
| `runtime/skills/external/` | 빌드 시 가져오는 외부 스킬. |
| `examples/` | 내장 예제 워크스페이스. |
| `scripts/dev/` | sidecar, `uv`, skill fetcher 및 집중 회귀 검사. |
| `docs/` | 제품, 기술, operator, connector, research notes. |

## 상태

현재 앱 버전은 **v0.1.7**입니다. 가장 신뢰할 수 있는 구현 로그는 [`PROGRESS.md`](./PROGRESS.md)입니다. 가까운 작업은 서명/공증된 릴리스, Windows/Linux 검증 확대, 자동 업데이트, 커넥터 강화, 재현성 리뷰 지속입니다. 토론은 [Open Science Discord](https://discord.gg/fWNMDKcd5P)에서도 할 수 있습니다.

[MIT](./LICENSE). Open Science는 beta 연구 도구입니다. 출력은 초안으로 보고, 공개나 의사결정 전에 숫자, 인용, 코드, 결론을 검증하세요.
