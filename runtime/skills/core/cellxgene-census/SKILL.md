---
name: cellxgene-census
description: Query version-pinned CZ CELLxGENE Discover Census single-cell RNA data for decision-grade target-expression evidence. Use for target expression across tissues, diseases, cell types, donors, assays, and source datasets; disease-versus-healthy dataset discovery; target-positive cell fractions; potential off-tissue or off-cell expression constraints; selecting datasets for follow-up; exporting bounded AnnData slices; and generating cell-state or co-expression hypotheses. Do not use it alone to claim causal target validation, efficacy, safety, differential expression, or patient prevalence.
---

# CELLxGENE Census

Use the official versioned Census as an observational expression evidence layer. Frame outputs for scientific decisions, not as generic cell browsing.

## Run the workflow

1. Define the decision: target localization, disease context, potential therapeutic-window constraint, or follow-up dataset selection.
2. Pin a Census build. Prefer the dated LTS `2025-11-08`; resolve `stable` to its dated build and report both. Use `latest` only for reconnaissance because weekly builds are short-lived.
3. Resolve every gene to a unique Ensembl `feature_id`. Never assume `feature_name` is unique.
4. Discover matching datasets and metadata before reading expression. Default to `is_primary_data == True`.
5. Bound the query by organism and at least one of dataset, tissue, cell type, or assay. Reject queries above the helper's cell limit rather than sampling silently.
6. Summarize detection within dataset-donor strata. Compare strata or donor-level summaries; do not pool raw cells across donors or datasets as independent replicates.
7. Preserve Census build/schema, package version, organism, feature ID, filters, dataset/version IDs, assay, tissue, disease, cell type, donor count, cell count, and citations.
8. State what the data support, what they merely suggest, and which experiment or analysis should follow.

Read [references/api-and-analysis.md](references/api-and-analysis.md) before writing a new query, interpreting a comparison, or exporting data.

## Use the deterministic helper

The helper requires Python 3.10-3.12 and the official SDK compatible with the current LTS. Do not change project dependencies implicitly. Use an isolated environment and constrain TileDB-SOMA below its next major version; an unconstrained 2026 resolver can otherwise select an incompatible dependency chain:

```bash
python -m pip install \
  'cellxgene-census>=1.17,<1.18' \
  'tiledbsoma>=1.15.3,<2' \
  'numba>=0.60'
python <skill-directory>/scripts/cellxgene_census.py versions
```

Discover disease-relevant datasets:

```bash
python <skill-directory>/scripts/cellxgene_census.py datasets \
  --census-version 2025-11-08 --organism 'Homo sapiens' \
  --tissue lung --cell-type 'epithelial cell' --disease 'lung adenocarcinoma'
```

Summarize a target after resolving its Ensembl ID:

```bash
python <skill-directory>/scripts/cellxgene_census.py expression-summary \
  --census-version 2025-11-08 --organism 'Homo sapiens' \
  --feature-id ENSG00000146648 --tissue lung --max-cells 100000
```

Export a bounded, reproducible slice only when follow-up analysis is warranted:

```bash
python <skill-directory>/scripts/cellxgene_census.py export-slice \
  --census-version 2025-11-08 --organism 'Homo sapiens' \
  --feature-id ENSG00000146648 --feature-id ENSG00000141736 \
  --dataset-id DATASET_UUID --output target-slice.h5ad
```

The helper emits JSON to stdout and errors to stderr. It never silently truncates, samples, or substitutes a gene.

## Interpret conservatively

- Treat zero counts as non-detection only after confirming the feature was measured in that dataset.
- Treat detection fraction as assay- and sampling-dependent, not as patient prevalence or protein abundance.
- Do not call differential expression without a donor-aware design, adequate biological replication, and explicit covariate handling.
- Treat off-tissue expression as a hypothesis about therapeutic-window risk, not proof of toxicity.
- Treat co-expression and cell-state patterns as hypotheses requiring within-dataset, donor-aware validation.
- Distinguish healthy, disease, adjacent, organoid, and assay contexts; do not merge them casually.
- State that standardized Census metadata has donor IDs but no universal biological sample ID; never invent sample counts.
- Escalate clinical or safety conclusions to qualified experts and orthogonal protein, functional, and in vivo evidence.

## Report the answer

Lead with the decision-relevant result, then provide:

1. Evidence scope and exact Census build.
2. Target feature ID and contexts examined.
3. Dataset and donor coverage, with detection summarized by dataset-donor strata.
4. Concordant and discordant contexts.
5. Key limitations and confounders.
6. Recommended follow-up datasets or experiments.
7. Traceable dataset IDs, version IDs, citations, and Discover links.
