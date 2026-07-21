#!/usr/bin/env python3
"""Fetch a normalized Open Targets profile for one target.

This module is intentionally dependency-free so it can be called from a skill,
an agent shell tool, or a future MCP wrapper. JSON is the only stdout output;
diagnostics and errors are written to stderr.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_URL = "https://api.platform.opentargets.org/api/v4/graphql"
SCHEMA_VERSION = "1.1.0"
DEFAULT_SECTIONS = (
    "expression",
    "tractability",
    "safety",
    "essentiality",
    "localization",
    "phenotypes",
)
VALID_SECTIONS = frozenset(DEFAULT_SECTIONS)

SOURCE_CATALOG: dict[str, tuple[str, str | None]] = {
    "ensembl": ("Ensembl", "https://www.ensembl.org/"),
    "gtex": ("GTEx", "https://gtexportal.org/home/"),
    "tabula_sapiens": (
        "Tabula Sapiens",
        "https://tabula-sapiens-portal.ds.czbiohub.org/",
    ),
    "pride": ("PRIDE", "https://www.ebi.ac.uk/pride/"),
    "dice": ("Database of Immune Cell Expression", "https://dice-database.org/"),
    "clinpgx": ("ClinPGx", "https://www.clinpgx.org/"),
    "aop-wiki": ("AOP-Wiki", "https://aopwiki.org/"),
    "toxcast": ("ToxCast", "https://www.epa.gov/chemical-research/toxicity-forecasting"),
    "uniprot": ("UniProt", "https://www.uniprot.org/"),
    "hpa": ("Human Protein Atlas", "https://www.proteinatlas.org/"),
    "gnomad": ("gnomAD", "https://gnomad.broadinstitute.org/"),
    "depmap": ("DepMap", "https://depmap.org/portal/"),
    "impc": ("International Mouse Phenotyping Consortium", "https://www.mousephenotype.org/"),
    "open_targets_tractability": (
        "Open Targets Platform tractability assessment",
        "https://platform.opentargets.org/",
    ),
    "open_targets_essentiality": (
        "Open Targets Platform essentiality annotation",
        "https://platform.opentargets.org/",
    ),
}


class OpenTargetsError(RuntimeError):
    """Raised when the Open Targets request or response is invalid."""


def _source(source_id: str | None) -> dict[str, str | None]:
    """Return consistent source metadata while preserving unknown upstream IDs."""
    raw_id = str(source_id or "open_targets").strip()
    lookup_id = raw_id.casefold()
    catalog_id = "hpa" if lookup_id.startswith("hpa_") else lookup_id
    name, url = SOURCE_CATALOG.get(
        catalog_id,
        (raw_id.replace("_", " ").strip() or "Open Targets Platform", None),
    )
    return {
        "id": raw_id,
        "name": name,
        "url": url,
        "accessed_via": "Open Targets Platform",
    }


def _source_summary(value: Any) -> list[dict[str, Any]]:
    """Collect and count all row-level source objects in a normalized profile."""
    sources: dict[str, dict[str, Any]] = {}

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            source = node.get("source")
            if isinstance(source, dict) and source.get("id"):
                source_id = str(source["id"])
                entry = sources.setdefault(
                    source_id,
                    {
                        "id": source_id,
                        "name": source.get("name"),
                        "url": source.get("url"),
                        "accessed_via": source.get("accessed_via"),
                        "result_count": 0,
                    },
                )
                entry["result_count"] += 1
            for key, child in node.items():
                if key != "source":
                    visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(value)
    return sorted(sources.values(), key=lambda item: str(item["name"]).casefold())


def _post_graphql(
    query: str,
    variables: dict[str, Any] | None = None,
    *,
    timeout: float = 60.0,
    retries: int = 2,
) -> dict[str, Any]:
    body = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    request = Request(
        API_URL,
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "open-targets-skill/get-target-profile-1.0",
        },
        method="POST",
    )

    for attempt in range(retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if payload.get("errors"):
                messages = "; ".join(
                    str(item.get("message", item)) for item in payload["errors"]
                )
                raise OpenTargetsError(f"Open Targets GraphQL error: {messages}")
            data = payload.get("data")
            if not isinstance(data, dict):
                raise OpenTargetsError("Open Targets response did not contain a data object")
            return data
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:1000]
            retryable = exc.code == 429 or 500 <= exc.code < 600
            if attempt >= retries or not retryable:
                raise OpenTargetsError(
                    f"Open Targets HTTP {exc.code}: {detail or exc.reason}"
                ) from exc
        except (URLError, TimeoutError) as exc:
            if attempt >= retries:
                raise OpenTargetsError(f"Open Targets request failed: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise OpenTargetsError("Open Targets returned invalid JSON") from exc

        time.sleep(0.75 * (2**attempt))

    raise OpenTargetsError("Open Targets request failed after retries")


def resolve_target(symbol: str, *, timeout: float = 60.0) -> str:
    """Resolve an exact target symbol match to an Ensembl target ID."""
    query = """
    query ResolveTarget($query: String!) {
      search(queryString: $query, entityNames: ["target"]) {
        hits { id name entity description }
      }
    }
    """
    data = _post_graphql(query, {"query": symbol}, timeout=timeout)
    hits = data.get("search", {}).get("hits", [])
    exact = [
        hit
        for hit in hits
        if hit.get("entity") == "target"
        and str(hit.get("name", "")).casefold() == symbol.casefold()
        and str(hit.get("id", "")).startswith("ENSG")
    ]
    if not exact:
        suggestions = ", ".join(
            f"{hit.get('name')} ({hit.get('id')})"
            for hit in hits[:5]
            if hit.get("entity") == "target"
        )
        suffix = f" Suggestions: {suggestions}." if suggestions else ""
        raise OpenTargetsError(f"No exact Open Targets target match for {symbol!r}.{suffix}")
    return str(exact[0]["id"])


def _core_query(sections: set[str]) -> str:
    fields = ["id", "approvedSymbol", "approvedName", "biotype"]
    if "tractability" in sections:
        fields.append("tractability { label modality value }")
    if "safety" in sections:
        fields.append(
            """
            safetyLiabilities {
              event eventId datasource literature url
              effects { direction dosing }
              biosamples { cellFormat cellLabel cellId tissueLabel tissueId }
              studies { name description type }
            }
            """
        )
    if "essentiality" in sections:
        fields.extend(
            [
                "isEssential",
                "geneticConstraint { constraintType score oe oeLower oeUpper obs exp }",
                """
                depMapEssentiality {
                  tissueId tissueName
                  screens {
                    geneEffect depmapId mutation diseaseCellLineId
                    diseaseFromSource cellLineName expression
                  }
                }
                """,
            ]
        )
    if "localization" in sections:
        fields.append(
            "subcellularLocations { source labelSL termSL targetModifier location }"
        )
    if "phenotypes" in sections:
        fields.append(
            """
            mousePhenotypes {
              targetInModel targetInModelMgiId targetInModelEnsemblId
              modelPhenotypeLabel modelPhenotypeId
            }
            """
        )
    return """
    query TargetProfile($id: String!) {
      meta { dataVersion { year month iteration } }
      target(ensemblId: $id) {
    """ + "\n".join(fields) + """
      }
    }
    """


EXPRESSION_QUERY = """
query TargetExpression($id: String!, $index: Int!, $size: Int!) {
  target(ensemblId: $id) {
    baselineExpression(page: { index: $index, size: $size }) {
      count
      rows {
        datasourceId datatypeId unit min q1 median q3 max
        specificity_score distribution_score qualityControls
        tissueBiosampleFromSource celltypeBiosampleFromSource
      }
    }
  }
}
"""


def _fetch_expression(
    ensembl_id: str,
    *,
    max_rows: int,
    page_size: int,
    timeout: float,
) -> tuple[list[dict[str, Any]], int]:
    rows: list[dict[str, Any]] = []
    total = 0
    row_offset = 0
    while len(rows) < max_rows:
        size = min(page_size, max_rows - len(rows))
        data = _post_graphql(
            EXPRESSION_QUERY,
            {"id": ensembl_id, "index": row_offset, "size": size},
            timeout=timeout,
        )
        expression = (data.get("target") or {}).get("baselineExpression") or {}
        total = int(expression.get("count") or 0)
        page_rows = expression.get("rows") or []
        if not page_rows:
            break
        rows.extend(page_rows)
        if len(rows) >= total:
            break
        # Open Targets uses Page.index as a row offset for this field, not as
        # a zero-based page number. Advancing by one would heavily overlap
        # consecutive responses.
        row_offset += len(page_rows)
    return rows[: min(max_rows, total)], total


def _sort_dicts(items: Iterable[dict[str, Any]], keys: tuple[str, ...]) -> list[dict[str, Any]]:
    return sorted(
        items,
        key=lambda item: tuple(str(item.get(key) or "").casefold() for key in keys),
    )


def _normalize_string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return [value] if value else []
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
        return [str(parsed)]
    return [] if value is None else [str(value)]


def _normalize_expression(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = [
        {
            "datasource": row.get("datasourceId"),
            "source": _source(row.get("datasourceId")),
            "datatype": row.get("datatypeId"),
            "tissue": row.get("tissueBiosampleFromSource"),
            "cell_type": row.get("celltypeBiosampleFromSource"),
            "unit": row.get("unit"),
            "min": row.get("min"),
            "q1": row.get("q1"),
            "median": row.get("median"),
            "q3": row.get("q3"),
            "max": row.get("max"),
            "specificity_score": row.get("specificity_score"),
            "distribution_score": row.get("distribution_score"),
            "quality_controls": _normalize_string_list(row.get("qualityControls")),
        }
        for row in rows
    ]
    return _sort_dicts(normalized, ("datasource", "tissue", "cell_type"))


def _release_label(version: dict[str, Any]) -> str | None:
    year = version.get("year")
    month = version.get("month")
    iteration = version.get("iteration")
    if not year or not month:
        return None
    label = f"{year}.{month}"
    return f"{label}.{iteration}" if iteration is not None else label


def get_target_profile(
    *,
    target: str | None = None,
    ensembl_id: str | None = None,
    sections: Iterable[str] = DEFAULT_SECTIONS,
    max_expression_rows: int = 1500,
    expression_page_size: int = 500,
    timeout: float = 60.0,
) -> dict[str, Any]:
    """Return a normalized target profile suitable for agent or MCP use."""
    selected = set(sections)
    unknown = selected - VALID_SECTIONS
    if unknown:
        raise ValueError(f"Unknown sections: {', '.join(sorted(unknown))}")
    if bool(target) == bool(ensembl_id):
        raise ValueError("Provide exactly one of target or ensembl_id")
    if max_expression_rows < 1 or expression_page_size < 1:
        raise ValueError("Expression row limits must be positive")

    query_input = target or ensembl_id or ""
    resolved_id = ensembl_id or resolve_target(target or "", timeout=timeout)
    if not resolved_id.startswith("ENSG"):
        raise ValueError("ensembl_id must start with ENSG")

    data = _post_graphql(_core_query(selected), {"id": resolved_id}, timeout=timeout)
    raw_target = data.get("target")
    if not raw_target:
        raise OpenTargetsError(f"Open Targets has no target record for {resolved_id}")

    warnings: list[str] = []
    profile: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "target": {
            "ensembl_id": raw_target.get("id"),
            "symbol": raw_target.get("approvedSymbol"),
            "name": raw_target.get("approvedName"),
            "biotype": raw_target.get("biotype"),
            "source": _source("ensembl"),
        },
    }

    if "expression" in selected:
        rows, total = _fetch_expression(
            resolved_id,
            max_rows=max_expression_rows,
            page_size=expression_page_size,
            timeout=timeout,
        )
        profile["expression"] = _normalize_expression(rows)
        profile["expression_total_count"] = total
        warnings.append(
            "Baseline expression is primarily RNA-level evidence and does not prove cell-surface protein abundance or therapeutic accessibility."
        )
        if total > len(rows):
            warnings.append(
                f"Expression rows were truncated to {len(rows)} of {total}; increase --max-expression-rows to retrieve more."
            )

    if "tractability" in selected:
        profile["tractability"] = _sort_dicts(
            [
                {**row, "source": _source("open_targets_tractability")}
                for row in raw_target.get("tractability") or []
            ],
            ("modality", "label"),
        )

    if "safety" in selected:
        safety = _sort_dicts(
            [
                {**row, "source": _source(row.get("datasource"))}
                for row in raw_target.get("safetyLiabilities") or []
            ],
            ("datasource", "event", "eventId"),
        )
        profile["safety_liabilities"] = safety
        if not safety:
            warnings.append(
                "No Open Targets safety liabilities were returned; absence of recorded liabilities is not evidence that the target is safe."
            )

    if "essentiality" in selected:
        constraints = _sort_dicts(
            [
                {**row, "source": _source("gnomad")}
                for row in raw_target.get("geneticConstraint") or []
            ],
            ("constraintType",),
        )
        depmap = _sort_dicts(
            [
                {
                    **row,
                    "screens": [
                        {**screen, "source": _source("depmap")}
                        for screen in row.get("screens") or []
                    ],
                    "source": _source("depmap"),
                }
                for row in raw_target.get("depMapEssentiality") or []
            ],
            ("tissueName", "tissueId"),
        )
        profile["essentiality"] = {
            "is_essential": raw_target.get("isEssential"),
            "genetic_constraint": constraints,
            "depmap": depmap,
            "source": _source("open_targets_essentiality"),
        }

    if "localization" in selected:
        locations = []
        for row in raw_target.get("subcellularLocations") or []:
            source_id = row.get("source")
            locations.append(
                {
                    **row,
                    "source_id": source_id,
                    "source": _source(source_id),
                }
            )
        profile["subcellular_locations"] = _sort_dicts(
            locations, ("location", "source_id")
        )

    if "phenotypes" in selected:
        profile["mouse_phenotypes"] = _sort_dicts(
            [
                {**row, "source": _source("impc")}
                for row in raw_target.get("mousePhenotypes") or []
            ],
            ("modelPhenotypeLabel", "modelPhenotypeId"),
        )
        warnings.append(
            "Mouse phenotypes can support biological interpretation but do not directly predict human efficacy or toxicity."
        )

    version = ((data.get("meta") or {}).get("dataVersion") or {})
    profile["sources"] = _source_summary(profile)
    profile["warnings"] = warnings
    profile["provenance"] = {
        "source": "Open Targets Platform",
        "api_url": API_URL,
        "target_url": f"https://platform.opentargets.org/target/{resolved_id}",
        "data_version": _release_label(version),
        "data_version_components": version,
        "retrieved_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "query_input": query_input,
        "selected_sections": sorted(selected),
    }
    return profile


def _parse_sections(value: str) -> tuple[str, ...]:
    sections = tuple(part.strip().lower() for part in value.split(",") if part.strip())
    if not sections:
        raise argparse.ArgumentTypeError("at least one section is required")
    unknown = set(sections) - VALID_SECTIONS
    if unknown:
        raise argparse.ArgumentTypeError(
            "unknown section(s): " + ", ".join(sorted(unknown))
        )
    return sections


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fetch a normalized Open Targets expression, safety, and tractability profile."
    )
    identity = parser.add_mutually_exclusive_group(required=True)
    identity.add_argument("--target", help="Exact approved gene symbol, for example MC4R")
    identity.add_argument("--ensembl-id", help="Ensembl target ID, for example ENSG00000166603")
    parser.add_argument(
        "--sections",
        type=_parse_sections,
        default=DEFAULT_SECTIONS,
        metavar="LIST",
        help="Comma-separated sections: " + ",".join(DEFAULT_SECTIONS),
    )
    parser.add_argument("--format", choices=("json",), default="json")
    parser.add_argument("--output", type=Path, help="Write JSON to this file instead of stdout")
    parser.add_argument("--compact", action="store_true", help="Emit compact JSON")
    parser.add_argument("--max-expression-rows", type=int, default=1500)
    parser.add_argument("--expression-page-size", type=int, default=500)
    parser.add_argument("--timeout", type=float, default=60.0)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        print("Fetching Open Targets target profile...", file=sys.stderr)
        profile = get_target_profile(
            target=args.target,
            ensembl_id=args.ensembl_id,
            sections=args.sections,
            max_expression_rows=args.max_expression_rows,
            expression_page_size=args.expression_page_size,
            timeout=args.timeout,
        )
        text = json.dumps(
            profile,
            ensure_ascii=False,
            indent=None if args.compact else 2,
            separators=(",", ":") if args.compact else None,
        ) + "\n"
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(text, encoding="utf-8")
            print(f"Wrote {args.output}", file=sys.stderr)
        else:
            sys.stdout.write(text)
        return 0
    except (OpenTargetsError, ValueError, OSError) as exc:
        print(f"get_target_profile: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
