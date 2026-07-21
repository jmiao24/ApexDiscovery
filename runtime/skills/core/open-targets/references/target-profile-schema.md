# Target Profile Schema

`scripts/target_profile.py` stores and queries a normalized, versioned Open Targets profile without placing the full dataset in the agent context. `scripts/get_target_profile.py` remains the low-level importable fetcher.

## Invocation

```bash
python3 <skill-directory>/scripts/target_profile.py fetch --target MC4R
python3 <skill-directory>/scripts/target_profile.py summary --profile .apex/profiles/open-targets/MC4R/26.06
python3 <skill-directory>/scripts/target_profile.py query --profile .apex/profiles/open-targets/MC4R/26.06 --section expression --source gtex --sort median --descending --limit 20
```

All commands write only bounded JSON to stdout. Progress and errors go to stderr. `fetch` saves the complete profile beneath `--store` (default `.apex/profiles/open-targets`) and returns only its paths, row counts, and warnings.

## Stored profile directory

Each target/release directory contains `manifest.json`, `summary.json`, `sources.json`, and one file per requested section. Large sections (`expression`, flattened `depmap`, and `mouse_phenotypes`) use JSONL; smaller sections use JSON. The manifest records each file's format, row count, and SHA-256 checksum.

Rows store only `source_id`; `sources.json` stores source metadata once. `query` re-expands the complete `source` object in returned results. Query output defaults to 20 rows and is hard-capped at 100.

## Top-level fields

- `schema_version`: Version of this normalized output contract.
- `target`: Ensembl ID, approved symbol/name, biotype, and source.
- `expression`: Normalized baseline expression rows, sorted by datasource, tissue, and cell type.
- `expression_total_count`: Total rows reported by Open Targets before any local row cap.
- `tractability`: Open Targets modality tractability assessments.
- `safety_liabilities`: Reported safety events, sources, biosamples, effects, studies, and URLs.
- `essentiality`: Open Targets essentiality flag, population genetic constraints, and DepMap screens.
- `subcellular_locations`: Reported locations and their sources.
- `mouse_phenotypes`: Mouse phenotype records for the target orthologue.
- `sources`: Deduplicated source catalog with the number of returned records attributed to each source.
- `warnings`: Interpretation limits and truncation notices that must stay with derived results.
- `provenance`: API endpoint, target page, data release, retrieval time, input, and selected sections.

Fields for unrequested sections are omitted. Empty arrays mean Open Targets returned no records for that section; they do not prove absence of the underlying biological property.

## Per-result source

Every returned result record includes a `source` object:

- `id`: Upstream source identifier exactly as returned or assigned by the normalizer, such as `gtex`, `DICE`, `PRIDE`, `ClinPGx`, `uniprot`, `gnomad`, `depmap`, or `impc`.
- `name`: Human-readable source name, such as `GTEx` or `Human Protein Atlas`.
- `url`: Source homepage when known; otherwise null. Record-specific safety URLs remain in the result's existing `url` field.
- `accessed_via`: `Open Targets Platform`, because this helper retrieves the upstream annotation through Open Targets.

The target identity also carries its Ensembl source. The essentiality container carries the source for the integrated Open Targets flag, while every genetic-constraint, DepMap tissue, and DepMap screen record has its own source. Unknown future datasource IDs are preserved rather than replaced with a generic label.

## Expression row fields

Each row contains `datasource`, a normalized `source`, `datatype`, `tissue`, `cell_type`, `unit`, the five-number distribution (`min`, `q1`, `median`, `q3`, `max`), specificity/distribution scores, and quality-control labels. Null values are preserved.

RNA or baseline expression does not establish cell-surface protein abundance, accessibility, internalization, or therapeutic index. Validate those separately with protein-level and experimental evidence.

## Stability and provenance

Consumers should key integrations to `schema_version`, not the upstream GraphQL response shape. Preserve `warnings` and `provenance` whenever profile data is summarized, ranked, or exported. Open Targets can change its live GraphQL schema; a GraphQL error should fail the command instead of silently dropping a section.
