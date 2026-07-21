#!/usr/bin/env python3
"""Bounded, dependency-free summaries of pinned DepMap wide release matrices."""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import statistics
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, TextIO


DOWNLOAD_CATALOG_URL = "https://depmap.org/portal/api/download/files"
HARD_MAX_GENES = 20
HARD_MAX_TOP = 100
HARD_MAX_CATALOG_RESULTS = 100
HARD_MAX_TIMEOUT_SECONDS = 120
HARD_MAX_CATALOG_BYTES = 50_000_000
MISSING = {"", "na", "nan", "null", "none", "n/a"}
ID_CANDIDATES = ("ModelID", "DepMap_ID", "DepMapID", "ACH", "ID")
NAME_CANDIDATES = ("ModelName", "CellLineName", "CellLine", "CCLEName", "StrippedCellLineName")
LINEAGE_CANDIDATES = ("OncotreeLineage", "lineage", "Lineage", "PrimaryDisease")
SUBTYPE_CANDIDATES = ("OncotreeSubtype", "Subtype", "subtype", "MolecularSubtype")
DISEASE_CANDIDATES = ("OncotreePrimaryDisease", "PrimaryDisease", "Disease", "disease")


def open_text(path: str) -> TextIO:
    p = Path(path)
    if not p.exists():
        raise ValueError(f"File not found: {path}")
    if p.suffix.lower() == ".gz":
        return gzip.open(p, "rt", encoding="utf-8-sig", newline="")
    return p.open("r", encoding="utf-8-sig", newline="")


def delimiter_for(path: str, sample: str = "") -> str:
    stem = path[:-3] if path.lower().endswith(".gz") else path
    if stem.lower().endswith(".tsv") or stem.lower().endswith(".txt"):
        return "\t"
    if stem.lower().endswith(".csv"):
        return ","
    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t").delimiter
    except csv.Error:
        return ","


def pick_column(fields: list[str], candidates: Iterable[str], required: bool = False) -> str | None:
    exact = {field.lower(): field for field in fields}
    for candidate in candidates:
        if candidate.lower() in exact:
            return exact[candidate.lower()]
    if required:
        raise ValueError(f"Expected one of columns {list(candidates)}; found {fields[:20]}")
    return None


def clean_float(value: str | None) -> float | None:
    if value is None or value.strip().lower() in MISSING:
        return None
    try:
        parsed = float(value)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def gene_column(fields: list[str], symbol: str) -> str:
    symbol_upper = symbol.strip().upper()
    matches = []
    for field in fields:
        prefix = field.split(" (", 1)[0].strip().upper()
        if field.strip().upper() == symbol_upper or prefix == symbol_upper:
            matches.append(field)
    if not matches:
        raise ValueError(f"Gene {symbol!r} was not found in the matrix header")
    if len(matches) > 1:
        raise ValueError(f"Gene {symbol!r} is ambiguous; matching columns: {matches}")
    return matches[0]


def read_models(path: str | None) -> tuple[dict[str, dict[str, str]], dict[str, str | None]]:
    if path is None:
        return {}, {"id": None, "name": None, "lineage": None, "subtype": None, "disease": None}
    with open_text(path) as handle:
        sample = handle.read(4096)
        handle.seek(0)
        reader = csv.DictReader(handle, delimiter=delimiter_for(path, sample))
        fields = reader.fieldnames or []
        selected = {
            "id": pick_column(fields, ID_CANDIDATES, required=True),
            "name": pick_column(fields, NAME_CANDIDATES),
            "lineage": pick_column(fields, LINEAGE_CANDIDATES),
            "subtype": pick_column(fields, SUBTYPE_CANDIDATES),
            "disease": pick_column(fields, DISEASE_CANDIDATES),
        }
        rows = {}
        for row in reader:
            model_id = (row.get(selected["id"] or "") or "").strip()
            if model_id:
                rows[model_id] = row
        return rows, selected


