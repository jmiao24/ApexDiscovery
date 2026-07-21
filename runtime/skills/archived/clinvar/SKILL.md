---
name: clinvar
description: Query and interpret NCBI ClinVar records through official E-utilities for human variant, gene, and condition lookups; aggregate germline, somatic clinical-impact, and oncogenicity classifications; review status and stars; conflicting assertions; VCV/RCV/SCV provenance; allele and HGVS identifiers; phenotype associations; citations; and version comparisons. Use for ClinVar variant interpretation, submission provenance, conflicting classification review, or historical record comparison. Do not use as a substitute for diagnosis, clinical advice, or independent evidence review.
---

# ClinVar

Use NCBI ClinVar as a submitted-assertion archive, not as an independent clinical verdict. Preserve the distinction between:

- **VCV**: submissions aggregated by variant.
- **RCV**: submissions aggregated by variant–condition pair.
- **SCV**: one submitter's assertion and supporting information.

Read [references/clinvar-access.md](references/clinvar-access.md) when constructing advanced Entrez queries, interpreting review stars, selecting bulk files, or explaining ClinVar's data model.

## Quick start

Use the dependency-free helper. Identify requests with a valid contact email as required by NCBI guidance:

```bash
export NCBI_EMAIL="you@example.org"
python3 <skill-directory>/scripts/clinvar.py search --variant 'rs113993960' --limit 5
python3 <skill-directory>/scripts/clinvar.py search --gene BRCA1 --limit 10
python3 <skill-directory>/scripts/clinvar.py search --condition 'cystic fibrosis' --limit 10
python3 <skill-directory>/scripts/clinvar.py record VCV000007105 --submissions 10 --citations 20
python3 <skill-directory>/scripts/clinvar.py compare VCV000007105.206 VCV000007105.207
```

Set `NCBI_API_KEY` only when available. The helper stays below three requests per second without a key and returns normalized JSON to stdout.

## Workflow

1. **Normalize the question.** Capture the variant expression and assembly/transcript when provided, the gene, condition, classification context (germline, somatic clinical impact, or oncogenicity), and whether provenance or history is needed.
2. **Resolve ambiguity.** Search first when given an rsID, HGVS expression, gene, condition, genomic coordinate, or free text. Do not assume similarly named records represent the same allele.
3. **Inspect candidates.** Compare VCV accession, HGVS, canonical SPDI, genes, GRCh37/GRCh38 locations, and allele cross-references. Ask for clarification when multiple plausible alleles remain.
4. **Fetch the VCV record.** Use `record` for aggregate classifications, associated RCV conditions, citations, and recent SCV submissions.
5. **Interpret in layers.** Report aggregate classification and review status first, then condition-specific RCV context, then material SCV disagreements and dates.
6. **Check currency.** Report the VCV version and `date_last_updated`. Use `compare` for explicit historical-version questions; never infer a change from date alone.
7. **Cite provenance.** Link the VCV page and identify relevant RCV/SCV accessions, submitters, last-evaluated dates, and PubMed/other citations.

## Question patterns

Use the helper to answer questions such as:

- "What does ClinVar say about `NM_000492.4:c.1521_1523del` or `rs113993960`?"
- "Which ClinVar variants are reported for BRCA1?"
- "Find variants associated with hypertrophic cardiomyopathy."
- "Is this classification conflicting, and which submitters disagree?"
- "What is the review status and how many stars does it represent?"
- "Which conditions and RCV records are linked to this VCV?"
- "What are the Allele ID, Variation ID, rsID, HGVS, and SPDI identifiers?"
- "Which SCVs, submitters, evaluation dates, methods, and citations support it?"
- "What changed between two VCV versions?"

For a gene or condition with many matches, summarize counts and representative high-review records. Do not imply that absence from the first page means absence from ClinVar.

## Interpretation rules

- Treat `review_status` and `stars` as review/transparency metadata, not a probability of pathogenicity.
- Preserve all classification contexts. Germline, somatic clinical impact, and oncogenicity are not interchangeable.
- Treat `criteria provided, conflicting classifications` as a conflict even though it maps to one star.
- Compare classifications within the same variant, condition, inheritance/context, and time frame before describing disagreement.
- Distinguish `Pathogenic`, `Likely pathogenic`, `Uncertain significance`, risk-factor, drug-response, protective, and somatic tier terms. Do not force them into a binary result.
- Attribute assertions to submitters. ClinVar aggregates voluntarily submitted information; NCBI does not independently verify each assertion.
- State the transcript and genome assembly for HGVS or coordinates. Flag transcript or assembly mismatches.
- Do not infer causal disease association merely because a variant and condition share an RCV record.

## Output contract

For a single-variant answer, include:

1. Exact variant identity and matched VCV accession/version.
2. Aggregate classification(s), review status, stars, and last-evaluated/updated dates.
3. Condition-specific RCV associations relevant to the question.
4. Conflicts or important SCV differences, with submitter and date.
5. Supporting identifiers and citations.
6. Direct ClinVar link and retrieval date.
7. A concise limitation statement.

When no record is found, report the exact query and suggest alternate transcript versions, rsID/SPDI, assembly, gene plus coding change, or ClinVar accession. Do not convert a missing result into evidence of benignity.

## Scale and access

Use E-utilities for focused lookups and modest result sets. Use ClinVar's official weekly XML/VCF/TSV downloads for systematic extraction, cohort annotation, or full-database analysis. Do not loop through thousands of records one request at a time.

## Safety

ClinVar information is not intended for direct diagnostic use or medical decision-making without review by a qualified genetics professional. Never recommend testing, treatment, reproductive action, or health-behavior changes solely from a ClinVar record. For high-stakes use, require independent review of the underlying evidence, current professional guidance, phenotype fit, inheritance, zygosity, ancestry, assay quality, and laboratory confirmation.
