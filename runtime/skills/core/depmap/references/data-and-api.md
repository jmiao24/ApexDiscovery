# DepMap data and access reference

## Official access points

- Portal API and Swagger: `https://depmap.org/portal/api/` and `https://depmap.org/portal/api/swagger.json`. The API describes itself as experimental and subject to change without notice.
- Download catalog: `https://depmap.org/portal/api/download/files`. It returns a catalog of Portal files and download URLs when accessible. Retrieve it immediately before downloading because some signed URLs expire.
- Data/download page: `https://depmap.org/portal/data_page/`.
- Resource hub and release notes: `https://depmap.org/portal/resources`.

The Portal may present browser verification to automated clients. Do not bypass it or scrape pages. Use an interactive browser or the official downloads when verification prevents API access.

## Reproducibility strategy

For any decision-grade result:

1. Pin the displayed release, such as `DepMap Public 26Q1`; do not use the word `latest` in the final provenance.
2. Record the exact file name, checksum if maintained locally, access date, and citation shown by the Portal.
3. Keep the Model metadata file from the same release.
4. Read the release notes for pipeline or model-set changes before cross-release comparison.
5. Re-fetch the download catalog only to resolve URLs; do not treat it as a stable snapshot.

Portal documentation currently describes the release program as twice yearly. Do not promise a quarterly cadence merely because a release label contains `Q1`, `Q2`, and so on.

## Core evidence layers

| Layer | Typical file/dataset | Interpretation |
|---|---|---|
| CRISPR dependency | CRISPR gene-effect, Chronos | Lower score generally means a stronger knockout effect within that dataset |
| RNAi dependency | Combined RNAi, DEMETER2 | Orthogonal perturbation with a different method and score scale |
| Model annotation | `Model.csv` | `ModelID`, lineage, subtype, source and other model context |
| Expression | release expression matrix | Baseline abundance; useful for mechanism and low-expression artifact checks |
| Copy number | release CN matrix | Amplification/deletion context and CRISPR copy-number artifact assessment |
| Mutation/fusion | damaging/hotspot/fusion tables | Candidate predictive genomic features |
| Subtypes | inferred subtype metadata/matrix | Disease-context stratification |
| Confounders | release CRISPR confounder files | Screen and genomic features that may distort dependency inference |
| PRISM | secondary AUC/viability or primary screen | Pharmacologic sensitivity; compound specificity and coverage remain separate questions |

File names and schemas evolve. Inspect the file description supplied for the pinned release rather than assuming an old name is still current.

## Identifier hierarchy

- `ModelID` (`ACH-xxxxxx`): basal biological model; use this as the main join for collapsed CRISPR and model-level outputs.
- `ModelConditionID` (`MC-xxxxxx-yyyy`): a model under a particular growth or treatment condition.
- `ScreenID` (`SC-...`): an individual CRISPR screen. Use mapping files to connect screens to model/model-condition IDs.
- `OmicsProfileID` and `SequencingID` (`CDS-...`): sequencing output hierarchy. Use the release's default-entry flags when a single representative profile is needed.

Never join on a display cell-line name if a release ID is available. Preserve all contributing IDs when collapsing or selecting records.

## Wide matrix assumptions used by `scripts/depmap.py`

- Rows are models, keyed by the first column or a column matching `ModelID`, `DepMap_ID`, `DepMapID`, `ACH`, or `ID`.
- Gene columns may be `KRAS` or `KRAS (3845)`. A symbol must resolve to exactly one column.
- `Model.csv` may use schema variants. The helper searches common ID, name, lineage, subtype, and disease columns and reports which it selected.
- Blank, `NA`, `NaN`, `null`, and non-numeric score cells are treated as missing.

If a file is Parquet, convert it to CSV/TSV with an existing trusted environment or analyze it directly with a pinned library. The bundled helper intentionally adds no project dependency.

## Source expectations

Use only official DepMap Portal/API/download/release documentation when describing DepMap data. If a collaborator dataset appears in the Portal, preserve its own citation, assay, maintenance status, and license; do not represent it as a continuously updated DepMap release dataset.