def read_gene_scores(path: str, genes: list[str]) -> tuple[dict[str, dict[str, float | None]], dict[str, str], str]:
    with open_text(path) as handle:
        sample = handle.read(4096)
        handle.seek(0)
        reader = csv.DictReader(handle, delimiter=delimiter_for(path, sample))
        fields = reader.fieldnames or []
        id_col = pick_column(fields, ID_CANDIDATES) or (fields[0] if fields else None)
        if not id_col:
            raise ValueError("Dependency matrix has no header")
        columns = {gene: gene_column(fields, gene) for gene in genes}
        scores: dict[str, dict[str, float | None]] = {}
        for row in reader:
            model_id = (row.get(id_col) or "").strip()
            if not model_id:
                continue
            if model_id in scores:
                raise ValueError(f"Duplicate model identifier in dependency matrix: {model_id}")
            scores[model_id] = {gene: clean_float(row.get(column)) for gene, column in columns.items()}
        return scores, columns, id_col


def quantile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * q
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] * (upper - position) + ordered[upper] * (position - lower)


def summary(values: list[float]) -> dict[str, float | int | None]:
    if not values:
        return {"n": 0, "mean": None, "median": None, "q1": None, "q3": None, "min": None, "max": None}
    return {
        "n": len(values),
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        "q1": quantile(values, 0.25),
        "q3": quantile(values, 0.75),
        "min": min(values),
        "max": max(values),
    }


def model_value(row: dict[str, str], selected: dict[str, str | None], key: str) -> str | None:
    column = selected.get(key)
    value = (row.get(column) or "").strip() if column else ""
    return value or None


def gene_profile(
    gene: str,
    scores: dict[str, dict[str, float | None]],
    models: dict[str, dict[str, str]],
    selected: dict[str, str | None],
    top: int,
    min_group_size: int,
    cutoff: float | None,
) -> dict[str, Any]:
    evaluated = [(model_id, row[gene]) for model_id, row in scores.items() if row[gene] is not None]
    missing = sum(1 for row in scores.values() if row[gene] is None)
    ordered = sorted(evaluated, key=lambda item: (item[1], item[0]))

    top_models = []
    for model_id, value in ordered[:top]:
        metadata = models.get(model_id, {})
        top_models.append({
            "model_id": model_id,
            "model_name": model_value(metadata, selected, "name"),
            "lineage": model_value(metadata, selected, "lineage"),
            "subtype": model_value(metadata, selected, "subtype"),
            "disease": model_value(metadata, selected, "disease"),
            "gene_effect": value,
        })

    groups: dict[str, list[float]] = defaultdict(list)
    unannotated = 0
    for model_id, value in evaluated:
        metadata = models.get(model_id, {})
        lineage = model_value(metadata, selected, "lineage")
        if lineage:
            groups[lineage].append(value)
        else:
            unannotated += 1
    included = []
    excluded = []
    for group, values in groups.items():
        record = {"lineage": group, **summary(values)}
        (included if len(values) >= min_group_size else excluded).append(record)
    included.sort(key=lambda row: (row["median"], row["lineage"]))
    excluded.sort(key=lambda row: (-row["n"], row["lineage"]))

    result: dict[str, Any] = {
        "gene": gene,
        "coverage": {
            "matrix_models": len(scores),
            "evaluated": len(evaluated),
            "missing_gene_effect": missing,
            "metadata_models": len(models),
            "evaluated_without_lineage": unannotated,
        },
        "distribution": summary([value for _, value in evaluated]),
        "strongest_models": top_models,
        "lineages": {
            "minimum_group_size": min_group_size,
            "included": included,
            "excluded_small_groups": excluded,
        },
    }
    if cutoff is not None:
        below = sum(value < cutoff for _, value in evaluated)
        result["user_defined_cutoff"] = {
            "cutoff": cutoff,
            "models_below": below,
            "fraction_below": below / len(evaluated) if evaluated else None,
            "warning": "User-supplied sensitivity analysis; not a universal dependency threshold.",
        }
    return result


