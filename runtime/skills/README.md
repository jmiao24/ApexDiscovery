# runtime/skills

Scientific skills, layered:

```text
skills/
  core/      # self-authored AI4S Workbench skills (in this repo)
  external/  # curated third-party skills, e.g. K-Dense scientific-agent-skills
  user/      # user-installed / custom skills
```

Only `core/` is version-controlled here. `external/` and `user/` are installed at
runtime into the profile / workspace.

## Core skills (v0.1)

| Skill | Purpose |
| --- | --- |
| `reproducible-research` | Standardize project structure, artifacts, logs, reproducibility |
| `literature-review` | Literature search, filtering, summarization |
| `bibliometric-analysis` | Year trends, keywords, journal distribution, clustering |
| `figure-provenance` | Every figure must trace to code and data |
| `citation-reviewer` | Check citation format and sources |
| `paper-to-report` | Generate a Markdown report |

## Third-party skills

Do **not** enable all ~148 K-Dense skills by default. Use curated install, enable by
domain, and always surface each skill's license, dependencies, and risk.

Each skill directory should contain a `SKILL.md`.
