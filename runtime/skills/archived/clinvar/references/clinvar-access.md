# ClinVar official access and interpretation reference

## Official sources

- ClinVar access and API overview: <https://www.ncbi.nlm.nih.gov/clinvar/docs/access/>
- Programmatic access examples: <https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/>
- Search fields and syntax: <https://www.ncbi.nlm.nih.gov/clinvar/docs/help/>
- Data model (VCV, RCV, SCV): <https://www.ncbi.nlm.nih.gov/clinvar/docs/data_model/>
- Identifier model: <https://www.ncbi.nlm.nih.gov/clinvar/docs/identifiers/>
- Review status and stars: <https://www.ncbi.nlm.nih.gov/clinvar/docs/review_status/>
- Downloads and update schedule: <https://www.ncbi.nlm.nih.gov/clinvar/docs/downloads/>
- E-utilities usage policy: <https://www.ncbi.nlm.nih.gov/books/NBK25497/>

Use only these public retrieval interfaces for this skill. The ClinVar Submission API is an authenticated write interface and is out of scope.

## Data model

| Level | Accession | Meaning | Best use |
|---|---|---|---|
| Variant aggregate | VCV | All public submissions aggregated by variant | Variant identity and overall classification contexts |
| Variant–condition aggregate | RCV | Submissions aggregated by variant and condition | Phenotype-specific interpretation |
| Submitted record | SCV | One submitter's assertion | Provenance, methods, evidence, and disagreement |

One VCV may have many RCVs and SCVs. Do not describe an aggregate VCV classification as applying uniformly to every condition.

## E-utilities

Base URL:

```text
https://eutils.ncbi.nlm.nih.gov/entrez/eutils/
```

Supported ClinVar functions include `esearch`, `esummary`, `elink`, and `efetch`.

### Search

```text
esearch.fcgi?db=clinvar&term=BRCA1[gene]&retmode=json&retmax=20
esearch.fcgi?db=clinvar&term="cystic fibrosis"[disease]&retmode=json&retmax=20
esearch.fcgi?db=clinvar&term=rs113993960&retmode=json&retmax=20
```

Useful fielded patterns:

- Gene: `BRCA1[gene]`
- Condition: `"cystic fibrosis"[disease]`
- Submitter: `"ClinGen"[submitter]`
- Clinical significance: `pathogenic[clinsig]`
- Review status: `"reviewed by expert panel"[review status]`
- Chromosome location: `17[chr] AND 43000000:44000000[chrpos37]`
- Single-gene records: `BRCA1[gene] AND single_gene[prop]`

Test advanced queries in the ClinVar web search before automating them. Search results are Entrez UIDs, which correspond to Variation IDs for ClinVar.

### Summary

```text
esummary.fcgi?db=clinvar&id=7105&retmode=json&version=2.0
```

ESummary is appropriate for candidate screening: VCV accession, title, genes, locations, aggregate classifications, traits, and supporting RCV/SCV accessions.

### Full VCV retrieval

```text
efetch.fcgi?db=clinvar&rettype=vcv&id=VCV000007105
efetch.fcgi?db=clinvar&rettype=vcv&id=VCV000007105.207
```

An unversioned accession returns the latest version. A versioned accession retrieves that specified historical version when available. For numeric Variation IDs, NCBI also documents `rettype=vcv&is_variationid&id=14206`.

### RCV retrieval

```text
efetch.fcgi?db=clinvar&rettype=clinvarset&id=RCV000000606
efetch.fcgi?db=clinvar&rettype=clinvarset&id=RCV000000606.3
```

Use RCV XML when the question turns on one particular variant–condition pair and the VCV summary is insufficient.

### Related PubMed or MedGen records

```text
elink.fcgi?dbfrom=clinvar&db=pubmed&id=7105
elink.fcgi?dbfrom=clinvar&db=medgen&id=7105
```

Prefer citations embedded in the VCV/SCV record for assertion provenance. Use ELink to discover additional NCBI-linked records, not as proof that a paper supports a specific classification.

## Review status to star mapping

For aggregate germline classification and oncogenicity:

| Review status | Stars |
|---|---:|
| practice guideline | 4 |
| reviewed by expert panel | 3 |
| criteria provided, multiple submitters, no conflicts | 2 |
| criteria provided, conflicting classifications | 1 |
| criteria provided, single submitter | 1 |
| no assertion criteria provided | 0 |
| no classification provided | 0 |
| no classification for the individual variant | 0 |

For aggregate somatic clinical impact, `criteria provided, multiple submitters` is two stars; consensus is intentionally not used in the same way. Report the text review status alongside the computed star count because several statuses share a count.

Stars report review/transparency level. They are not a strength-of-effect score and do not by themselves validate a classification.

## Conflict analysis

1. Confirm that records refer to the same allele, transcript/assembly representation, and condition context.
2. Separate germline classification, oncogenicity, and somatic clinical impact.
3. Read the aggregate review status and enumerated description.
4. Inspect contributing SCVs: submitter, classification, last-evaluated date, review status, assertion method, and citations.
5. Give expert-panel or practice-guideline assertions appropriate prominence, but do not hide newer or materially different submissions.
6. Describe the conflict; do not vote or invent a consensus.

## Version and change questions

- Report both accession and version, for example `VCV000007105.207`.
- Use `DateLastUpdated`, `MostRecentSubmission`, and classification evaluation dates as separate concepts.
- Compare two explicit versions to claim what changed.
- Weekly current releases are not a permanent weekly archive. ClinVar archives comprehensive releases monthly; use official archived XML for reproducible historical bulk analysis.

## Bulk selection

| Need | Official source |
|---|---|
| Complete record content | Weekly VCV or RCV XML |
| Precisely located variants with summary fields | GRCh37/GRCh38 VCF |
| Summary tables, citations, conflicts, submissions | ClinVar TSV files |
| Reproducible historical full release | Monthly archived XML release |

Use <https://ftp.ncbi.nlm.nih.gov/pub/clinvar/>. Record the release date, assembly, file name, and checksum in reproducible work.

## Request policy

Include `tool` and a valid developer contact `email` on E-utilities requests. Without an API key, do not exceed three requests per second. With an NCBI API key, the default supported ceiling is ten requests per second. Batch IDs and use Entrez history or bulk downloads for large jobs.

## Safety language

ClinVar states that its information is not intended for direct diagnostic use or medical decision-making without review by a genetics professional, and that NIH does not independently verify submitted information. Repeat this limitation when an answer could influence care. A ClinVar classification must be interpreted with phenotype, inheritance, zygosity, ancestry, assay quality, current guidelines, and primary evidence.