def pearson_pairs(x: list[float], y: list[float]) -> float | None:
    if len(x) < 3:
        return None
    mx, my = statistics.fmean(x), statistics.fmean(y)
    numerator = sum((a - mx) * (b - my) for a, b in zip(x, y))
    dx = sum((a - mx) ** 2 for a in x)
    dy = sum((b - my) ** 2 for b in y)
    denominator = math.sqrt(dx * dy)
    return numerator / denominator if denominator else None


def cmd_target_profile(args: argparse.Namespace) -> dict[str, Any]:
    scores, columns, id_column = read_gene_scores(args.gene_effect, [args.gene])
    models, selected = read_models(args.models)
    profile = gene_profile(args.gene, scores, models, selected, args.top, args.min_group_size, args.cutoff)
    return {
        "operation": "target-profile",
        "provenance": {
            "release": args.release,
            "assay_method": args.method,
            "gene_effect_file": str(Path(args.gene_effect).resolve()),
            "model_file": str(Path(args.models).resolve()) if args.models else None,
            "matrix_id_column": id_column,
            "resolved_gene_column": columns[args.gene],
            "metadata_columns": selected,
        },
        "profile": profile,
        "interpretation_guardrails": [
            "Lower gene-effect values indicate stronger dependency only within the named dataset/method.",
            "Cell-line dependency is not evidence of clinical efficacy, normal-tissue safety, or causal human disease biology.",
            "Check common-essential status, copy number, expression, release confounders, and orthogonal evidence before a decision.",
        ],
    }


def cmd_compare_targets(args: argparse.Namespace) -> dict[str, Any]:
    genes = list(dict.fromkeys(args.genes))
    if len(genes) < 2:
        raise ValueError("compare-targets requires at least two distinct genes")
    scores, columns, id_column = read_gene_scores(args.gene_effect, genes)
    models, selected = read_models(args.models)
    profiles = {
        gene: gene_profile(gene, scores, models, selected, args.top, args.min_group_size, None)
        for gene in genes
    }
    comparisons = []
    for i, left in enumerate(genes):
        for right in genes[i + 1 :]:
            paired = [(row[left], row[right], model_id) for model_id, row in scores.items() if row[left] is not None and row[right] is not None]
            x = [pair[0] for pair in paired]
            y = [pair[1] for pair in paired]
            k = min(args.overlap_top, len(paired))
            left_top = {model_id for _, _, model_id in sorted(paired, key=lambda p: (p[0], p[2]))[:k]}
            right_top = {model_id for _, _, model_id in sorted(paired, key=lambda p: (p[1], p[2]))[:k]}
            comparisons.append({
                "left": left,
                "right": right,
                "paired_models": len(paired),
                "pearson_correlation": pearson_pairs(x, y),
                "top_k": k,
                "top_k_overlap": len(left_top & right_top),
                "top_k_jaccard": len(left_top & right_top) / len(left_top | right_top) if left_top | right_top else None,
            })
    return {
        "operation": "compare-targets",
        "provenance": {
            "release": args.release,
            "assay_method": args.method,
            "gene_effect_file": str(Path(args.gene_effect).resolve()),
            "model_file": str(Path(args.models).resolve()) if args.models else None,
            "matrix_id_column": id_column,
            "resolved_gene_columns": columns,
            "metadata_columns": selected,
        },
        "profiles": profiles,
        "pairwise_complete_comparisons": comparisons,
        "interpretation_guardrails": [
            "Comparisons use pairwise-complete models from one matrix and do not establish therapeutic superiority.",
            "Inspect lineage composition, common-essential status, artifacts, and orthogonal evidence before prioritization.",
        ],
    }


