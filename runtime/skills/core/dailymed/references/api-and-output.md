# DailyMed API and normalized output

## Contents

- Official API surface
- Search filters
- Helper output
- SPL section mapping
- Interpretation limits

## Official API surface

Base URI: `https://dailymed.nlm.nih.gov/dailymed/services/v2/`

The REST API is read-only (`GET`) and returns JSON or XML depending on the resource extension. The official documentation does not specify API-key authentication.

| Resource | Purpose |
| --- | --- |
| `spls.json` | Search and page through SPL labels |
| `spls/{SETID}.xml` | Retrieve the current full SPL XML document |
| `spls/{SETID}/history.json` | Retrieve version dates and version numbers |
| `spls/{SETID}/ndcs.json` | Retrieve current NDCs |
| `spls/{SETID}/packaging.json` | Retrieve products, active ingredients, strengths, and packaging |
| `spls/{SETID}/media.json` | Retrieve label media links |
| `applicationnumbers.json` | List application numbers |
| `drugclasses.json` | List pharmacologic classes |
| `drugnames.json` | List drug names |
| `ndcs.json` | List NDCs |
| `rxcuis.json` | List product-level RxCUIs |
| `uniis.json` | List UNIIs |

Current ZIP and PDF downloads:

- `https://dailymed.nlm.nih.gov/dailymed/downloadzipfile.cfm?setId={SETID}`
- `https://dailymed.nlm.nih.gov/dailymed/downloadpdffile.cfm?setId={SETID}`

Historical ZIP download:

- `https://dailymed.nlm.nih.gov/dailymed/getFile.cfm?type=zip&setid={SETID}&version={VERSION}`

Official documentation: `https://dailymed.nlm.nih.gov/dailymed/app-support-web-services.cfm`

## Search filters

The helper exposes these `/spls` filters:

- `drug_name` with `name_type` of `brand`, `generic`, or `both`;
- `application_number`;
- `ndc`;
- `rxcui`;
- `unii_code`;
- `setid`;
- `labeler`;
- `boxed_warning`.

DailyMed also supports additional filters such as document type, pharmacologic class, marketing category, manufacturer, and published-date comparisons. Extend the helper only when a user workflow requires them.

## Helper output

`search` returns:

- `query`: submitted filters;
- `results`: title, `SETID`, SPL version, published date, and official links;
- `result_count` and bounded paging metadata;
- `provenance`: API URL, DailyMed database publication date, and retrieval time.

`profile` returns:

- `schema_version`;
- `label`: title, `SETID`, document ID, label type, SPL version, effective time, labeler, and application numbers;
- `products`: current product names, generic names, product codes, active ingredients, strengths, and packaging when available;
- `ndcs`: current NDC list when available;
- `sections`: selected section text with LOINC code, official section name, title, character count, and truncation state;
- `available_sections`: the coded sections present in the SPL;
- `history`: version dates and version numbers;
- `links`: DailyMed page plus XML, PDF, and ZIP links;
- `warnings` and `provenance`.

Historical profiles omit current packaging and NDC metadata because those endpoints describe the current SPL, not the archived version.

## SPL section mapping

| Alias | LOINC code |
| --- | --- |
| `recent_changes` | `43683-2` |
| `boxed_warning` | `34066-1` |
| `indications` | `34067-9` |
| `dosage` | `34068-7` |
| `dosage_forms` | `43678-2` |
| `contraindications` | `34070-3` |
| `warnings` | `43685-7` |
| `adverse_reactions` | `34084-4` |
| `drug_interactions` | `34073-7` |
| `specific_populations` | `43684-0` |
| `description` | `34089-3` |
| `clinical_pharmacology` | `34090-1` |
| `nonclinical_toxicology` | `43680-8` |
| `clinical_studies` | `34092-7` |
| `how_supplied` | `34069-5` |
| `patient_counseling` | `34076-0` |

The XML may contain nested or repeated sections. The helper combines repeated sections with the same requested LOINC code and preserves their titles.

## Interpretation limits

- DailyMed describes current “in-use” company-submitted labeling; it is not a substitute for approval letters, FDA review documents, or the complete regulatory history in Drugs@FDA.
- The API can return multiple labels for the same ingredient or name. A `SETID` identifies a label series, not a universally interchangeable product.
- Label dates, labeler identity, application numbers, NDCs, and packaging can change. Preserve provenance.
- Section text can be long and contain tables. The helper normalizes XML to plain text and may truncate it; use the official XML/PDF when exact formatting matters.
