# CSO decision framework

## Evidence questions

### Target strength and selectivity

- Is the dependency distribution shifted broadly or concentrated in a coherent subset?
- Are strong values replicated across several models rather than one outlier?
- Does the same context remain evident after controlling for lineage composition?
- Is the target classified as common/pan-essential in the relevant release?

Avoid a universal gene-effect cutoff. Distributional summaries, matched comparisons, and sensitivity analyses are more defensible. If a cutoff is requested, label its source and show how the conclusion changes under nearby choices.

### Context and biomarkers

Separate confirmation from discovery:

- **Confirmation:** pre-specify a mutation, fusion, expression state, subtype, or lineage and estimate the dependency difference with confidence intervals.
- **Discovery:** state the number of features tested, control false discovery rate, report effect sizes as well as adjusted significance, and validate out of sample or in another release.

Check whether a biomarker is merely a lineage proxy. Compare within lineage when enough models exist. Report group sizes and missingness.

### Artifact checks

- Broad dependency plus common-essential classification may indicate limited tumor selectivity.
- Strong effects at amplified loci may reflect residual copy-number artifacts; inspect release confounder outputs and CN.
- Dependency without target expression needs scrutiny for mapping, screen quality, or indirect effects.
- Correlated dependencies can arise from shared lineage or screen quality. Recalculate within the proposed disease context.
- PRISM sensitivity is not target engagement unless the compound's mechanism and selectivity support that inference.

### Cross-release and cross-method robustness

Compare only overlapping models and preserve method-specific scales. Report:

- release/method and exact file;
- overlap and loss/gain of models;
- correlation and rank stability on paired observations;
- whether subgroup conclusions persist;
- relevant release-note changes.

Do not treat RNAi and CRISPR values as numerically interchangeable. Use concordant direction/context as orthogonal support.

## Model selection for follow-up

Propose at least:

- several sensitive models representing the proposed biomarker/context;
- resistant controls from the same lineage/context where possible;
- biomarker-negative controls matched on major confounders;
- more than one independent source/model lineage if the hypothesis permits.

For every model include `ModelID`, display name, lineage/subtype, dependency score, biomarker status, relevant expression/CN, and source/availability if known. A shortlist is a hypothesis-driven experimental panel, not a ranking of therapeutic indications.

## Decision language

- **Advance:** coherent multi-model dependency, interpretable context, manageable artifact risk, and orthogonal support.
- **Investigate:** promising signal with a decisive, feasible evidence gap.
- **Deprioritize:** weak/incoherent dependency or an artifact/translation risk that undermines the proposed mechanism.
- **Insufficient evidence:** missing coverage, unstable small groups, unresolved release/method mismatch, or unavailable key confounders.

State which criterion drove the label. Keep target biology, tractability, clinical genetics, normal-tissue safety, and competitive landscape as distinct evidence axes sourced elsewhere.
