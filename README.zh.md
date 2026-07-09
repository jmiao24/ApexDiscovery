<div align="center">

[![Open Science — 面向科研人员的开源 AI 工作台](./docs/assets/banner.webp)](https://github.com/ai4s-research/open-science)

# Open Science

**面向科研人员的开源 AI 工作台。** 你做严谨科研的研究伙伴。

Open Science 是一个开源、**本地优先**、**模型无关**、**可复现**的 AI 科研工作台。
它不是单纯的聊天框，而是把智能体、笔记本、文件、图表、报告、运行记录和审查连接成
一条可审计的桌面工作流。桌面 UI 当前发布 7 种可选择语言。

<p>
  <a href="./README.md">English</a> ·
  <b>简体中文</b> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.es.md">Español</a> ·
  <a href="./README.de.md">Deutsch</a> ·
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
  <a href="http://makeapullrequest.com"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://linux.do"><img src="https://img.shields.io/badge/Join-linux.do-orange" alt="linux.do"></a>
</p>

</div>

---

## 目录

- [✨ 它能做什么](#它能做什么)
- [🎬 效果演示](#效果演示)
- [🧪 当前能力](#当前能力)
- [🔌 技能与连接器](#技能与连接器)
- [📦 安装](#安装)
- [🚀 从源码构建](#从源码构建)
- [🔒 安全与隐私](#安全与隐私)
- [🗂️ 仓库结构](#仓库结构)
- [📌 状态](#状态)
- [🤝 参与贡献](#参与贡献)
- [⚖️ 许可证](#许可证)

## 它能做什么

- **工作台，而不是只有聊天**：规划、批准、执行、检查工件、审查和复现实验都在一个桌面应用里完成。
- **可追溯工件**：图、表、报告、笔记本和运行输出可以回到代码、输入、环境、模型输出和对话上下文。
- **本地优先工作区**：会话位于本地工作区文件夹内；文件、溯源、笔记本、预览和运行记录默认留在本机。
- **模型无关运行时**：UI 通过 `packages/sdk` 调用内置固定版本的 OpenCode sidecar，模型提供方、技能和 MCP 服务器保持可插拔。
- **可复现优先**：本地、SSH/Slurm、Modal 和 notebook-batch 运行都可以记录为可复现的 run record，而不是散落的终端输出。

## 效果演示

**一句提示 -> 一份完整、可追溯的分析。**

![端到端剂量-响应分析：智能体运行代码，产出拟合图与报告](./docs/assets/showcase-workflow.webp)

**每个工件都能回到它的代码、输入和对话。**

![工件检查器展示某张图的生成代码、输入与溯源信息](./docs/assets/showcase-provenance.webp)

**文献 -> 可验证报告。**

![文献综述产出渲染后的 PDF 稿件，并附带可追溯性评审](./docs/assets/showcase-literature.webp)

<details>
<summary><b>更多截图</b></summary>

<br>

![智能体驱动 Jupyter 笔记本并实时绘制 matplotlib 图](./docs/assets/showcase-notebook.webp)

![实验扫描表格与实时分析笔记本并列](./docs/assets/showcase-experiment.webp)

![技能库列出内置的科学技能](./docs/assets/showcase-skills.webp)

</details>

## 当前能力

| 范围 | 当前状态 |
| --- | --- |
| 桌面外壳 | Tauri 2 + React + TypeScript + Vite，具备 macOS、Windows、Linux 构建目标。 |
| 运行时 | 内置 OpenCode sidecar，由应用自动启动，并与用户自己的 OpenCode 配置/数据隔离。 |
| 会话 | 多会话聊天与历史、按时间创建的工作区文件夹、跨工作区全局历史、`/` 命令和 `!` shell 模式。 |
| 文件 | 全局和会话内文件浏览、右键菜单、系统打开/定位、复制路径、本地预览服务。 |
| 笔记本 | 真实 `.ipynb` 文件、Python/R 笔记本创建、本地内核运行、内置 `uv` 管理 Jupyter 环境，以及打开 JupyterLab。 |
| 运行记录 | 追加式 run log、全局 SQLite 索引、搜索/筛选/分页、本地与远程 surface、输出链接、日志和复现提示。 |
| 溯源 | `.openscience/provenance.jsonl` 记录文件版本，并把产物连回创建它的运行或编辑。 |
| 审查 | 内置 traceability、stats-integrity、domain-check、large-file、publication-figure、remote-compute、Modal run 等第一方技能。 |
| 查看器 | PDF、图片、视频、HTML、Markdown、代码、CSV/TSV 表格与图表、DOCX、XLSX、PPTX、分子、3D mesh、基因组轨道、FITS、DOS/DOSCAR、EIGENVAL bands、qcode、异常图和 phase 文件。 |
| 模型 | OpenCode 提供方目录、OAuth/API key 连接、自定义 OpenAI-compatible endpoint，以及 OpenCode 支持的本地/云模型选项。 |
| 界面语言 | English、简体中文、日本語、Español、Deutsch、Français、한국어。Portuguese (Brazil) 和 Arabic 已注册，但还不可选。 |

## 技能与连接器

构建和发布时会拉取内置技能，避免把第三方技能包直接提交到 git 历史：

- `ai4s-research/ai4s-skills` 技能包。
- Apache-2.0 `anthropics/skills` 仓库中的 Office/文档技能：`docx`、`pdf`、`pptx`、`xlsx`。
- `runtime/skills/core/` 中的第一方技能：`traceability-review`、`stats-integrity`、`domain-check`、`large-file`、`publication-figures`、`remote-compute`、`modal-run`。

当前一键科学 MCP 连接器包括：

- 文献检索：arXiv、PubMed、Crossref、Semantic Scholar、bioRxiv/medRxiv。
- 生物医学数据库：PubMed、ClinicalTrials.gov、MyVariant/ClinVar。
- Materials Project。
- FRED 经济数据。
- Space weather。
- Open-Meteo 天气与气候。
- USGS water data。

你也可以在 Settings 中添加任意本地或远程 MCP 服务器。参见
[`docs/CONNECT_YOUR_TOOLS.md`](./docs/CONNECT_YOUR_TOOLS.md)。

## 安装

从 [Releases 页面](https://github.com/ai4s-research/open-science/releases/latest) 下载最新安装包。

- **macOS**：`.dmg` / `.app`，Apple Silicon 和 Intel，要求 macOS 13 Ventura 或更高。
- **Windows**：NSIS `.exe` 和 `.msi`，Windows 10/11 x64。
- **Linux**：x86_64 Linux 的 `.deb` 和 `.rpm`。

当前构建尚未代码签名或 notarize。

**macOS**：如果 Gatekeeper 提示应用已损坏或来自未知开发者，把应用安装到 Applications 后运行：

```bash
xattr -cr "/Applications/Open Science.app"
```

**Windows**：如果出现 SmartScreen，选择 **更多信息 -> 仍要运行**。

**Linux**：

```bash
sudo apt install ./OpenScience_*.deb
# 或
sudo rpm -i OpenScience_*.rpm
```

## 从源码构建

前置依赖：

- Node.js >= 20
- pnpm 9
- Rust 工具链
- Tauri 在当前系统需要的 macOS、Windows 或 Linux 依赖

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

常用检查：

```bash
pnpm test
pnpm typecheck
pnpm lint
```

## 安全与隐私

- 工作区文件、原始数据、会话历史、溯源、笔记本和运行记录默认保留在本机。
- 命令执行、删除文件、安装依赖和远程连接在桌面应用中走人工批准流程。
- 提供方凭据写入应用私有运行时配置，不进入工作区、溯源、git、导出或用户全局 OpenCode 配置。
- Settings 中有大白话数据流说明，说明哪些内容可能发给所选模型提供方。

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| `apps/desktop/` | Tauri + React 桌面应用。 |
| `packages/sdk/` | `OpenCodeClient`，避免 UI 直接调用 OpenCode。 |
| `packages/shared/` | 共享领域类型和图表色板。 |
| `packages/ui/` | 共享 UI 包。 |
| `runtime/skills/core/` | 第一方科学技能。 |
| `runtime/skills/external/` | 构建时拉取的外部技能。 |
| `runtime/harness/` | 运行时 harness 知识与 operator 上下文。 |
| `runtime/mcp/` | MCP 运行时说明和配置。 |
| `examples/` | 内置示例工作区。 |
| `scripts/dev/` | sidecar、`uv`、技能拉取器和聚焦回归探针。 |
| `docs/` | 产品、技术、operator、连接器和研究笔记。 |

## 状态

当前应用版本：**v0.1.7**。

项目是正在积极开发的桌面 MVP。最可靠的当前实现日志是 [`PROGRESS.md`](./PROGRESS.md)。
产品和架构说明位于 [`docs/PRD.md`](./docs/PRD.md) 和
[`docs/TECHNICAL_DESIGN.md`](./docs/TECHNICAL_DESIGN.md)，但这些文档同时包含目标设计和历史状态说明。

近期工作集中在签名/notarize 发布、更广的 Windows/Linux 验证、自动更新、连接器加固，以及继续强化可复现性审查。

## 参与贡献

欢迎 Issue 和 PR。请保持改动最小且可验证，遵循 [`AGENTS.md`](./AGENTS.md)，并在提交 PR 前运行检查。讨论和交流可以加入
[Open Science Discord](https://discord.gg/fWNMDKcd5P)，也可以在 [linux.do](https://linux.do) 社区参与。

## 许可证

[MIT](./LICENSE)。随附的第三方技能和连接器保留各自许可证。

> Open Science 仍是 beta 阶段科研工具。产出应视为草稿：发表或决策前请核对数字、引用、代码和结论。
