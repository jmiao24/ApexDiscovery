#!/usr/bin/env python3
"""Focused ClinVar lookup CLI using only NCBI E-utilities and stdlib."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any


BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
TOOL = "apex_science_clinvar"
_LAST_REQUEST = 0.0

STAR_MAP = {
    "practice guideline": 4,
    "reviewed by expert panel": 3,
    "criteria provided, multiple submitters, no conflicts": 2,
    "criteria provided, multiple submitters": 2,
    "criteria provided, conflicting classifications": 1,
    "criteria provided, single submitter": 1,
    "no assertion criteria provided": 0,
    "no classification provided": 0,
    "no classification for the individual variant": 0,
}


def text_of(node: ET.Element | None, path: str, default: str = "") -> str:
    if node is None:
        return default
    value = node.findtext(path)
    return value.strip() if value else default


def unique(values: list[Any]) -> list[Any]:
    output: list[Any] = []
    seen: set[str] = set()
    for value in values:
        key = json.dumps(value, sort_keys=True, ensure_ascii=False)
        if key not in seen:
            seen.add(key)
            output.append(value)
    return output


class EUtilsClient:
    def __init__(self, email: str | None, api_key: str | None, timeout: int = 30):
        self.email = email
        self.api_key = api_key
        self.timeout = timeout

    def request(self, endpoint: str, params: dict[str, Any]) -> bytes:
        global _LAST_REQUEST
        minimum_interval = 0.11 if self.api_key else 0.34
        elapsed = time.monotonic() - _LAST_REQUEST
        if elapsed < minimum_interval:
            time.sleep(minimum_interval - elapsed)

        query: dict[str, Any] = {"tool": TOOL, **params}
        if self.email:
            query["email"] = self.email
        if self.api_key:
            query["api_key"] = self.api_key
        url = f"{BASE_URL}/{endpoint}?{urllib.parse.urlencode(query)}"
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json, application/xml;q=0.9, */*;q=0.1",
                "User-Agent": f"{TOOL}/1.0 ({self.email or 'contact-not-configured'})",
            },
        )
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    payload = response.read()
                _LAST_REQUEST = time.monotonic()
                return payload
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
                last_error = exc
                if attempt == 2 or (
                    isinstance(exc, urllib.error.HTTPError)
                    and exc.code not in {429, 500, 502, 503, 504}
                ):
                    break
                time.sleep(2**attempt)
        raise RuntimeError(f"NCBI request failed for {endpoint}: {last_error}")

    def json(self, endpoint: str, params: dict[str, Any]) -> dict[str, Any]:
        payload = self.request(endpoint, params)
        try:
            data = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"NCBI returned invalid JSON for {endpoint}: {exc}") from exc
        if isinstance(data, dict) and data.get("error"):
            raise RuntimeError(f"NCBI error: {data['error']}")
        return data


def stars(review_status: str) -> int | None:
    return STAR_MAP.get(review_status.strip().lower()) if review_status else None


def classification(
    description: str,
    review_status: str,
    last_evaluated: str = "",
    submissions: str | int | None = None,
    submitters: str | int | None = None,
) -> dict[str, Any] | None:
    if last_evaluated.startswith("1/01/01"):
        last_evaluated = ""
    if not any((description, review_status, last_evaluated)):
        return None
    lowered = f"{description} {review_status}".lower()
    result: dict[str, Any] = {
        "description": description or None,
        "review_status": review_status or None,
        "stars": stars(review_status),
        "has_conflict": "conflict" in lowered,
        "last_evaluated": last_evaluated or None,
    }
    if submissions not in (None, ""):
        result["submission_count"] = int(submissions)
    if submitters not in (None, ""):
        result["submitter_count"] = int(submitters)
    return result


def normalize_summary(uid: str, item: dict[str, Any]) -> dict[str, Any]:
    variation_set = item.get("variation_set") or []
    first_variation = variation_set[0] if variation_set else {}
    classifications = {
        "germline": classification(
            item.get("germline_classification", {}).get("description", ""),
            item.get("germline_classification", {}).get("review_status", ""),
            item.get("germline_classification", {}).get("last_evaluated", ""),
        ),
        "somatic_clinical_impact": classification(
            item.get("clinical_impact_classification", {}).get("description", ""),
            item.get("clinical_impact_classification", {}).get("review_status", ""),
            item.get("clinical_impact_classification", {}).get("last_evaluated", ""),
        ),
        "oncogenicity": classification(
            item.get("oncogenicity_classification", {}).get("description", ""),
            item.get("oncogenicity_classification", {}).get("review_status", ""),
            item.get("oncogenicity_classification", {}).get("last_evaluated", ""),
        ),
    }
    classifications = {key: value for key, value in classifications.items() if value}
    accession = item.get("accession") or f"VCV{int(uid):09d}"
    return {
        "variation_id": int(uid),
        "accession": accession,
        "accession_version": item.get("accession_version") or None,
        "title": item.get("title") or None,
        "variant_type": item.get("obj_type") or first_variation.get("variant_type") or None,
        "genes": unique(
            [
                {"symbol": gene.get("symbol"), "gene_id": gene.get("geneid") or None}
                for gene in item.get("genes", [])
                if gene.get("symbol")
            ]
        ),
        "canonical_spdi": first_variation.get("canonical_spdi") or None,
        "xrefs": unique(
            [
                {"database": xref.get("db_source"), "id": xref.get("db_id")}
                for variation in variation_set
                for xref in variation.get("variation_xrefs", [])
            ]
        ),
        "locations": unique(
            [
                {
                    "assembly": loc.get("assembly_name"),
                    "chromosome": loc.get("chr"),
                    "start": int(loc["start"]) if loc.get("start", "").isdigit() else None,
                    "stop": int(loc["stop"]) if loc.get("stop", "").isdigit() else None,
                    "status": loc.get("status") or None,
                }
                for variation in variation_set
                for loc in variation.get("variation_loc", [])
            ]
        ),
        "classifications": classifications,
        "supporting_submissions": item.get("supporting_submissions") or {},
        "clinvar_url": f"https://www.ncbi.nlm.nih.gov/clinvar/variation/{accession}/",
    }


def search(client: EUtilsClient, term: str, limit: int, start: int) -> dict[str, Any]:
    response = client.json(
        "esearch.fcgi",
        {
            "db": "clinvar",
            "term": term,
            "retmode": "json",
            "retmax": limit,
            "retstart": start,
        },
    )
    result = response.get("esearchresult", {})
    ids = result.get("idlist", [])
    records: list[dict[str, Any]] = []
    if ids:
        summary = client.json(
            "esummary.fcgi",
            {
                "db": "clinvar",
                "id": ",".join(ids),
                "retmode": "json",
                "version": "2.0",
            },
        ).get("result", {})
        records = [normalize_summary(uid, summary.get(uid, {})) for uid in ids]
    return {
        "query": term,
        "total_count": int(result.get("count", 0)),
        "start": start,
        "returned": len(records),
        "records": records,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }


def normalize_vcv(value: str) -> str:
    value = value.strip().upper()
    if value.isdigit():
        return f"VCV{int(value):09d}"
    if value.startswith("VCV"):
        base, dot, version = value.partition(".")
        digits = base[3:]
        if not digits.isdigit() or (dot and not version.isdigit()):
            raise ValueError(f"Invalid VCV accession: {value}")
        return f"VCV{int(digits):09d}" + (f".{version}" if dot else "")
    raise ValueError("record and compare accept a Variation ID or VCV accession; use an RCV-specific EFetch workflow for RCV records")


def citation_items(node: ET.Element, limit: int) -> list[dict[str, Any]]:
    citations: list[dict[str, Any]] = []
    for citation_node in node.findall(".//Citation"):
        item: dict[str, Any] = {}
        if citation_node.get("Type"):
            item["type"] = citation_node.get("Type")
        if citation_node.get("Abbrev"):
            item["label"] = citation_node.get("Abbrev")
        identifiers = [
            {"source": child.get("Source"), "id": (child.text or "").strip()}
            for child in citation_node.findall("./ID")
            if (child.text or "").strip()
        ]
        if identifiers:
            item["identifiers"] = identifiers
        url = text_of(citation_node, "./URL")
        if url:
            item["url"] = url
        citation_text = text_of(citation_node, "./CitationText")
        if citation_text:
            item["citation_text"] = citation_text
        if item:
            citations.append(item)
    return unique(citations)[:limit]


def parse_classification_node(node: ET.Element) -> dict[str, Any] | None:
    label = node.tag
    description = text_of(node, "./Description")
    if not description:
        for candidate in ("GermlineClassification", "SomaticClinicalImpact", "OncogenicityClassification"):
            description = text_of(node, f"./{candidate}")
            if description:
                label = candidate
                break
    result = classification(
        description,
        text_of(node, "./ReviewStatus"),
        node.get("DateLastEvaluated", ""),
        node.get("NumberOfSubmissions"),
        node.get("NumberOfSubmitters"),
    )
    if result:
        result["type"] = label
    return result


def parse_conditions(classified: ET.Element) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for rcv in classified.findall("./RCVList/RCVAccession"):
        classifications: list[dict[str, Any]] = []
        for node in rcv.findall("./RCVClassifications/*"):
            parsed = parse_classification_node(node)
            if parsed:
                classifications.append(parsed)
        output.append(
            {
                "accession": rcv.get("Accession"),
                "version": int(rcv.get("Version", "0")) or None,
                "conditions": unique(
                    [
                        (node.text or "").strip()
                        for node in rcv.findall("./ClassifiedConditionList/ClassifiedCondition")
                        if (node.text or "").strip()
                    ]
                ),
                "classifications": classifications,
                "clinvar_url": f"https://www.ncbi.nlm.nih.gov/clinvar/{rcv.get('Accession')}/",
            }
        )
    return output


def parse_submissions(classified: ET.Element, limit: int, citation_limit: int) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for assertion in classified.findall("./ClinicalAssertionList/ClinicalAssertion"):
        accession = assertion.find("./ClinVarAccession")
        if accession is None:
            continue
        classification_node = assertion.find("./Classification")
        parsed_classification = parse_classification_node(classification_node) if classification_node is not None else None
        assertion_methods = [
            (node.text or "").strip()
            for node in assertion.findall("./AttributeSet/Attribute[@Type='AssertionMethod']")
            if (node.text or "").strip()
        ]
        conditions = [
            (node.text or "").strip()
            for node in assertion.findall("./TraitSet/Trait/Name/ElementValue[@Type='Preferred']")
            if (node.text or "").strip()
        ]
        output.append(
            {
                "accession": accession.get("Accession"),
                "version": int(accession.get("Version", "0")) or None,
                "submitter": accession.get("SubmitterName"),
                "organization_id": accession.get("OrgID"),
                "organization_category": accession.get("OrganizationCategory"),
                "date_updated": accession.get("DateUpdated") or assertion.get("DateLastUpdated"),
                "submission_date": assertion.get("SubmissionDate"),
                "contributes_to_aggregate": assertion.get("ContributesToAggregateClassification") == "true",
                "classification": parsed_classification,
                "conditions": unique(conditions),
                "assertion_methods": unique(assertion_methods),
                "citations": citation_items(assertion, citation_limit),
            }
        )
    output.sort(key=lambda item: item.get("date_updated") or "", reverse=True)
    return output[:limit]


def parse_vcv(xml_payload: bytes, submission_limit: int, citation_limit: int) -> dict[str, Any]:
    try:
        root = ET.fromstring(xml_payload)
    except ET.ParseError as exc:
        raise RuntimeError(f"ClinVar returned invalid VCV XML: {exc}") from exc
    archive = root.find("./VariationArchive")
    if archive is None:
        error_text = " ".join(part.strip() for part in root.itertext() if part.strip())
        raise RuntimeError(f"VCV record not found or unavailable: {error_text[:300]}")
    classified = archive.find("./ClassifiedRecord")
    simple = classified.find("./SimpleAllele") if classified is not None else None

    aggregate: dict[str, Any] = {}
    if classified is not None:
        for node in classified.findall("./Classifications/*"):
            parsed = parse_classification_node(node)
            if parsed:
                key = {
                    "GermlineClassification": "germline",
                    "SomaticClinicalImpact": "somatic_clinical_impact",
                    "OncogenicityClassification": "oncogenicity",
                }.get(node.tag, node.tag)
                aggregate[key] = parsed

    genes = []
    if simple is not None:
        genes = [
            {
                "symbol": gene.get("Symbol"),
                "name": gene.get("FullName"),
                "gene_id": gene.get("GeneID"),
                "hgnc_id": gene.get("HGNC_ID"),
            }
            for gene in simple.findall("./GeneList/Gene")
        ]
    xrefs = []
    if simple is not None:
        xrefs = [
            {"database": node.get("DB"), "id": node.get("ID"), "type": node.get("Type")}
            for node in simple.findall(".//XRef")
            if node.get("DB") and node.get("ID")
        ]
    locations = []
    if simple is not None:
        for node in simple.findall("./Location/SequenceLocation"):
            locations.append(
                {
                    "assembly": node.get("Assembly"),
                    "assembly_accession": node.get("AssemblyAccessionVersion"),
                    "chromosome": node.get("Chr"),
                    "start": int(node.get("start", "")) if node.get("start", "").isdigit() else None,
                    "stop": int(node.get("stop", "")) if node.get("stop", "").isdigit() else None,
                    "vcf_position": int(node.get("positionVCF", "")) if node.get("positionVCF", "").isdigit() else None,
                    "vcf_ref": node.get("referenceAlleleVCF"),
                    "vcf_alt": node.get("alternateAlleleVCF"),
                    "status": node.get("AssemblyStatus"),
                }
            )
    hgvs = []
    if simple is not None:
        hgvs = [
            (node.text or "").strip()
            for node in simple.findall("./HGVSlist/HGVS/*/Expression")
            if (node.text or "").strip()
        ]

    accession = archive.get("Accession")
    version = int(archive.get("Version", "0")) or None
    return {
        "variation": {
            "accession": accession,
            "version": version,
            "accession_version": f"{accession}.{version}" if accession and version else accession,
            "variation_id": int(archive.get("VariationID", "0")) or None,
            "allele_id": int(simple.get("AlleleID", "0")) if simple is not None and simple.get("AlleleID", "").isdigit() else None,
            "name": archive.get("VariationName"),
            "variant_type": archive.get("VariationType") or text_of(simple, "./VariantType"),
            "record_type": archive.get("RecordType"),
            "record_status": text_of(archive, "./RecordStatus"),
            "date_created": archive.get("DateCreated"),
            "date_last_updated": archive.get("DateLastUpdated"),
            "most_recent_submission": archive.get("MostRecentSubmission"),
            "submission_count": int(archive.get("NumberOfSubmissions", "0")),
            "submitter_count": int(archive.get("NumberOfSubmitters", "0")),
            "canonical_spdi": text_of(simple, "./CanonicalSPDI"),
            "genes": genes,
            "hgvs": unique(hgvs),
            "xrefs": unique(xrefs),
            "locations": locations,
        },
        "aggregate_classifications": aggregate,
        "condition_records": parse_conditions(classified) if classified is not None else [],
        "aggregate_citations": citation_items(classified.find("./Classifications"), citation_limit)
        if classified is not None and classified.find("./Classifications") is not None
        else [],
        "submissions": parse_submissions(classified, submission_limit, 5) if classified is not None else [],
        "clinvar_url": f"https://www.ncbi.nlm.nih.gov/clinvar/variation/{accession}/",
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }


def fetch_record(
    client: EUtilsClient, accession: str, submission_limit: int, citation_limit: int
) -> dict[str, Any]:
    normalized = normalize_vcv(accession)
    payload = client.request(
        "efetch.fcgi",
        {"db": "clinvar", "rettype": "vcv", "retmode": "xml", "id": normalized},
    )
    return parse_vcv(payload, submission_limit, citation_limit)


def flatten(value: Any, prefix: str = "") -> dict[str, Any]:
    output: dict[str, Any] = {}
    if isinstance(value, dict):
        for key in sorted(value):
            if key in {"retrieved_at", "clinvar_url", "aggregate_citations", "submissions"}:
                continue
            path = f"{prefix}.{key}" if prefix else key
            output.update(flatten(value[key], path))
    elif isinstance(value, list):
        output[prefix] = value
    else:
        output[prefix] = value
    return output


def compare_records(client: EUtilsClient, before: str, after: str) -> dict[str, Any]:
    before_record = fetch_record(client, before, 0, 0)
    after_record = fetch_record(client, after, 0, 0)
    before_flat = flatten(before_record)
    after_flat = flatten(after_record)
    changes = []
    for path in sorted(set(before_flat) | set(after_flat)):
        old = before_flat.get(path)
        new = after_flat.get(path)
        if old != new:
            changes.append({"field": path, "before": old, "after": new})
    return {
        "before": before_record["variation"]["accession_version"],
        "after": after_record["variation"]["accession_version"],
        "change_count": len(changes),
        "changes": changes,
        "note": "Submission and citation lists are excluded from this structural diff; inspect the source versions for evidence-level changes.",
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
    }


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        description="Query and normalize focused NCBI ClinVar records.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  clinvar.py search --variant rs113993960 --limit 5
  clinvar.py search --gene BRCA1 --limit 10
  clinvar.py search --condition 'cystic fibrosis' --limit 10
  clinvar.py search 'BRCA1[gene] AND pathogenic[clinsig]' --limit 10
  clinvar.py record VCV000007105 --submissions 10 --citations 20
  clinvar.py compare VCV000007105.206 VCV000007105.207
""",
    )
    root.add_argument("--email", default=os.getenv("NCBI_EMAIL"), help="NCBI contact email (or NCBI_EMAIL)")
    root.add_argument("--api-key", default=os.getenv("NCBI_API_KEY"), help="NCBI API key (or NCBI_API_KEY)")
    root.add_argument("--timeout", type=int, default=30)
    commands = root.add_subparsers(dest="command", required=True)

    search_parser = commands.add_parser("search", help="Search ClinVar and return normalized summaries")
    search_parser.add_argument("query", nargs="?", help="Raw Entrez query")
    group = search_parser.add_mutually_exclusive_group()
    group.add_argument("--gene", help="Gene symbol or Gene ID")
    group.add_argument("--condition", help="Condition/disease name")
    group.add_argument("--variant", help="rsID, HGVS, coordinate, accession, or variant text")
    search_parser.add_argument("--limit", type=int, default=10, choices=range(1, 101), metavar="1..100")
    search_parser.add_argument("--start", type=int, default=0)

    record_parser = commands.add_parser("record", help="Fetch and normalize a full VCV XML record")
    record_parser.add_argument("accession", help="Variation ID or VCV accession, optionally versioned")
    record_parser.add_argument("--submissions", type=int, default=20, choices=range(0, 501), metavar="0..500")
    record_parser.add_argument("--citations", type=int, default=25, choices=range(0, 501), metavar="0..500")

    compare_parser = commands.add_parser("compare", help="Compare two explicit VCV versions")
    compare_parser.add_argument("before", help="Earlier versioned VCV accession")
    compare_parser.add_argument("after", help="Later versioned VCV accession")
    return root


def main() -> int:
    args = parser().parse_args()
    if not args.email:
        print(
            "warning: set NCBI_EMAIL or pass --email so NCBI can identify the E-utilities client",
            file=sys.stderr,
        )
    client = EUtilsClient(args.email, args.api_key, args.timeout)
    try:
        if args.command == "search":
            if args.gene:
                term = f"{args.gene}[gene]"
            elif args.condition:
                escaped = args.condition.replace('"', "")
                term = f'"{escaped}"[disease]'
            elif args.variant:
                term = args.variant
            elif args.query:
                term = args.query
            else:
                raise ValueError("search requires a query or one of --gene, --condition, or --variant")
            result = search(client, term, args.limit, args.start)
        elif args.command == "record":
            result = fetch_record(client, args.accession, args.submissions, args.citations)
        else:
            if "." not in args.before or "." not in args.after:
                raise ValueError("compare requires two explicit versioned VCV accessions")
            result = compare_records(client, args.before, args.after)
    except (RuntimeError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