def cmd_download_catalog(args: argparse.Namespace) -> dict[str, Any]:
    request = urllib.request.Request(DOWNLOAD_CATALOG_URL, headers={"User-Agent": "APEX-DepMap-skill/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            content_type = response.headers.get("content-type", "")
            raw = response.read(args.max_bytes + 1)
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ValueError(f"DepMap download catalog request failed: {exc}") from exc
    if len(raw) > args.max_bytes:
        raise ValueError(f"Catalog exceeded --max-bytes={args.max_bytes}; use the Portal downloads interactively")
    text = raw.decode("utf-8-sig", errors="replace")
    if "text/html" in content_type.lower() or "verification" in text[:1000].lower():
        raise ValueError("DepMap returned browser verification instead of the catalog; use the Portal/download page interactively and do not scrape it")
    reader = csv.DictReader(text.splitlines())
    rows = list(reader)
    terms = [term.lower() for term in args.contains]
    matches = [row for row in rows if all(term in " ".join(row.values()).lower() for term in terms)]
    return {
        "operation": "download-catalog",
        "source": DOWNLOAD_CATALOG_URL,
        "catalog_rows": len(rows),
        "filters": args.contains,
        "matched_rows": len(matches),
        "results": matches[: args.limit],
        "truncated": len(matches) > args.limit,
        "warning": "The API is experimental; pin the selected release and retrieve fresh signed URLs immediately before download.",
    }


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    root.add_argument("--indent", type=int, default=2, help="JSON indentation")
    commands = root.add_subparsers(dest="command", required=True)

    target = commands.add_parser("target-profile", help="Summarize one target from a pinned wide gene-effect matrix")
    target.add_argument("--gene", required=True)
    target.add_argument("--gene-effect", required=True)
    target.add_argument("--models")
    target.add_argument("--release", required=True)
    target.add_argument("--method", default="CRISPR Chronos gene effect")
    target.add_argument("--top", type=int, default=10)
    target.add_argument("--min-group-size", type=int, default=5)
    target.add_argument("--cutoff", type=float)
    target.set_defaults(func=cmd_target_profile)

    compare = commands.add_parser("compare-targets", help="Compare targets on matched models in one matrix")
    compare.add_argument("--genes", nargs="+", required=True)
    compare.add_argument("--gene-effect", required=True)
    compare.add_argument("--models")
    compare.add_argument("--release", required=True)
    compare.add_argument("--method", default="CRISPR Chronos gene effect")
    compare.add_argument("--top", type=int, default=10)
    compare.add_argument("--min-group-size", type=int, default=5)
    compare.add_argument("--overlap-top", type=int, default=20)
    compare.set_defaults(func=cmd_compare_targets)

    catalog = commands.add_parser("download-catalog", help="Query the bounded official download catalog")
    catalog.add_argument("--contains", nargs="*", default=[])
    catalog.add_argument("--limit", type=int, default=20)
    catalog.add_argument("--timeout", type=float, default=30)
    catalog.add_argument("--max-bytes", type=int, default=20_000_000)
    catalog.set_defaults(func=cmd_download_catalog)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        if not 1 <= getattr(args, "top", 1) <= HARD_MAX_TOP:
            raise ValueError(f"--top must be between 1 and {HARD_MAX_TOP}")
        if getattr(args, "min_group_size", 1) < 1:
            raise ValueError("--min-group-size must be positive")
        if not 1 <= getattr(args, "overlap_top", 1) <= HARD_MAX_TOP:
            raise ValueError(f"--overlap-top must be between 1 and {HARD_MAX_TOP}")
        if not 1 <= getattr(args, "limit", 1) <= HARD_MAX_CATALOG_RESULTS:
            raise ValueError(f"--limit must be between 1 and {HARD_MAX_CATALOG_RESULTS}")
        if len(getattr(args, "genes", [])) > HARD_MAX_GENES:
            raise ValueError(f"--genes accepts at most {HARD_MAX_GENES} targets per comparison")
        if not 1 <= getattr(args, "timeout", 1) <= HARD_MAX_TIMEOUT_SECONDS:
            raise ValueError(f"--timeout must be between 1 and {HARD_MAX_TIMEOUT_SECONDS} seconds")
        if not 1 <= getattr(args, "max_bytes", 1) <= HARD_MAX_CATALOG_BYTES:
            raise ValueError(f"--max-bytes must be between 1 and {HARD_MAX_CATALOG_BYTES}")
        result = args.func(args)
        print(json.dumps(result, indent=args.indent, sort_keys=False, allow_nan=False))
        return 0
    except (ValueError, csv.Error) as exc:
        print(json.dumps({"error": str(exc)}, indent=args.indent), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
