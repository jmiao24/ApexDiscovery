#!/usr/bin/env python3
"""Query and normalize DailyMed REST API v2 label data.

The script is dependency-free. JSON is the only stdout output; progress and
errors are written to stderr so agents can safely compose it with other tools.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET


API_BASE = "https://dailymed.nlm.nih.gov/dailymed/services/v2"
SITE_BASE = "https://dailymed.nlm.nih.gov/dailymed"
SCHEMA_VERSION = "1.0.0"
HL7 = "urn:hl7-org:v3"
NS = {"hl7": HL7}
SETID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

SECTION_CODES = {
    "recent_changes": "43683-2",
    "boxed_warning": "34066-1",
    "indications": "34067-9",
    "dosage": "34068-7",
    "dosage_forms": "43678-2",
    "contraindications": "34070-3",
    "warnings": "43685-7",
    "adverse_reactions": "34084-4",
    "drug_interactions": "34073-7",
    "specific_populations": "43684-0",
    "description": "34089-3",
    "clinical_pharmacology": "34090-1",
    "nonclinical_toxicology": "43680-8",
    "clinical_studies": "34092-7",
    "how_supplied": "34069-5",
    "patient_counseling": "34076-0",
}
DEFAULT_SECTIONS = (
    "indications",
    "dosage",
    "dosage_forms",
    "contraindications",
    "boxed_warning",
    "warnings",
    "adverse_reactions",
)


class DailyMedError(RuntimeError):
    """Raised when DailyMed retrieval or response validation fails."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _request_bytes(url: str, *, timeout: float, retries: int = 2) -> bytes:
    request = Request(
        url,
        headers={
            "Accept": "application/json, application/xml, text/xml, application/zip",
            "User-Agent": "apex-dailymed-skill/1.0",
        },
    )
    for attempt in range(retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read()
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:1000]
            retryable = exc.code == 429 or 500 <= exc.code < 600
            if attempt >= retries or not retryable:
                raise DailyMedError(
                    f"DailyMed HTTP {exc.code}: {detail or exc.reason}"
                ) from exc
        except (URLError, TimeoutError) as exc:
            if attempt >= retries:
                raise DailyMedError(f"DailyMed request failed: {exc}") from exc
        time.sleep(0.75 * (2**attempt))
    raise DailyMedError("DailyMed request failed after retries")


