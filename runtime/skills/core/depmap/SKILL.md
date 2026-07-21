---
name: depmap
description: Evaluate cancer targets with Broad DepMap CRISPR/RNAi dependency, cell-line context, omics biomarkers, co-dependencies, and PRISM compound-sensitivity evidence. Use for oncology target validation, dependency selectivity and lineage/subtype questions, model selection, target comparison, biomarker hypotheses, artifact checks, cross-release robustness, or interpreting pinned DepMap release files and focused Portal/API results. Do not use as proof of clinical efficacy, normal-tissue safety, or causal human disease biology.
---

# DepMap

Use DepMap as a **cancer-model functional evidence layer**. Answer the decision, not merely the lookup, while keeping model and release provenance attached to every result.

## Route the question

Map the CSO question to evidence before querying:

| Decision question | Primary evidence | Required checks |
|---|---|---|
| Is the target a strong, selective dependency? | CRISPR Chronos gene effect across models | Distribution, missingness, pan-essential status, lineage composition |
| Where is the dependency concentrated? | Model metadata, lineage/subtype, CRISPR | Group sample sizes, within-group spread, outliers |
| What predicts dependency? | Mutation, expression, copy number, fusions/subtypes | Pre-specified hypotheses or multiple-testing correction; confounding/artifacts |
| What mechanism or pathway is implicated? | Co-dependencies plus omics | Correlation stability, shared lineage, biological coherence |
| Which models should be tested? | Dependency plus biomarker and model metadata | Independent models, availability, genotype/context diversity |
| Is there pharmacologic support? | PRISM secondary dose-response/AUC where available | Compound identity, target specificity, dose-response, screen coverage |
| Which target is stronger? | Matched models, same release and method | Pairwise-complete comparison, breadth/selectivity, lineage context |
| Is the finding robust? | Pinned releases and orthogonal methods | Release drift, CRISPR vs RNAi, sample overlap, pipeline changes |

For exact file roles, identifiers, official endpoints, and interpretation constraints, read [references/data-and-api.md](references/data-and-api.md). For statistical and reporting requirements, read [references/decision-framework.md](references/decision-framework.md).

## Choose access mode

1. Prefer a **pinned DepMap Public release download** for reproducible analysis, target comparison, biomarker scans, and anything requiring many models.
2. Use the experimental Portal REST API only for focused discovery or metadata inspection. Do not build a production workflow that assumes its schema is stable.
3. Do not scrape Portal pages. Use the official download catalog or Portal downloads.
4. Record the release label exactly, file names, access date, assay, scoring method, and any filtering.

Use the dependency-free helper for bounded local analysis:

```bash
python3 <skill-directory>/scripts/depmap.py target-profile \
  --gene KRAS \
  --gene-effect CRISPRGeneEffect.csv \
  --models Model.csv \
  --release "DepMap Public 26Q1" \
  --top 12

python3 <skill-directory>/scripts/depmap.py compare-targets \
  --genes KRAS NRAS BRAF \
  --gene-effect CRISPRGeneEffect.csv \
  --models Model.csv \
  --release "DepMap Public 26Q1"
```

The helper supports `.csv`, `.tsv`, and gzip-compressed equivalents; it deliberately avoids choosing a dependency cutoff. If the user supplies `--cutoff`, report it as a user-defined sensitivity analysis, never as a universal biological boundary.

## Execute a target assessment

1. **Resolve identity.** Preserve gene symbol and Entrez/other identifier embedded in the release column. Reject ambiguous symbol matches.
2. **Define the cohort.** State all models or a pre-specified lineage/subtype; preserve `ModelID` (`ACH-...`) and other hierarchy IDs when present. Report exclusions.
3. **Quantify dependency.** Report `n`, missingness, median, interquartile range, range, and ranked models. Lower Chronos gene-effect values indicate stronger dependency, but do not convert scores into claims of efficacy.
4. **Assess breadth versus selectivity.** Show group-level distributions with sample counts. Do not rank small lineages as stable; default to at least five evaluable models and state the choice.
5. **Check confounding.** Inspect pan-essential/common-essential annotations, copy number, expression, screen quality/confounder files, and lineage imbalance. Treat amplified-locus and low-expression patterns cautiously.
6. **Test biomarkers.** Prefer mechanism-led features. For discovery scans, control false discovery rate, report tested feature count and effect sizes with uncertainty, and validate in held-out models or another release.
7. **Seek orthogonal evidence.** Compare another release, RNAi DEMETER2 where scientifically appropriate, co-dependency/pathway coherence, and PRISM only when a relevant and sufficiently selective compound exists.
8. **Recommend experiments.** Select multiple sensitive and insensitive models matched on major confounders; include model IDs, lineage/subtype, proposed biomarker, and rationale.

## Compare targets

Use the same release, method, model intersection, and metadata definitions. Report:

- matched and missing model counts;
- each target's distribution and strongest contexts;
- pairwise correlation and overlap among the most sensitive models;
- whether apparent selectivity is driven by unequal coverage or lineage mix;
- pan-essentiality and tractability/safety evidence as separate axes, not folded into a single opaque score.

Do not declare a winner from the lowest single cell-line value.

## Report for a CSO

Lead with a calibrated decision statement: `advance`, `investigate`, `deprioritize`, or `insufficient evidence`, with the decision criteria named. Then provide:

1. **Decision summary** — strength, selectivity, disease context, and major uncertainty.
2. **Evidence table** — release, assay/method, model population, `n`, effect summaries, top contexts.
3. **Biomarker/mechanism hypotheses** — effect size, uncertainty, correction/validation status.
4. **Model shortlist** — sensitive and control models with `ACH-...` IDs.
5. **Artifact and translation risks** — pan-essentiality, copy-number/expression artifacts, lineage size, screen coverage, off-target pharmacology.
6. **Next experiment** — smallest study that would change the decision.
7. **Provenance** — exact release/files, retrieval date, filters, code/command, official links.

Explicitly label inference. Never imply that cell-line dependency establishes patient efficacy, normal-tissue safety, causal human disease evidence, or a therapeutic window.

## Fail safely

- Stop on an ambiguous gene column, release mismatch, or incompatible model identifiers.
- Report missing values; never silently impute dependency scores.
- Avoid arbitrary cutoffs, uncorrected biomarker fishing, and conclusions from tiny lineages.
- Distinguish CRISPR Chronos, RNAi DEMETER2, and PRISM metrics; never merge them as though they shared a scale.
- Flag Portal API results as experimental and point systematic work to pinned downloads.
