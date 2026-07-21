#!/usr/bin/env python3
"""Store and query sectioned Open Targets target profiles.

The CLI deliberately uses one generic execution surface instead of adding MCP
tools. `fetch` writes a versioned profile directory and prints only a compact
manifest; `query` reads one section and returns a bounded result set.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import uuid
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from get_target_profile import (
    DEFAULT_SECTIONS,
    OpenTargetsError,
    VALID_SECTIONS,
    get_target_profile,
)


PROFILE_SCHEMA_VERSION = "1.0.0"
DEFAULT_STORE = Path(".apex/profiles/open-targets")
JSONL_SECTIONS = frozenset({"expression", "depmap", "mouse_phenotypes"})
MAX_QUERY_ROWS = 100


class ProfileError(RuntimeError):
    """Raised when a stored profile or query is invalid."""


def _write_json(path: Path, value: Any) -> None:
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    count = 0
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")
            count += 1
    return count


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _source_id(source: Any) -> str | None:
    if isinstance(source, dict) and source.get("id"):
        return str(source["id"])
    return None


def _compact_sources(value: Any) -> Any:
    """Replace repeated source objects with stable source_id references."""
    if isinstance(value, list):
        return [_compact_sources(item) for item in value]
    if not isinstance(value, dict):
        return value
    compacted: dict[str, Any] = {}
    for key, child in value.items():
        if key == "source" and isinstance(child, dict):
            compacted.setdefault("source_id", _source_id(child))
        else:
            compacted[key] = _compact_sources(child)
    return compacted


def _source_catalog(profile: dict[str, Any]) -> dict[str, dict[str, Any]]:
    catalog: dict[str, dict[str, Any]] = {}
    for source in profile.get("sources") or []:
        source_id = str(source.get("id") or "")
        if not source_id:
            continue
        catalog[source_id] = {
            "name": source.get("name"),
            "url": source.get("url"),
            "accessed_via": source.get("accessed_via"),
            "result_count": source.get("result_count", 0),
        }
    return catalog


def _stored_source_counts(value: Any) -> Counter[str]:
    counts: Counter[str] = Counter()

    def visit(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("source_id"):
                counts[str(node["source_id"])] += 1
            for child in node.values():
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(value)
    return counts


def _count_sources(rows: Iterable[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(str(row.get("source_id")) for row in rows if row.get("source_id"))
    return dict(sorted(counts.items(), key=lambda item: item[0].casefold()))


def _flatten_depmap(essentiality: dict[str, Any]) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []
    for tissue in essentiality.get("depmap") or []:
        for screen in tissue.get("screens") or []:
            flattened.append(
                {
                    "tissue_id": tissue.get("tissueId"),
                    "tissue_name": tissue.get("tissueName"),
                    "gene_effect": screen.get("geneEffect"),
                    "depmap_id": screen.get("depmapId"),
                    "mutation": screen.get("mutation"),
                    "disease_cell_line_id": screen.get("diseaseCellLineId"),
                    "disease_from_source": screen.get("diseaseFromSource"),
                    "cell_line_name": screen.get("cellLineName"),
                    "expression": screen.get("expression"),
                    "source_id": screen.get("source_id") or tissue.get("source_id"),
                }
            )
    return flattened


def _top_numeric_rows(
    rows: Iterable[dict[str, Any]],
    field: str,
    *,
    limit: int = 10,
) -> list[dict[str, Any]]:
    numeric = [row for row in rows if isinstance(row.get(field), (int, float))]
    return sorted(numeric, key=lambda row: row[field], reverse=True)[:limit]


def _build_summary(
    profile: dict[str, Any],
    sections: dict[str, list[dict[str, Any]] | dict[str, Any]],
    depmap_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    target = _compact_sources(profile["target"])
    summary: dict[str, Any] = {
        "schema_version": PROFILE_SCHEMA_VERSION,
        "target": target,
        "data_version": profile["provenance"].get("data_version"),
        "retrieved_at": profile["provenance"].get("retrieved_at"),
        "warnings": profile.get("warnings") or [],
        "sections": {},
    }

    expression = sections.get("expression")
    if isinstance(expression, list):
        gtex = [row for row in expression if str(row.get("source_id", "")).casefold() == "gtex"]
        summary["sections"]["expression"] = {
            "rows": len(expression),
            "upstream_total": profile.get("expression_total_count", len(expression)),
            "truncated": len(expression) < profile.get("expression_total_count", len(expression)),
            "sources": _count_sources(expression),
            "top_gtex_tissues_by_median": [
                {
                    "tissue": row.get("tissue"),
                    "median": row.get("median"),
                    "unit": row.get("unit"),
                    "source_id": row.get("source_id"),
                }
                for row in _top_numeric_rows(gtex, "median")
            ],
        }

    tractability = sections.get("tractability")
    if isinstance(tractability, list):
        summary["sections"]["tractability"] = {
            "rows": len(tractability),
            "modalities": sorted(
                {str(row.get("modality")) for row in tractability if row.get("modality")}
            ),
        }

    safety = sections.get("safety")
    if isinstance(safety, list):
        summary["sections"]["safety"] = {
            "rows": len(safety),
            "sources": _count_sources(safety),
            "events": [row.get("event") for row in safety[:10] if row.get("event")],
        }

    essentiality = sections.get("essentiality")
    if isinstance(essentiality, dict):
        summary["sections"]["essentiality"] = {
            "is_essential": essentiality.get("is_essential"),
            "genetic_constraint_rows": len(essentiality.get("genetic_constraint") or []),
            "depmap_rows": len(depmap_rows),
        }

    localization = sections.get("localization")
    if isinstance(localization, list):
        summary["sections"]["localization"] = {
            "rows": len(localization),
            "sources": _count_sources(localization),
            "locations": [row.get("location") for row in localization if row.get("location")],
        }

    phenotypes = sections.get("mouse_phenotypes")
    if isinstance(phenotypes, list):
        summary["sections"]["mouse_phenotypes"] = {"rows": len(phenotypes)}
    return summary


def _section_files(
    profile: dict[str, Any],
) -> tuple[dict[str, list[dict[str, Any]] | dict[str, Any]], list[dict[str, Any]]]:
    sections: dict[str, list[dict[str, Any]] | dict[str, Any]] = {
        "target": _compact_sources(profile["target"]),
    }
    if "expression" in profile:
        sections["expression"] = _compact_sources(profile["expression"])
    if "tractability" in profile:
        sections["tractability"] = _compact_sources(profile["tractability"])
    if "safety_liabilities" in profile:
        sections["safety"] = _compact_sources(profile["safety_liabilities"])
    depmap_rows: list[dict[str, Any]] = []
    if "essentiality" in profile:
        essentiality = _compact_sources(profile["essentiality"])
        depmap_rows = _flatten_depmap(essentiality)
        essentiality = dict(essentiality)
        essentiality.pop("depmap", None)
        sections["essentiality"] = essentiality
        sections["depmap"] = depmap_rows
    if "subcellular_locations" in profile:
        sections["localization"] = _compact_sources(profile["subcellular_locations"])
    if "mouse_phenotypes" in profile:
        sections["mouse_phenotypes"] = _compact_sources(profile["mouse_phenotypes"])
    return sections, depmap_rows


def _section_filename(name: str) -> str:
    return f"{name}.jsonl" if name in JSONL_SECTIONS else f"{name}.json"


def _write_profile_directory(profile: dict[str, Any], store: Path) -> tuple[Path, dict[str, Any]]:
    symbol = str(profile["target"]["symbol"])
    data_version = str(profile["provenance"].get("data_version") or "unknown")
    parent = store.expanduser().resolve() / symbol
    final_dir = parent / data_version
    parent.mkdir(parents=True, exist_ok=True)
    staging = parent / f".{data_version}.tmp-{uuid.uuid4().hex}"
    backup = parent / f".{data_version}.backup-{uuid.uuid4().hex}"
    staging.mkdir()

    try:
        sections, depmap_rows = _section_files(profile)
        sources = _source_catalog(profile)
        stored_counts = _stored_source_counts(sections)
        for source_id, source in sources.items():
            source["result_count"] = stored_counts.get(source_id, 0)
        section_manifest: dict[str, dict[str, Any]] = {}
        for name, content in sections.items():
            filename = _section_filename(name)
            path = staging / filename
            if name in JSONL_SECTIONS:
                if not isinstance(content, list):
                    raise ProfileError(f"Section {name} must be a list")
                rows = _write_jsonl(path, content)
                file_format = "jsonl"
            else:
                _write_json(path, content)
                rows = len(content) if isinstance(content, list) else 1
                file_format = "json"
            section_manifest[name] = {
                "file": filename,
                "format": file_format,
                "rows": rows,
                "sha256": _sha256(path),
            }

        _write_json(staging / "sources.json", sources)
        summary = _build_summary(profile, sections, depmap_rows)
        _write_json(staging / "summary.json", summary)
        manifest = {
            "profile_schema_version": PROFILE_SCHEMA_VERSION,
            "normalized_data_schema_version": profile.get("schema_version"),
            "target": {
                "symbol": profile["target"].get("symbol"),
                "ensembl_id": profile["target"].get("ensembl_id"),
            },
            "data_version": profile["provenance"].get("data_version"),
            "retrieved_at": profile["provenance"].get("retrieved_at"),
            "source": "Open Targets Platform",
            "summary_file": "summary.json",
            "sources_file": "sources.json",
            "sections": section_manifest,
            "warnings": profile.get("warnings") or [],
        }
        _write_json(staging / "manifest.json", manifest)

        if final_dir.exists():
            final_dir.rename(backup)
        try:
            staging.rename(final_dir)
        except Exception:
            if backup.exists() and not final_dir.exists():
                backup.rename(final_dir)
            raise
        if backup.exists():
            shutil.rmtree(backup)
        return final_dir, manifest
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProfileError(f"Missing profile file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ProfileError(f"Invalid JSON profile file: {path}") from exc


def _load_manifest(profile_dir: Path) -> tuple[Path, dict[str, Any]]:
    root = profile_dir.expanduser().resolve()
    manifest = _read_json(root / "manifest.json")
    if not isinstance(manifest, dict) or not isinstance(manifest.get("sections"), dict):
        raise ProfileError("Invalid profile manifest")
    return root, manifest


def _safe_member(root: Path, filename: str) -> Path:
    path = (root / filename).resolve()
    if path.parent != root:
        raise ProfileError(f"Unsafe profile path in manifest: {filename}")
    return path


def _load_section(root: Path, manifest: dict[str, Any], section: str) -> Any:
    info = manifest["sections"].get(section)
    if not isinstance(info, dict):
        available = ", ".join(sorted(manifest["sections"]))
        raise ProfileError(f"Section {section!r} is unavailable. Available: {available}")
    path = _safe_member(root, str(info.get("file")))
    if info.get("format") == "jsonl":
        rows = []
        try:
            with path.open(encoding="utf-8") as handle:
                for line_number, line in enumerate(handle, 1):
                    if line.strip():
                        try:
                            rows.append(json.loads(line))
                        except json.JSONDecodeError as exc:
                            raise ProfileError(f"Invalid JSONL at {path}:{line_number}") from exc
        except FileNotFoundError as exc:
            raise ProfileError(f"Missing profile file: {path}") from exc
        return rows
    return _read_json(path)


def _expand_sources(value: Any, catalog: dict[str, Any]) -> Any:
    if isinstance(value, list):
        return [_expand_sources(item, catalog) for item in value]
    if not isinstance(value, dict):
        return value
    expanded = {key: _expand_sources(child, catalog) for key, child in value.items()}
    source_id = expanded.get("source_id")
    if source_id and source_id in catalog:
        expanded["source"] = {"id": source_id, **catalog[source_id]}
    return expanded


def _field(row: dict[str, Any], path: str) -> Any:
    value: Any = row
    for part in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _matches(row: dict[str, Any], args: argparse.Namespace) -> bool:
    if args.source and str(row.get("source_id", "")).casefold() != args.source.casefold():
        return False
    if args.tissue:
        tissue = row.get("tissue") or row.get("tissue_name") or ""
        if args.tissue.casefold() not in str(tissue).casefold():
            return False
    if args.cell_type:
        cell = row.get("cell_type") or row.get("cell_line_name") or ""
        if args.cell_type.casefold() not in str(cell).casefold():
            return False
    for expression in args.where:
        field, expected = expression.split("=", 1)
        actual = _field(row, field)
        if str(actual).casefold() != expected.casefold():
            return False
    for expression in args.contains:
        field, expected = expression.split("=", 1)
        actual = _field(row, field)
        if expected.casefold() not in str(actual or "").casefold():
            return False
    return True


def _sort_key(value: Any) -> tuple[int, Any]:
    if value is None:
        return (2, "")
    if isinstance(value, (int, float)):
        return (0, value)
    return (1, str(value).casefold())


def _parse_key_value(value: str) -> str:
    if "=" not in value or not value.split("=", 1)[0].strip():
        raise argparse.ArgumentTypeError("expected FIELD=VALUE")
    return value


def _parse_sections(value: str) -> tuple[str, ...]:
    sections = tuple(part.strip().lower() for part in value.split(",") if part.strip())
    unknown = set(sections) - VALID_SECTIONS
    if not sections or unknown:
        detail = f"; unknown: {', '.join(sorted(unknown))}" if unknown else ""
        raise argparse.ArgumentTypeError(f"invalid section list{detail}")
    return sections


def _print_json(value: Any, compact: bool) -> None:
    sys.stdout.write(
        json.dumps(
            value,
            ensure_ascii=False,
            indent=None if compact else 2,
            separators=(",", ":") if compact else None,
        )
        + "\n"
    )


def _fetch_command(args: argparse.Namespace) -> None:
    print("Fetching and sectioning Open Targets target profile...", file=sys.stderr)
    profile = get_target_profile(
        target=args.target,
        ensembl_id=args.ensembl_id,
        sections=args.sections,
        max_expression_rows=args.max_expression_rows,
        expression_page_size=args.expression_page_size,
        timeout=args.timeout,
    )
    profile_dir, manifest = _write_profile_directory(profile, args.store)
    result = {
        "status": "complete",
        "target": manifest["target"],
        "data_version": manifest["data_version"],
        "profile_dir": str(profile_dir),
        "manifest": str(profile_dir / "manifest.json"),
        "summary": str(profile_dir / "summary.json"),
        "sections": {
            name: {"file": info["file"], "rows": info["rows"]}
            for name, info in manifest["sections"].items()
        },
        "warnings": manifest["warnings"],
    }
    _print_json(result, args.compact)


def _summary_command(args: argparse.Namespace) -> None:
    root, manifest = _load_manifest(args.profile)
    summary = _read_json(_safe_member(root, str(manifest.get("summary_file"))))
    summary["profile_dir"] = str(root)
    _print_json(summary, args.compact)


def _query_command(args: argparse.Namespace) -> None:
    if args.limit < 1 or args.limit > MAX_QUERY_ROWS:
        raise ProfileError(f"limit must be between 1 and {MAX_QUERY_ROWS}")
    if args.offset < 0:
        raise ProfileError("offset must be non-negative")
    root, manifest = _load_manifest(args.profile)
    value = _load_section(root, manifest, args.section)
    rows = value if isinstance(value, list) else [value]
    rows = [row for row in rows if isinstance(row, dict) and _matches(row, args)]
    if args.sort:
        rows.sort(key=lambda row: _sort_key(_field(row, args.sort)), reverse=args.descending)
    total = len(rows)
    page = rows[args.offset : args.offset + args.limit]
    catalog = _read_json(_safe_member(root, str(manifest.get("sources_file"))))
    page = _expand_sources(page, catalog)
    next_offset = args.offset + len(page)
    result = {
        "profile_dir": str(root),
        "section": args.section,
        "total_matches": total,
        "offset": args.offset,
        "limit": args.limit,
        "returned": len(page),
        "next_offset": next_offset if next_offset < total else None,
        "results": page,
    }
    _print_json(result, args.compact)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Fetch and query sectioned Open Targets profiles")
    subparsers = parser.add_subparsers(dest="command", required=True)

    fetch = subparsers.add_parser("fetch", help="Fetch and save a sectioned target profile")
    identity = fetch.add_mutually_exclusive_group(required=True)
    identity.add_argument("--target", help="Exact approved gene symbol")
    identity.add_argument("--ensembl-id", help="Ensembl target ID")
    fetch.add_argument("--sections", type=_parse_sections, default=DEFAULT_SECTIONS)
    fetch.add_argument("--store", type=Path, default=DEFAULT_STORE)
    fetch.add_argument("--max-expression-rows", type=int, default=10000)
    fetch.add_argument("--expression-page-size", type=int, default=500)
    fetch.add_argument("--timeout", type=float, default=60.0)
    fetch.add_argument("--compact", action="store_true")
    fetch.set_defaults(handler=_fetch_command)

    summary = subparsers.add_parser("summary", help="Read a saved profile summary")
    summary.add_argument("--profile", type=Path, required=True)
    summary.add_argument("--compact", action="store_true")
    summary.set_defaults(handler=_summary_command)

    query = subparsers.add_parser("query", help="Query one saved profile section")
    query.add_argument("--profile", type=Path, required=True)
    query.add_argument(
        "--section",
        required=True,
        choices=(
            "target",
            "expression",
            "tractability",
            "safety",
            "essentiality",
            "depmap",
            "localization",
            "mouse_phenotypes",
        ),
    )
    query.add_argument("--source")
    query.add_argument("--tissue")
    query.add_argument("--cell-type")
    query.add_argument("--where", action="append", type=_parse_key_value, default=[])
    query.add_argument("--contains", action="append", type=_parse_key_value, default=[])
    query.add_argument("--sort")
    query.add_argument("--descending", action="store_true")
    query.add_argument("--limit", type=int, default=20)
    query.add_argument("--offset", type=int, default=0)
    query.add_argument("--compact", action="store_true")
    query.set_defaults(handler=_query_command)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        args.handler(args)
        return 0
    except (OpenTargetsError, ProfileError, ValueError, OSError) as exc:
        print(f"target_profile: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
