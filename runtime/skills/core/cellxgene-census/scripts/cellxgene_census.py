#!/usr/bin/env python3
"""Bounded, provenance-rich queries against the official CELLxGENE Census."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys
import urllib.error
import urllib.request
from typing import Any, Iterable


RELEASE_URL = "https://census.cellxgene.cziscience.com/cellxgene-census/v1/release.json"
SDK_SPEC = "cellxgene-census>=1.17,<1.18"
TILEDBSOMA_SPEC = "tiledbsoma>=1.15.3,<2"
NUMBA_SPEC = "numba>=0.60"
DEFAULT_MAX_CELLS = 100_000
HARD_MAX_CELLS = 250_000
HARD_EXPORT_CELLS = 100_000
HARD_MAX_DATASETS = 500
HARD_MAX_GROUPS = 1_000
HARD_MAX_VERSIONS = 100
MULTI_VALUE_DELIMITER = " || "

OBS_COLUMNS = [
    "dataset_id",
    "assay",
    "assay_ontology_term_id",
    "cell_type",
    "cell_type_ontology_term_id",
    "development_stage",
    "development_stage_ontology_term_id",
    "disease",
    "disease_ontology_term_id",
    "donor_id",
    "is_primary_data",
    "sex",
    "sex_ontology_term_id",
    "suspension_type",
    "tissue",
    "tissue_ontology_term_id",
    "tissue_general",
    "tissue_general_ontology_term_id",
    "tissue_type",
]

DATASET_COLUMNS = [
    "soma_joinid",
    "citation",
    "collection_id",
    "collection_name",
    "collection_doi",
    "collection_doi_label",
    "dataset_id",
    "dataset_title",
    "dataset_total_cell_count",
    "dataset_version_id",
]


class UserError(RuntimeError):
    pass


def _json_default(value: Any) -> Any:
    if hasattr(value, "item"):
        return value.item()
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if value is None:
        return None
    return str(value)


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, indent=2, sort_keys=True, default=_json_default, allow_nan=False))


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def fetch_release_directory() -> dict[str, Any]:
    req = urllib.request.Request(RELEASE_URL, headers={"User-Agent": "APEX-CELLxGENE-skill/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = json.load(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise UserError(f"Could not read the official Census release directory: {exc}") from exc
    if not isinstance(payload, dict):
        raise UserError("The official Census release directory returned an unexpected payload.")
    return payload


def sdk_modules() -> tuple[Any, Any, Any, Any]:
    try:
        import cellxgene_census
        import numpy
        import pandas
        import tiledbsoma
    except ImportError as exc:
        raise UserError(
            "Official SDK dependencies are required. Install in an isolated Python 3.10-3.12 environment with: "
            f"python -m pip install '{SDK_SPEC}' '{TILEDBSOMA_SPEC}' '{NUMBA_SPEC}'. "
            f"Original error: {exc}"
        ) from exc
    version = getattr(cellxgene_census, "__version__", "unknown")
    parts = version.split(".")
    if len(parts) < 2 or parts[0] != "1" or parts[1] != "17":
        raise UserError(
            f"This helper is validated with cellxgene-census 1.17.x; found {version}. "
            f"Install '{SDK_SPEC}' or use the official API directly with a compatible Census build."
        )
    return cellxgene_census, tiledbsoma, pandas, numpy


def quote_filter(value: str) -> str:
    if "'" in value or "\\" in value or "\n" in value or "\r" in value:
        raise UserError("Filter values may not contain quotes, backslashes, or line breaks.")
    return f"'{value}'"


def organism_key(label: str) -> str:
    return "_".join(label.strip().lower().split())


def build_obs_filter(args: argparse.Namespace) -> str:
    clauses: list[str] = []
    if not args.include_secondary:
        clauses.append("is_primary_data == True")
    for option, column in (
        (args.dataset_id, "dataset_id"),
        (args.tissue, "tissue_general"),
        (args.cell_type, "cell_type"),
        (args.assay, "assay"),
    ):
        if option:
            clauses.append(f"{column} == {quote_filter(option)}")
    return " and ".join(clauses)


def assert_bounded(args: argparse.Namespace) -> None:
    if not any((args.dataset_id, args.tissue, args.cell_type, args.assay)):
        raise UserError(
            "Add at least one coarse filter: --dataset-id, --tissue, --cell-type, or --assay. "
            "Disease is post-filtered for schema 2.4.0 completeness and does not bound the server query."
        )
    hard = HARD_EXPORT_CELLS if args.command == "export-slice" else HARD_MAX_CELLS
    if args.max_cells < 1 or args.max_cells > hard:
        raise UserError(f"--max-cells must be between 1 and {hard} for {args.command}.")


def split_membership(value: Any) -> set[str]:
    if value is None:
        return set()
    return {item.strip() for item in str(value).split(MULTI_VALUE_DELIMITER) if item.strip()}


def apply_disease_membership(frame: Any, args: argparse.Namespace) -> Any:
    mask = None
    for wanted, column in (
        (args.disease, "disease"),
        (args.disease_ontology_term_id, "disease_ontology_term_id"),
    ):
        if wanted:
            current = frame[column].map(lambda value: wanted in split_membership(value))
            mask = current if mask is None else (mask & current)
    return frame if mask is None else frame.loc[mask].copy()


def read_frame(soma_frame: Any, columns: Iterable[str] | None = None) -> Any:
    kwargs = {"column_names": list(columns)} if columns else {}
    return soma_frame.read(**kwargs).concat().to_pandas()


def census_metadata(census: Any) -> dict[str, str]:
    frame = read_frame(census["census_info"]["summary"], ["label", "value"])
    return {str(row["label"]): str(row["value"]) for _, row in frame.iterrows()}


def resolve_version(requested: str, directory: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    resolved = directory.get(requested, requested)
    if not isinstance(resolved, str) or resolved not in directory or not isinstance(directory[resolved], dict):
        raise UserError(f"Census version {requested!r} is not present in the official release directory.")
    return resolved, directory[resolved]


def provenance(census: Any, requested: str, resolved: str, sdk_version: str) -> dict[str, Any]:
    summary = census_metadata(census)
    return {
        "source": "CZ CELLxGENE Discover Census",
        "requested_census_version": requested,
        "resolved_census_version": resolved,
        "census_build_date": summary.get("census_build_date"),
        "census_schema_version": summary.get("census_schema_version"),
        "dataset_schema_version": summary.get("dataset_schema_version"),
        "cellxgene_census_package_version": sdk_version,
        "retrieved_at": now_utc(),
        "release_directory": RELEASE_URL,
    }


def dataset_table(census: Any) -> Any:
    return read_frame(census["census_info"]["datasets"], DATASET_COLUMNS)


def compact_values(series: Any, limit: int = 12) -> dict[str, Any]:
    values = sorted({str(v) for v in series.dropna().tolist() if str(v)})
    return {"values": values[:limit], "truncated": len(values) > limit, "total_unique": len(values)}


def records(frame: Any) -> list[dict[str, Any]]:
    clean = frame.astype(object).where(frame.notna(), None)
    return clean.to_dict(orient="records")


def command_versions(args: argparse.Namespace) -> None:
    directory = fetch_release_directory()
    stable, stable_meta = resolve_version("stable", directory)
    latest, latest_meta = resolve_version("latest", directory)
    dated = sorted((k for k, v in directory.items() if isinstance(v, dict)), reverse=True)
    emit(
        {
            "source": RELEASE_URL,
            "retrieved_at": now_utc(),
            "aliases": {"stable": stable, "latest": latest},
            "stable": stable_meta,
            "latest": latest_meta,
            "available_dated_versions": dated[: args.limit],
            "available_dated_versions_total": len(dated),
            "guidance": "Pin the dated stable/LTS build for reproducible analysis; latest weekly builds are short-lived.",
        }
    )


def open_context(args: argparse.Namespace) -> tuple[Any, Any, Any, Any, str, dict[str, Any], dict[str, Any]]:
    cxc, tiledbsoma, pandas, numpy = sdk_modules()
    directory = fetch_release_directory()
    resolved, release_meta = resolve_version(args.census_version, directory)
    census = cxc.open_soma(census_version=resolved)
    prov = provenance(census, args.census_version, resolved, cxc.__version__)
    return census, cxc, tiledbsoma, pandas, numpy, release_meta, prov


def query_obs(census: Any, tiledbsoma: Any, args: argparse.Namespace) -> tuple[Any, int, str]:
    assert_bounded(args)
    key = organism_key(args.organism)
    if key not in census["census_data"]:
        raise UserError(f"Organism {args.organism!r} is not available in this Census build.")
    experiment = census["census_data"][key]
    value_filter = build_obs_filter(args)
    with experiment.axis_query(
        measurement_name="RNA",
        obs_query=tiledbsoma.AxisQuery(value_filter=value_filter or None),
    ) as query:
        preflight = int(query.n_obs)
        if preflight > args.max_cells:
            raise UserError(
                f"Coarse query matches {preflight:,} cells, above --max-cells {args.max_cells:,}. "
                "Add a dataset, tissue, cell-type, or assay filter; no rows were sampled."
            )
        obs = query.obs(column_names=OBS_COLUMNS).concat().to_pandas()
    obs = apply_disease_membership(obs, args)
    return obs, preflight, value_filter


def command_datasets(args: argparse.Namespace) -> None:
    census, _, tiledbsoma, _, _, _, prov = open_context(args)
    try:
        obs, preflight, value_filter = query_obs(census, tiledbsoma, args)
        info = dataset_table(census)
        rows: list[dict[str, Any]] = []
        for dataset_id, group in obs.groupby("dataset_id", observed=True, sort=False):
            meta = info.loc[info["dataset_id"] == dataset_id]
            item = records(meta.drop(columns=["soma_joinid"], errors="ignore"))
            row = item[0] if item else {"dataset_id": str(dataset_id)}
            donor_pairs = group[["dataset_id", "donor_id"]].drop_duplicates()
            row.update(
                {
                    "selected_cell_count": int(len(group)),
                    "selected_donor_count": int(len(donor_pairs)),
                    "assays": compact_values(group["assay"]),
                    "cell_types": compact_values(group["cell_type"]),
                    "diseases": compact_values(group["disease"]),
                    "tissues": compact_values(group["tissue"]),
                    "tissues_general": compact_values(group["tissue_general"]),
                    "discover_url": f"https://cellxgene.cziscience.com/e/{dataset_id}.cxg/",
                }
            )
            rows.append(row)
        rows.sort(key=lambda item: item["selected_cell_count"], reverse=True)
        if len(rows) > args.max_datasets:
            raise UserError(
                f"Query matches {len(rows)} datasets, above --max-datasets {args.max_datasets}; refine filters."
            )
        emit(
            {
                "provenance": prov,
                "query": {
                    "organism": args.organism,
                    "server_value_filter": value_filter,
                    "disease_membership_filter": args.disease,
                    "disease_ontology_membership_filter": args.disease_ontology_term_id,
                    "is_primary_data_only": not args.include_secondary,
                    "coarse_cell_count": preflight,
                    "matched_cell_count": int(len(obs)),
                },
                "dataset_count": len(rows),
                "datasets": rows,
                "interpretation_guardrail": "This is metadata discovery, not an expression or differential-expression result.",
            }
        )
    finally:
        census.close()


def resolve_features(census: Any, cxc: Any, args: argparse.Namespace) -> Any:
    if not args.feature_id and not getattr(args, "gene", None):
        raise UserError("Provide --feature-id (preferred) or --gene.")
    if args.feature_id:
        ids = list(dict.fromkeys(args.feature_id))
        terms = ", ".join(quote_filter(value) for value in ids)
        frame = cxc.get_var(census, args.organism, value_filter=f"feature_id in [{terms}]")
        missing = sorted(set(ids) - set(frame["feature_id"].astype(str)))
        if missing:
            raise UserError(f"Feature IDs not found for {args.organism}: {', '.join(missing)}")
        order = {value: index for index, value in enumerate(ids)}
        return frame.assign(_order=frame["feature_id"].map(order)).sort_values("_order").drop(columns="_order")
    symbol = args.gene
    frame = cxc.get_var(census, args.organism, value_filter=f"feature_name == {quote_filter(symbol)}")
    if len(frame) == 0:
        raise UserError(f"Gene symbol {symbol!r} was not found for {args.organism}.")
    if len(frame) > 1:
        choices = ", ".join(f"{row.feature_id} ({row.feature_name})" for row in frame.itertuples())
        raise UserError(f"Gene symbol {symbol!r} is ambiguous in this Census build: {choices}. Use --feature-id.")
    return frame


def measured_dataset_ids(census: Any, args: argparse.Namespace, features: Any) -> tuple[set[str], dict[str, list[str]]]:
    key = organism_key(args.organism)
    matrix = census["census_data"][key].ms["RNA"]["feature_dataset_presence_matrix"]
    info = dataset_table(census)
    by_feature: dict[str, list[str]] = {}
    all_sets: list[set[str]] = []
    for row in features.itertuples():
        feature_joinid = int(row.soma_joinid)
        presence = matrix.read(coords=(slice(None), [feature_joinid])).tables().concat().to_pandas()
        joinids = set(presence.loc[presence["soma_data"].astype(bool), "soma_dim_0"].astype(int))
        ids = set(info.loc[info["soma_joinid"].astype(int).isin(joinids), "dataset_id"].astype(str))
        by_feature[str(row.feature_id)] = sorted(ids)
        all_sets.append(ids)
    intersection = set.intersection(*all_sets) if all_sets else set()
    return intersection, by_feature


def expression_slice(census: Any, cxc: Any, tiledbsoma: Any, args: argparse.Namespace, features: Any) -> tuple[Any, int, str, dict[str, list[str]]]:
    assert_bounded(args)
    key = organism_key(args.organism)
    experiment = census["census_data"][key]
    obs_filter = build_obs_filter(args)
    ids = [str(value) for value in features["feature_id"].tolist()]
    var_filter = "feature_id in [" + ", ".join(quote_filter(value) for value in ids) + "]"
    with experiment.axis_query(
        measurement_name="RNA",
        obs_query=tiledbsoma.AxisQuery(value_filter=obs_filter or None),
        var_query=tiledbsoma.AxisQuery(value_filter=var_filter),
    ) as query:
        preflight = int(query.n_obs)
        if preflight > args.max_cells:
            raise UserError(
                f"Coarse query matches {preflight:,} cells, above --max-cells {args.max_cells:,}. "
                "Refine the context; no cells were sampled."
            )
        adata = query.to_anndata(X_name="raw", column_names={"obs": OBS_COLUMNS, "var": ["feature_id", "feature_name", "feature_length"]})
    disease_filtered = apply_disease_membership(adata.obs, args)
    adata = adata[disease_filtered.index, :].copy()
    measured, by_feature = measured_dataset_ids(census, args, features)
    adata = adata[adata.obs["dataset_id"].astype(str).isin(measured), :].copy()
    return adata, preflight, obs_filter, by_feature


def dataset_provenance_for_cells(census: Any, obs: Any) -> list[dict[str, Any]]:
    ids = set(obs["dataset_id"].astype(str))
    info = dataset_table(census)
    subset = info.loc[info["dataset_id"].astype(str).isin(ids)].drop(columns=["soma_joinid"], errors="ignore")
    result = records(subset)
    for item in result:
        item["discover_url"] = f"https://cellxgene.cziscience.com/e/{item['dataset_id']}.cxg/"
    return result


def command_expression_summary(args: argparse.Namespace) -> None:
    census, cxc, tiledbsoma, pandas, numpy, _, prov = open_context(args)
    try:
        features = resolve_features(census, cxc, args)
        if len(features) != 1:
            raise UserError("expression-summary accepts exactly one --feature-id.")
        adata, preflight, obs_filter, presence = expression_slice(census, cxc, tiledbsoma, args, features)
        if adata.n_obs == 0:
            raise UserError("No cells remain after disease membership and feature-measurement filters.")
        detected = numpy.asarray((adata.X > 0).sum(axis=1)).reshape(-1).astype(int) > 0
        obs = adata.obs.copy()
        obs["detected"] = detected
        group_columns = ["dataset_id", "donor_id", "assay", "tissue_general", "tissue", "disease", "cell_type"]
        strata = (
            obs.groupby(group_columns, observed=True, dropna=False)
            .agg(cell_count=("detected", "size"), detected_cell_count=("detected", "sum"))
            .reset_index()
        )
        strata["detected_fraction"] = strata["detected_cell_count"] / strata["cell_count"]
        context_columns = ["assay", "tissue_general", "disease", "cell_type"]
        contexts = (
            strata.groupby(context_columns, observed=True, dropna=False)
            .agg(
                dataset_count=("dataset_id", "nunique"),
                donor_strata_count=("donor_id", "size"),
                cell_count=("cell_count", "sum"),
                median_donor_stratum_detected_fraction=("detected_fraction", "median"),
                min_donor_stratum_detected_fraction=("detected_fraction", "min"),
                max_donor_stratum_detected_fraction=("detected_fraction", "max"),
            )
            .reset_index()
            .sort_values(["dataset_count", "donor_strata_count", "cell_count"], ascending=False)
        )
        if len(strata) > args.max_groups or len(contexts) > args.max_groups:
            raise UserError(
                f"Result has {len(strata)} donor strata and {len(contexts)} contexts, above --max-groups "
                f"{args.max_groups}; refine filters."
            )
        feature = records(features[["feature_id", "feature_name", "feature_length", "soma_joinid"]])[0]
        emit(
            {
                "provenance": prov,
                "feature": feature,
                "query": {
                    "organism": args.organism,
                    "server_value_filter": obs_filter,
                    "disease_membership_filter": args.disease,
                    "disease_ontology_membership_filter": args.disease_ontology_term_id,
                    "is_primary_data_only": not args.include_secondary,
                    "coarse_cell_count": preflight,
                    "analyzed_cell_count": int(adata.n_obs),
                    "dataset_count": int(obs["dataset_id"].nunique()),
                    "donor_strata_count": int(obs[["dataset_id", "donor_id"]].drop_duplicates().shape[0]),
                },
                "contexts": records(contexts),
                "dataset_donor_strata": records(strata.sort_values("cell_count", ascending=False)),
                "datasets": dataset_provenance_for_cells(census, obs),
                "feature_measured_dataset_count": len(presence[str(feature["feature_id"])]),
                "interpretation_guardrails": [
                    "Detection is raw count > 0 only in datasets where the feature-presence matrix marks the gene measured.",
                    "The primary summary is donor-stratum detection; cells are not treated as independent biological replicates.",
                    "Detection is observational and assay-dependent, not protein abundance, patient prevalence, efficacy, or safety.",
                    "No differential-expression test was performed.",
                ],
            }
        )
    finally:
        census.close()


def command_export_slice(args: argparse.Namespace) -> None:
    census, cxc, tiledbsoma, _, _, _, prov = open_context(args)
    try:
        if not args.feature_id:
            raise UserError("export-slice requires one or more exact --feature-id values.")
        features = resolve_features(census, cxc, args)
        adata, preflight, obs_filter, presence = expression_slice(census, cxc, tiledbsoma, args, features)
        if adata.n_obs == 0:
            raise UserError("No cells remain after disease membership and feature-measurement filters.")
        output = pathlib.Path(args.output).expanduser().resolve()
        if output.suffix.lower() != ".h5ad":
            raise UserError("--output must end in .h5ad")
        output.parent.mkdir(parents=True, exist_ok=True)
        export_prov = {
            **prov,
            "organism": args.organism,
            "server_value_filter": obs_filter,
            "disease_membership_filter": args.disease,
            "disease_ontology_membership_filter": args.disease_ontology_term_id,
            "is_primary_data_only": not args.include_secondary,
            "coarse_cell_count": preflight,
            "exported_cell_count": int(adata.n_obs),
            "feature_ids": [str(value) for value in adata.var["feature_id"].tolist()],
            "feature_measured_dataset_ids": presence,
            "datasets": dataset_provenance_for_cells(census, adata.obs),
            "note": "Only datasets marked as measuring every requested feature are included.",
        }
        adata.uns["census_provenance"] = export_prov
        adata.write_h5ad(output)
        sidecar = pathlib.Path(str(output) + ".provenance.json")
        sidecar.write_text(json.dumps(export_prov, indent=2, sort_keys=True, default=_json_default) + "\n")
        emit(
            {
                "output": str(output),
                "provenance_sidecar": str(sidecar),
                "cells": int(adata.n_obs),
                "features": int(adata.n_vars),
                "provenance": export_prov,
            }
        )
    finally:
        census.close()


def add_query_args(parser: argparse.ArgumentParser, *, export: bool = False) -> None:
    parser.add_argument("--census-version", default="2025-11-08", help="Dated Census build; stable/latest aliases accepted and resolved")
    parser.add_argument("--organism", default="Homo sapiens")
    parser.add_argument("--dataset-id")
    parser.add_argument("--tissue", help="Exact tissue_general label")
    parser.add_argument("--cell-type", help="Exact standardized cell_type label")
    parser.add_argument("--assay", help="Exact standardized assay label")
    parser.add_argument("--disease", help="Exact member of the possibly multi-valued disease field; post-filtered")
    parser.add_argument("--disease-ontology-term-id", help="Exact member of the multi-valued disease ontology field; post-filtered")
    parser.add_argument("--include-secondary", action="store_true", help="Include duplicate/secondary Census representations")
    parser.add_argument("--max-cells", type=int, default=50_000 if export else DEFAULT_MAX_CELLS)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    versions = sub.add_parser("versions", help="Show official Census release aliases and dated builds")
    versions.add_argument("--limit", type=int, default=20)
    versions.set_defaults(func=command_versions)

    datasets = sub.add_parser("datasets", help="Discover bounded datasets from standardized cell metadata")
    add_query_args(datasets)
    datasets.add_argument("--max-datasets", type=int, default=100)
    datasets.set_defaults(func=command_datasets)

    summary = sub.add_parser("expression-summary", help="Summarize gene detection by dataset-donor context")
    add_query_args(summary)
    summary.add_argument("--feature-id", action="append", help="Exact Ensembl feature ID; specify once")
    summary.add_argument("--gene", help="Exact symbol; stops if symbol is ambiguous")
    summary.add_argument("--max-groups", type=int, default=200)
    summary.set_defaults(func=command_expression_summary)

    export = sub.add_parser("export-slice", help="Export a bounded, version-pinned AnnData slice")
    add_query_args(export, export=True)
    export.add_argument("--feature-id", action="append", help="Exact Ensembl feature ID; repeat for multiple genes")
    export.add_argument("--gene", help=argparse.SUPPRESS)
    export.add_argument("--output", required=True)
    export.set_defaults(func=command_export_slice)
    return parser


def main() -> int:
    try:
        args = build_parser().parse_args()
        if not 1 <= getattr(args, "limit", 1) <= HARD_MAX_VERSIONS:
            raise UserError(f"--limit must be between 1 and {HARD_MAX_VERSIONS}.")
        if not 1 <= getattr(args, "max_datasets", 1) <= HARD_MAX_DATASETS:
            raise UserError(f"--max-datasets must be between 1 and {HARD_MAX_DATASETS}.")
        if not 1 <= getattr(args, "max_groups", 1) <= HARD_MAX_GROUPS:
            raise UserError(f"--max-groups must be between 1 and {HARD_MAX_GROUPS}.")
        args.func(args)
        return 0
    except UserError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("error: interrupted", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