def _request_json(
    path: str,
    *,
    params: dict[str, Any] | None = None,
    timeout: float,
) -> tuple[dict[str, Any], str]:
    url = f"{API_BASE}/{path.lstrip('/')}"
    if params:
        query = urlencode(
            {key: value for key, value in params.items() if value is not None}
        )
        if query:
            url = f"{url}?{query}"
    raw = _request_bytes(url, timeout=timeout)
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DailyMedError("DailyMed returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise DailyMedError("DailyMed JSON response was not an object")
    return payload, url


def _validate_setid(value: str) -> str:
    setid = value.strip()
    if not SETID_PATTERN.fullmatch(setid):
        raise ValueError("setid must be a UUID, for example cd61e902-166d-4aa6-9f3c-a18c1008d07e")
    return setid.lower()


def _plain_text(element: ET.Element | None) -> str:
    if element is None:
        return ""
    return " ".join(" ".join(element.itertext()).split())


def _attr(element: ET.Element | None, name: str) -> str | None:
    if element is None:
        return None
    value = element.get(name)
    return value.strip() if value and value.strip() else None


def _dedupe_dicts(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        key = json.dumps(row, sort_keys=True, ensure_ascii=False)
        if key not in seen:
            seen.add(key)
            output.append(row)
    return output


def _parse_sections(root: ET.Element) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    for section in root.findall(".//hl7:section", NS):
        code_element = section.find("hl7:code", NS)
        code = _attr(code_element, "code")
        text_chunks: list[str] = []
        direct_text = _plain_text(section.find("hl7:text", NS))
        if direct_text:
            text_chunks.append(direct_text)
        for child in section.findall(".//hl7:section", NS):
            child_text = _plain_text(child.find("hl7:text", NS))
            if child_text:
                child_title = _plain_text(child.find("hl7:title", NS))
                text_chunks.append(
                    f"{child_title}\n{child_text}" if child_title else child_text
                )
        text = "\n\n".join(text_chunks)
        if not code or not text:
            continue
        sections.append(
            {
                "code": code,
                "display_name": _attr(code_element, "displayName"),
                "title": _plain_text(section.find("hl7:title", NS)) or None,
                "text": text,
            }
        )
    return sections


def _application_numbers(root: ET.Element) -> list[dict[str, str | None]]:
    rows: list[dict[str, str | None]] = []
    for approval in root.findall(".//hl7:approval", NS):
        identifier = approval.find("hl7:id", NS)
        code = approval.find("hl7:code", NS)
        number = _attr(identifier, "extension") or _attr(identifier, "root")
        if number:
            rows.append(
                {
                    "application_number": number,
                    "application_type": _attr(code, "displayName"),
                }
            )
    return _dedupe_dicts(rows)


def _parse_spl(xml_bytes: bytes) -> dict[str, Any]:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise DailyMedError("DailyMed returned invalid SPL XML") from exc

    setid = _attr(root.find("hl7:setId", NS), "root")
    document_id = _attr(root.find("hl7:id", NS), "root")
    version_value = _attr(root.find("hl7:versionNumber", NS), "value")
    effective_time = _attr(root.find("hl7:effectiveTime", NS), "value")
    document_code = root.find("hl7:code", NS)
    labeler = _plain_text(
        root.find(
            ".//hl7:author/hl7:assignedEntity/hl7:representedOrganization/hl7:name",
            NS,
        )
    )
    return {
        "label": {
            "title": _plain_text(root.find("hl7:title", NS)) or None,
            "setid": setid,
            "document_id": document_id,
            "label_type": _attr(document_code, "displayName"),
            "label_type_code": _attr(document_code, "code"),
            "spl_version": int(version_value) if version_value and version_value.isdigit() else version_value,
            "effective_time": effective_time,
            "labeler": labeler or None,
            "application_numbers": _application_numbers(root),
        },
        "sections": _parse_sections(root),
    }


def _current_xml(setid: str, *, timeout: float) -> tuple[bytes, str]:
    url = f"{API_BASE}/spls/{setid}.xml"
    return _request_bytes(url, timeout=timeout), url


def _historical_xml(setid: str, version: int, *, timeout: float) -> tuple[bytes, str]:
    params = urlencode({"type": "zip", "setid": setid, "version": version})
    url = f"{SITE_BASE}/getFile.cfm?{params}"
    raw = _request_bytes(url, timeout=timeout)
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = [name for name in archive.namelist() if name.lower().endswith(".xml")]
            if not names:
                raise DailyMedError("Historical DailyMed ZIP contained no SPL XML")
            return archive.read(names[0]), url
    except zipfile.BadZipFile as exc:
        raise DailyMedError("DailyMed returned an invalid historical ZIP") from exc


def _official_links(setid: str) -> dict[str, str]:
    return {
        "dailymed": f"{SITE_BASE}/drugInfo.cfm?setid={setid}",
        "spl_xml": f"{API_BASE}/spls/{setid}.xml",
        "pdf": f"{SITE_BASE}/downloadpdffile.cfm?setId={setid}",
        "zip": f"{SITE_BASE}/downloadzipfile.cfm?setId={setid}",
    }


def search_labels(
    *,
    filters: dict[str, Any],
    limit: int,
    page: int,
    timeout: float,
) -> dict[str, Any]:
    params = {**filters, "pagesize": limit, "page": page}
    payload, url = _request_json("spls.json", params=params, timeout=timeout)
    metadata = payload.get("metadata") or {}
    rows = payload.get("data") or []
    if not isinstance(rows, list):
        raise DailyMedError("DailyMed search response did not contain a result list")
    results = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        setid = row.get("setid")
        results.append(
            {
                "title": row.get("title"),
                "setid": setid,
                "spl_version": row.get("spl_version"),
                "published_date": row.get("published_date"),
                "links": _official_links(setid) if isinstance(setid, str) else None,
            }
        )
    return {
        "query": filters,
        "results": results,
        "result_count": metadata.get("total_elements", len(results)),
        "page": metadata.get("current_page", page),
        "total_pages": metadata.get("total_pages"),
        "provenance": {
            "source": "DailyMed",
            "api_url": url,
            "database_published_date": metadata.get("db_published_date"),
            "retrieved_at": _utc_now(),
        },
    }


def get_history(setid: str, *, timeout: float) -> dict[str, Any]:
    payload, url = _request_json(
        f"spls/{setid}/history.json", timeout=timeout
    )
    data = payload.get("data") or {}
    metadata = payload.get("metadata") or {}
    return {
        "label": data.get("spl"),
        "history": data.get("history") or [],
        "links": _official_links(setid),
        "provenance": {
            "source": "DailyMed",
            "api_url": url,
            "database_published_date": metadata.get("db_published_date"),
            "retrieved_at": _utc_now(),
        },
    }


def _bounded_sections(
    sections: list[dict[str, Any]],
    *,
    aliases: tuple[str, ...],
    max_chars: int,
) -> tuple[dict[str, Any], list[str]]:
    output: dict[str, Any] = {}
    warnings: list[str] = []
    for alias in aliases:
        code = SECTION_CODES[alias]
        matches = [row for row in sections if row["code"] == code]
        if not matches:
            output[alias] = None
            warnings.append(
                f"Requested section {alias!r} ({code}) was not present in the selected SPL."
            )
            continue
        chunks = []
        for row in matches:
            title = row.get("title")
            chunks.append(f"{title}\n{row['text']}" if title else row["text"])
        complete_text = "\n\n".join(chunks)
        truncated = len(complete_text) > max_chars
        text = complete_text[:max_chars]
        if truncated:
            text = text.rstrip() + " …"
            warnings.append(
                f"Section {alias!r} was truncated to {max_chars} of {len(complete_text)} characters."
            )
        output[alias] = {
            "code": code,
            "display_name": matches[0].get("display_name"),
            "titles": [row.get("title") for row in matches if row.get("title")],
            "text": text,
            "characters": len(complete_text),
            "truncated": truncated,
        }
    return output, warnings


def _safe_current_resource(
    path: str,
    *,
    timeout: float,
    warnings: list[str],
    label: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None]:
    try:
        payload, url = _request_json(path, timeout=timeout)
        return payload.get("data"), payload.get("metadata"), url
    except DailyMedError as exc:
        warnings.append(f"Could not retrieve current {label}: {exc}")
        return None, None, None


def get_profile(
    *,
    setid: str,
    version: int | None,
    aliases: tuple[str, ...],
    max_section_chars: int,
    timeout: float,
) -> dict[str, Any]:
    warnings = [
        "DailyMed provides company-submitted current in-use labeling, which can differ from the last FDA-approved labeling and approval documents in Drugs@FDA.",
        "This normalized output is evidence retrieval, not prescribing or treatment advice; consult the complete current label and a qualified clinician for clinical decisions.",
    ]
    if version is None:
        xml_bytes, xml_url = _current_xml(setid, timeout=timeout)
    else:
        xml_bytes, xml_url = _historical_xml(setid, version, timeout=timeout)
    parsed = _parse_spl(xml_bytes)
    parsed_setid = parsed["label"].get("setid")
    if parsed_setid and str(parsed_setid).lower() != setid.lower():
        raise DailyMedError(
            f"SPL SETID mismatch: requested {setid}, received {parsed_setid}"
        )
    if version is not None and parsed["label"].get("spl_version") != version:
        warnings.append(
            f"Requested historical version {version}, but the SPL reports version {parsed['label'].get('spl_version')}."
        )

    bounded, section_warnings = _bounded_sections(
        parsed["sections"], aliases=aliases, max_chars=max_section_chars
    )
    warnings.extend(section_warnings)

    history_data, history_meta, history_url = _safe_current_resource(
        f"spls/{setid}/history.json",
        timeout=timeout,
        warnings=warnings,
        label="version history",
    )
    products: list[dict[str, Any]] | None = None
    ndcs: list[str] | None = None
    packaging_url: str | None = None
    ndcs_url: str | None = None
    database_published_date = (history_meta or {}).get("db_published_date")

    if version is None:
        packaging_data, packaging_meta, packaging_url = _safe_current_resource(
            f"spls/{setid}/packaging.json",
            timeout=timeout,
            warnings=warnings,
            label="packaging",
        )
        ndc_data, ndc_meta, ndcs_url = _safe_current_resource(
            f"spls/{setid}/ndcs.json",
            timeout=timeout,
            warnings=warnings,
            label="NDCs",
        )
        if isinstance(packaging_data, dict):
            raw_products = packaging_data.get("products") or []
            products = raw_products if isinstance(raw_products, list) else []
            parsed["label"]["title"] = (
                packaging_data.get("title") or parsed["label"].get("title")
            )
            parsed["label"]["published_date"] = packaging_data.get("published_date")
        if isinstance(ndc_data, dict):
            ndcs = [
                str(row.get("ndc"))
                for row in ndc_data.get("ndcs") or []
                if isinstance(row, dict) and row.get("ndc")
            ]
        database_published_date = (
            (packaging_meta or {}).get("db_published_date")
            or (ndc_meta or {}).get("db_published_date")
            or database_published_date
        )
    else:
        if isinstance(history_data, dict):
            for row in history_data.get("history") or []:
                if isinstance(row, dict) and row.get("spl_version") == version:
                    parsed["label"]["published_date"] = row.get("published_date")
                    break
        warnings.append(
            "Current packaging and NDC endpoints were omitted because they do not describe the selected historical SPL version."
        )

    available = []
    for row in parsed["sections"]:
        aliases_for_code = [
            alias for alias, code in SECTION_CODES.items() if code == row["code"]
        ]
        available.append(
            {
                "aliases": aliases_for_code,
                "code": row["code"],
                "display_name": row.get("display_name"),
                "title": row.get("title"),
                "characters": len(row["text"]),
            }
        )

    return {
        "schema_version": SCHEMA_VERSION,
        "label": parsed["label"],
        "products": products,
        "ndcs": ndcs,
        "sections": bounded,
        "available_sections": _dedupe_dicts(available),
        "history": (history_data or {}).get("history")
        if isinstance(history_data, dict)
        else None,
        "links": _official_links(setid),
        "warnings": warnings,
        "provenance": {
            "source": "DailyMed",
            "api_version": "v2",
            "spl_url": xml_url,
            "history_url": history_url,
            "packaging_url": packaging_url,
            "ndcs_url": ndcs_url,
            "database_published_date": database_published_date,
            "retrieved_at": _utc_now(),
            "requested_setid": setid,
            "requested_version": version,
            "selected_sections": list(aliases),
        },
    }


def _sections(value: str) -> tuple[str, ...]:
    aliases = tuple(part.strip().lower() for part in value.split(",") if part.strip())
    if not aliases:
        raise argparse.ArgumentTypeError("at least one section alias is required")
    unknown = set(aliases) - set(SECTION_CODES)
    if unknown:
        raise argparse.ArgumentTypeError(
            "unknown section alias(es): " + ", ".join(sorted(unknown))
        )
    return aliases


def _positive_int(value: str) -> int:
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("value must be positive")
    return number


def _section_chars(value: str) -> int:
    number = _positive_int(value)
    if number < 500 or number > 20000:
        raise argparse.ArgumentTypeError("max section characters must be between 500 and 20000")
    return number


def _add_output_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--output", type=Path, help="Write JSON to a file instead of stdout")
    parser.add_argument("--compact", action="store_true", help="Emit compact JSON")
    parser.add_argument("--timeout", type=float, default=60.0)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Search and normalize DailyMed REST API v2 product labels"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    search = subparsers.add_parser("search", help="Search current SPL labels")
    filters = search.add_argument_group("search filters")
    filters.add_argument("--drug-name")
    filters.add_argument(
        "--name-type", choices=("brand", "generic", "both"), default="both"
    )
    filters.add_argument("--application-number")
    filters.add_argument("--ndc")
    filters.add_argument("--rxcui")
    filters.add_argument("--unii")
    filters.add_argument("--setid")
    filters.add_argument("--labeler")
    filters.add_argument("--boxed-warning", choices=("true", "false"))
    search.add_argument("--limit", type=_positive_int, default=10)
    search.add_argument("--page", type=_positive_int, default=1)
    _add_output_options(search)

    history = subparsers.add_parser("history", help="Retrieve SPL version history")
    history.add_argument("--setid", required=True)
    _add_output_options(history)

    profile = subparsers.add_parser(
        "profile", help="Retrieve bounded normalized label sections and metadata"
    )
    profile.add_argument("--setid", required=True)
    profile.add_argument("--version", type=_positive_int)
    profile.add_argument("--sections", type=_sections, default=DEFAULT_SECTIONS)
    profile.add_argument(
        "--max-section-chars", type=_section_chars, default=6000
    )
    _add_output_options(profile)
    return parser


def _write_json(value: Any, *, output: Path | None, compact: bool) -> None:
    text = json.dumps(
        value,
        ensure_ascii=False,
        indent=None if compact else 2,
        separators=(",", ":") if compact else None,
    ) + "\n"
    if output:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(text, encoding="utf-8")
        print(f"Wrote {output}", file=sys.stderr)
    else:
        sys.stdout.write(text)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "search":
            if args.limit > 100:
                raise ValueError("limit cannot exceed the DailyMed maximum page size of 100")
            name_type = {"brand": "b", "generic": "g", "both": "both"}[args.name_type]
            filters = {
                "drug_name": args.drug_name,
                "name_type": name_type if args.drug_name else None,
                "application_number": args.application_number,
                "ndc": args.ndc,
                "rxcui": args.rxcui,
                "unii_code": args.unii,
                "setid": _validate_setid(args.setid) if args.setid else None,
                "labeler": args.labeler,
                "boxed_warning": args.boxed_warning,
            }
            filters = {key: value for key, value in filters.items() if value is not None}
            if not filters:
                raise ValueError("provide at least one search filter")
            print("Searching DailyMed labels...", file=sys.stderr)
            result = search_labels(
                filters=filters,
                limit=args.limit,
                page=args.page,
                timeout=args.timeout,
            )
        elif args.command == "history":
            setid = _validate_setid(args.setid)
            print("Fetching DailyMed label history...", file=sys.stderr)
            result = get_history(setid, timeout=args.timeout)
        else:
            setid = _validate_setid(args.setid)
            print("Fetching DailyMed label profile...", file=sys.stderr)
            result = get_profile(
                setid=setid,
                version=args.version,
                aliases=args.sections,
                max_section_chars=args.max_section_chars,
                timeout=args.timeout,
            )
        _write_json(result, output=args.output, compact=args.compact)
        return 0
    except (DailyMedError, ValueError, OSError) as exc:
        print(f"dailymed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
