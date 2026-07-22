import { readFile } from "node:fs/promises";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;
const MAX_EVIDENCE = 12;

const PHASE_RANK = {
  unknown: -1,
  preclinical: 0,
  phase_1: 1,
  phase_1_2: 1,
  phase_2: 2,
  phase_2_3: 3,
  phase_3: 3,
  filed: 4,
  approved: 5,
};

function list(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value == null || value === "") return [];
  return String(value).split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function compactAsset(asset) {
  return {
    id: asset.id,
    name: asset.name,
    inn: asset.inn || null,
    targets: asset.targets,
    modality: asset.modality || null,
    phase: asset.phase || "unknown",
    developers: asset.developers,
    regions: asset.regions,
    stopped: Boolean(asset.stopped),
    note: asset.note || null,
    evidence_count: asset.evidence_count,
  };
}

function mergeAsset(target, source) {
  target.name ||= source.name;
  target.inn ||= source.inn;
  target.modality ||= source.modality;
  if ((PHASE_RANK[source.phase] ?? -1) > (PHASE_RANK[target.phase] ?? -1)) target.phase = source.phase;
  target.targets = unique([...target.targets, ...source.targets]);
  target.developers = unique([...target.developers, ...source.developers]);
  target.regions = unique([...target.regions, ...source.regions]);
  target.stopped ||= Boolean(source.stopped);
  target.note ||= source.note;
  target.evidence_count = Math.max(target.evidence_count, Number(source.evidence_count) || 0);
  return target;
}

function asAsset(raw, target = null) {
  return {
    id: String(raw.k || raw.id || raw.name || raw.n || "").trim(),
    name: String(raw.name || raw.n || raw.inn || raw.k || "unknown"),
    inn: raw.inn || null,
    targets: unique([...(target ? [target] : []), ...list(raw.targets), ...list(raw.ot)]),
    modality: raw.modality || raw.m || null,
    phase: raw.phase || raw.p || "unknown",
    developers: unique([...list(raw.developers), ...list(raw.developer), ...list(raw.d)]),
    regions: unique([...list(raw.regions), ...list(raw.r)]),
    stopped: Boolean(raw.stopped),
    note: raw.note || null,
    evidence_count: Number(raw.n_evidence ?? raw.e ?? 0) || 0,
  };
}

export class BiologicUniverse {
  static async fromFile(path) {
    return new BiologicUniverse(JSON.parse(await readFile(path, "utf8")));
  }

  constructor(data) {
    this.data = data;
    this.assets = new Map();
    this.targets = new Map();

    for (const record of data.deepdive?.recs ?? []) {
      this.targets.set(normalize(record.s), record);
      for (const molecule of record.mols ?? []) this.#addAsset(asAsset(molecule, record.s));
    }
    for (const row of data.shelf?.rows ?? []) this.#addAsset(asAsset(row));
    for (const row of data.geo?.rows ?? []) this.#addAsset(asAsset(row));
  }

