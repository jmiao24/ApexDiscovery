---
name: dailymed
description: Query and interpret the official DailyMed REST API v2 for current and historical U.S. Structured Product Labeling (SPL). Use when users ask about a drug or biologic's current indications, dosage, dosage forms, boxed warning, contraindications, warnings, adverse reactions, use in specific populations, clinical pharmacology, NDCs, packaging, active ingredients, label version history, or when they need label lookup by brand/generic name, application number, NDC, RxCUI, UNII, labeler, or SETID. Also use to compare specific sections across DailyMed label versions. Do not use as a substitute for clinical advice, FDA approval history, or a complete regulatory assessment.
---

# DailyMed

Retrieve bounded, attributable U.S. product-label evidence from DailyMed without loading an entire SPL into context.

## Questions this skill should answer

- “What are the current FDA-label indications for Repatha?”
- “Does this product have a boxed warning or contraindications?”
- “What dose, route, dosage forms, and strengths are listed?”
- “What adverse reactions or postmarketing events are in the current label?”
- “What does the label say for pediatric, pregnancy, renal, or hepatic populations?”
- “What is the mechanism of action or clinical pharmacology in the label?”
- “Which NDCs, active ingredients, strengths, and packages belong to this label?”
- “Find the label by brand name, generic name, NDC, RxCUI, UNII, application number, or labeler.”
- “Which DailyMed versions exist, and what changed between two versions?”
- “Give me the official DailyMed, XML, PDF, or ZIP link for this label.”

## Required workflow

1. Resolve the label before interpreting it.
   - Search with the most specific identifier available.
   - If a name returns multiple labels, show the bounded candidates and disambiguate by title, labeler, application number, or product type. Never silently choose the first hit.
2. Use the selected `SETID` for all label retrieval.
3. Fetch only the sections needed for the question with `scripts/dailymed.py profile`.
4. Use `history` before answering version-change questions. Fetch each relevant version with `profile --version`; compare only the requested sections.
5. Preserve the label title, `SETID`, SPL version, published/effective date, retrieval time, and DailyMed link in the answer.
6. Quote sparingly. Prefer a faithful summary with a direct source link and identify the label section supporting each material claim.

## ExecuteCode interface

Resolve `<skill-directory>` to the directory containing this `SKILL.md`.

Use APEX `ExecuteCode` with `language="python"` for every DailyMed API search,
profile, and history request. Do not invoke the helper through Bash when
ExecuteCode is available. This keeps the query in the execution notebook, uses
the configured DailyMed domain allowlist, and avoids a separate shell-network
approval.

Load the bundled, read-only helper once in the persistent Python kernel:

```python
import importlib.util
import json
from pathlib import Path

_dailymed_path = Path("<skill-directory>") / "scripts" / "dailymed.py"
_dailymed_spec = importlib.util.spec_from_file_location("apex_dailymed", _dailymed_path)
dailymed = importlib.util.module_from_spec(_dailymed_spec)
_dailymed_spec.loader.exec_module(dailymed)
```

Reuse `dailymed` in later cells. Give every call a concrete `human_description`,
such as `Querying Repatha DailyMed labels` or `Fetching Repatha label profile`.

Search by product name:

```python
search_result = dailymed.search(drug_name="Repatha", limit=10)
print(json.dumps(search_result, indent=2))
```

Other supported search arguments are `application_number`, `ndc`, `rxcui`,
`unii`, `setid`, `labeler`, `boxed_warning`, `name_type`, `limit`, and `page`.

Fetch a bounded current-label profile:

```python
label = dailymed.profile(
    "cd61e902-166d-4aa6-9f3c-a18c1008d07e",
    sections="indications,dosage,contraindications,warnings,adverse_reactions",
)
print(json.dumps(label, indent=2))
```

Inspect version history and retrieve an older label:

```python
versions = dailymed.history("cd61e902-166d-4aa6-9f3c-a18c1008d07e")
older = dailymed.profile(
    "cd61e902-166d-4aa6-9f3c-a18c1008d07e",
    version=26,
    sections="indications,warnings",
)
```

Profile text is truncated per section by default; increase
`max_section_chars` only when the question requires more text, and keep the
helper's hard limit.

If ExecuteCode is unavailable, the compatibility CLI remains
`python3 <skill-directory>/scripts/dailymed.py ...`; explain that this fallback
uses native Bash and may request network approval.

## Section aliases

Use one or more comma-separated aliases:

`recent_changes`, `boxed_warning`, `indications`, `dosage`, `dosage_forms`, `contraindications`, `warnings`, `adverse_reactions`, `drug_interactions`, `specific_populations`, `description`, `clinical_pharmacology`, `nonclinical_toxicology`, `clinical_studies`, `how_supplied`, `patient_counseling`.

Read [references/api-and-output.md](references/api-and-output.md) when integrating new filters, interpreting the normalized JSON, or troubleshooting the API.

## Interpretation rules

- Treat DailyMed as current, company-submitted “in-use” labeling. It can differ from the last FDA-approved label and approval documents in Drugs@FDA.
- Do not infer that a missing or empty section proves absence of a risk. Confirm the selected product, label type, version, and section availability.
- Do not turn label text into personalized dosing or treatment advice. State that prescribing decisions require a qualified clinician and the complete current label.
- Distinguish clinical-trial adverse reactions, postmarketing reports, warnings, and contraindications; do not merge them into a single risk claim.
- Treat a text comparison of two SPL versions as a label-content diff, not an FDA regulatory conclusion. Use Drugs@FDA for approval letters, reviews, and regulatory history.
- Prefer DailyMed's bulk downloads for systematic extraction across the full corpus; do not loop the REST API across thousands of labels.

## Source requirements

Always include:

- DailyMed product URL containing the `SETID`;
- label title and current or historical SPL version;
- published/effective date when available;
- section title or alias supporting each important claim;
- retrieval timestamp from `provenance` for time-sensitive work.
