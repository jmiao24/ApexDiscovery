# Official API and analysis reference

## Sources

- Python API: <https://chanzuckerberg.github.io/cellxgene-census/python-api.html>
- Quick start: <https://chanzuckerberg.github.io/cellxgene-census/cellxgene_census_docsite_quick_start.html>
- Data releases and compatibility: <https://chanzuckerberg.github.io/cellxgene-census/cellxgene_census_docsite_data_release_info.html>
- Census schema: <https://chanzuckerberg.github.io/cellxgene-census/cellxgene_census_docsite_schema.html>
- Dataset presence matrix: <https://chanzuckerberg.github.io/cellxgene-census/notebooks/api_demo/census_dataset_presence.html>
- Official repository: <https://github.com/chanzuckerberg/cellxgene-census>
- Public release directory used by `versions`: <https://census.cellxgene.cziscience.com/cellxgene-census/v1/release.json>

## Version policy

- `stable` opens the current long-term-supported build. As of this skill's validation, it resolves to `2025-11-08`, Census schema `2.4.0`, dataset schema `7.0.0`.
- Pin the dated build in reproducible work. The official release documentation says LTS builds remain available for at least five years.
- `latest` resolves to a weekly build retained for about one month. Use it only to discover newly added data, then record the resolved build.
- LTS `2025-11-08` is documented as compatible with Python package `cellxgene-census` 1.17.x. The helper intentionally requires `cellxgene-census>=1.17,<1.18`, `tiledbsoma>=1.15.3,<2`, and `numba>=0.60`. The latter two bounds prevent a contemporary resolver from selecting a future TileDB-SOMA major release or an obsolete Numba/LLVM chain.
- Record the alias requested, resolved build, Census schema, dataset schema, SDK version, and retrieval time.

Schema 2.4.0 changes that affect queries:

- `obs.disease` and `obs.disease_ontology_term_id` can contain multiple values separated by ` || `. Exact server-side equality can miss matches. The helper applies disease membership after a bounded coarse query.
- `var.feature_name` is not necessarily unique. Resolve and retain the unique Ensembl `feature_id`; an ambiguous symbol must stop for disambiguation.

## Supported surfaces

The official Python SDK provides:

- `open_soma(census_version=...)`: open a named build.
- `get_census_version_directory()` and `get_census_version_description()`: resolve builds.
- `get_obs()` / `get_var()`: query standardized cell/gene metadata.
- `get_anndata()`: materialize a bounded expression slice.
- `get_presence_matrix()`: determine whether a feature was measured in a source dataset.
- `get_source_h5ad_uri()` / `download_source_h5ad()`: locate or download a source dataset.

The helper queries TileDB-SOMA directly through the object returned by the official SDK so it can preflight cell counts before materializing expression.

## Metadata and provenance

Preserve these fields whenever available:

- Cell context: `organism`, `dataset_id`, `assay`, `cell_type`, `tissue`, `tissue_general`, `disease`, `donor_id`, `tissue_type`, `is_primary_data` and their ontology IDs.
- Gene: `feature_id`, `feature_name`, `feature_length`, `soma_joinid`.
- Dataset: `dataset_id`, `dataset_version_id`, `dataset_title`, `collection_id`, `collection_name`, DOI, citation, total cells.
- Build: requested and resolved Census version, Census schema, dataset schema, SDK version, retrieval time.

The standardized Census observation schema has `donor_id` but no universal sample ID spanning datasets. Report donor and dataset counts. If a sample count is scientifically necessary, inspect the source H5AD and publication-specific metadata; do not infer it from cells or tissues.

## Question-to-analysis routing

### Where is the target expressed?

Discover eligible datasets, resolve the Ensembl feature ID, confirm the gene is measured, then summarize the fraction of cells with raw count greater than zero in each dataset-donor-cell-context stratum. Report cell counts alongside fractions. Detection is not protein abundance.

### Does expression differ between disease and healthy tissue?

Use metadata discovery first. Require biological donors in both groups, compatible tissues and assays, and preferably the same dataset. Export a bounded slice and perform donor-aware pseudobulk or a validated mixed model. Do not compare pooled cells or helper detection fractions as a formal differential-expression test.

### Could expression constrain therapeutic window?

Screen healthy tissues and clinically relevant cell types, then inspect concordance across datasets and donors. Use the result only to identify potential off-tissue/off-cell concerns. Validate with protein localization, dose/exposure, target biology, and functional toxicity evidence.

### Which datasets deserve follow-up?

Prefer primary data with adequate donors, the relevant tissue and disease state, an appropriate assay, explicit feature measurement, balanced comparators, and traceable publication metadata. Flag single-donor, single-dataset, organoid-only, or assay-confounded evidence.

### What cell-state or co-expression hypotheses are suggested?

Select a coherent dataset and biological context first. Analyze within donor or with donor-aware models, then validate in an independent dataset. Do not calculate a single cell-level correlation after pooling donors and studies.

## Statistical guardrails

- Cells are observations, not independent biological replicates; donors are the usual unit of biological replication.
- A donor ID may be unique only within a dataset. Treat `(dataset_id, donor_id)` as the donor stratum.
- Raw and normalized values are not automatically comparable across assays or studies.
- Detection depends on sequencing depth, assay chemistry, ambient RNA, annotation quality, tissue handling, and cell abundance.
- Missing measurement is different from measured zero. Use feature-dataset presence before interpreting zero counts.
- `is_primary_data == True` prevents duplicate Census representations by default; it does not remove all biological or technical dependence.
- Disease labels can be compound and heterogeneous. Preserve the full label and ontology terms.
- “Normal” or “healthy” metadata does not guarantee a matched control.
- CELLxGENE coverage is curated but not population-representative.

## Helper outputs and limits

- `versions` needs only network access and Python's standard library.
- `datasets`, `expression-summary`, and `export-slice` require Python 3.10-3.12 plus official `cellxgene-census` 1.17.x and its dependencies. Version 1.17.0 does not publish a wheel for Python 3.13+; use a compatible isolated scientific environment rather than changing project dependencies implicitly.
- Default query limit is 100,000 cells; the hard ceiling is 250,000 for metadata/expression and 100,000 for export.
- The helper rejects an oversized coarse query before reading expression. Add dataset, tissue, cell-type, or assay filters; it never takes the first N cells.
- Disease filters are post-query membership tests because schema 2.4.0 allows multi-valued disease strings. Therefore pair disease with a bounded coarse filter.
- Export keeps only datasets in which every requested feature is marked present and writes provenance into `.uns` plus a JSON sidecar.