  #addAsset(asset) {
    if (!asset.id) return;
    const existing = this.assets.get(asset.id);
    this.assets.set(asset.id, existing ? mergeAsset(existing, asset) : asset);
  }

  #resolveAsset(value) {
    const needle = normalize(value);
    if (!needle) return null;
    if (this.assets.has(value)) return this.assets.get(value);
    return [...this.assets.values()].find((asset) =>
      [asset.id, asset.name, asset.inn].some((candidate) => normalize(candidate) === needle),
    ) ?? null;
  }

  #evidence(ids) {
    const rows = [];
    for (const id of ids) {
      for (const source of this.data.ev?.[id] ?? []) {
        rows.push({
          asset_id: id,
          source_type: source.s,
          label: source.label,
          detail: source.detail || null,
          url: source.url || null,
        });
      }
    }
    return rows.slice(0, MAX_EVIDENCE);
  }

  #compactWithSources(asset) {
    return {
      ...compactAsset(asset),
      sources: (this.data.ev?.[asset.id] ?? []).slice(0, 3).map((source) => ({
        source_type: source.s,
        label: source.label,
        detail: source.detail || null,
        url: source.url || null,
      })),
    };
  }

  #matches(asset, input) {
    const query = normalize(input.query);
    if (query) {
      const haystack = normalize([
        asset.id,
        asset.name,
        asset.inn,
        asset.modality,
        ...asset.targets,
        ...asset.developers,
        ...asset.regions,
        asset.note,
      ].join(" "));
      if (!query.split(/\s+/).every((term) => haystack.includes(term))) return false;
    }
    const targets = (input.targets ?? []).map(normalize);
    if (targets.length && !targets.some((target) => asset.targets.some((value) => normalize(value) === target))) return false;
    const modalities = (input.modalities ?? []).map(normalize);
    if (modalities.length && !modalities.includes(normalize(asset.modality))) return false;
    const phases = (input.phases ?? []).map(normalize);
    if (phases.length && !phases.includes(normalize(asset.phase))) return false;
    const regions = (input.regions ?? []).map(normalize);
    if (regions.length && !regions.some((region) => asset.regions.some((value) => normalize(value).includes(region)))) return false;
    if (typeof input.stopped === "boolean" && asset.stopped !== input.stopped) return false;
    return true;
  }

  query(input = {}) {
    const operation = input.operation || "summary";
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(input.limit) || DEFAULT_LIMIT));

    if (operation === "summary") {
      const u = this.data.universe ?? {};
      const methods = this.data.methods ?? {};
      return {
        summary: `The snapshot maps ${u.n_distinct?.toLocaleString?.() ?? u.n_distinct} distinct biologics across ${u.n_targets?.toLocaleString?.() ?? u.n_targets} targetable proteins.`,
        snapshot: {
          run: this.data.run,
          targetable_proteins: u.n_targets,
          drugged_targets: u.n_drugged,
          distinct_biologics: u.n_distinct,
          target_molecule_records: u.n_mol_rows,
          citations: methods.n_citations,
          source_documents: methods.n_docs,
          evidence_by_source: methods.evidence_by_source,
        },
      };
    }

    if (operation === "target_profile") {
      const symbol = normalize(input.targets?.[0] || input.query);
      const record = this.targets.get(symbol);
      if (!record) return { summary: "No matching target was found in this snapshot.", result_count: 0, results: [] };
      const assets = [...this.assets.values()]
        .filter((asset) => asset.targets.some((target) => normalize(target) === symbol))
        .sort((a, b) => (PHASE_RANK[b.phase] ?? -1) - (PHASE_RANK[a.phase] ?? -1));
      const modalityCounts = Object.entries(assets.reduce((counts, asset) => {
        counts[asset.modality || "unknown"] = (counts[asset.modality || "unknown"] || 0) + 1;
        return counts;
      }, {})).sort((a, b) => b[1] - a[1]);
      const gap = (this.data.modgap?.grid ?? []).find((row) => normalize(row.sym) === symbol);
      return {
        summary: `${record.s} has ${assets.length} biologic programs in this snapshot.`,
        target: { symbol: record.s, compartment: record.c, molecule_count: record.nm },
        modality_counts: modalityCounts,
        modality_matrix: gap ? (this.data.modgap.cols_full ?? this.data.modgap.cols).map((name, index) => ({ name, programs: gap.cells[index]?.length ?? 0 })) : [],
        result_count: assets.length,
        truncated: assets.length > limit,
        results: assets.slice(0, limit).map((asset) => this.#compactWithSources(asset)),
        evidence: this.#evidence(assets.slice(0, limit).map((asset) => asset.id)),
      };
    }

    if (operation === "modality_gaps") {
      const target = normalize(input.targets?.[0] || input.query);
      const rows = (this.data.modgap?.grid ?? []).filter((row) => !target || normalize(row.sym) === target);
      const names = this.data.modgap?.cols_full ?? this.data.modgap?.cols ?? [];
      const results = rows.map((row) => ({
        target: row.sym,
        total_programs: row.n_mol,
        gaps: names.filter((_name, index) => !(row.cells[index]?.length)),
        represented_modalities: names.filter((_name, index) => row.cells[index]?.length),
      })).filter((row) => row.gaps.length);
      return {
        summary: `Found ${results.length} targets with at least one modality gap.`,
        result_count: results.length,
        truncated: results.length > limit,
        results: results.slice(0, limit),
      };
    }

    const selectedIds = input.asset_ids ?? [];
    let assets = selectedIds.length
      ? selectedIds.map((id) => this.#resolveAsset(id)).filter(Boolean)
      : [...this.assets.values()].filter((asset) => this.#matches(asset, input));

    if (operation === "repurposing") {
      const shelfIds = new Set((this.data.shelf?.rows ?? []).map((row) => row.k));
      assets = assets.filter((asset) => shelfIds.has(asset.id));
    }

    assets.sort((a, b) => {
      const phase = (PHASE_RANK[b.phase] ?? -1) - (PHASE_RANK[a.phase] ?? -1);
      return phase || b.evidence_count - a.evidence_count || a.name.localeCompare(b.name);
    });
    const visible = assets.slice(0, limit);
    const evidence = this.#evidence(visible.map((asset) => asset.id));
    return {
      summary: `Found ${assets.length} matching biologic programs in the ${this.data.run} snapshot.`,
      filters_applied: {
        query: input.query || null,
        targets: input.targets ?? [],
        modalities: input.modalities ?? [],
        phases: input.phases ?? [],
        regions: input.regions ?? [],
        stopped: input.stopped ?? null,
      },
      result_count: assets.length,
      truncated: assets.length > limit,
      results: visible.map((asset) => this.#compactWithSources(asset)),
      evidence,
    };
  }
}
