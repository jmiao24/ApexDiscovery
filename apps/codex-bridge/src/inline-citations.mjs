const INLINE_HTTP_CITATION = /\[[^\]\n]{1,200}\]\(\s*https?:\/\/[^\s)]+(?:\s+["'][^"']*["'])?\s*\)/gi;
const TRAILING_REFERENCE_HEADING = /^#{0,6}\s*(?:sources?|references?|bibliography|参考文献|来源)\s*:?[ \t]*$/gim;

export function citationCheckingEnabled(env = process.env) {
  return env.APEX_ENABLE_CITATION_CHECKING === "1";
}

export const EVIDENCE_SKILL_NAMES = new Set([
  "assess-disease-expansion",
  "evaluate-label-expansion",
  "paperclip",
  "query-purple-book",
  "depmap",
  "cellxgene-census",
  "dailymed",
  "open-targets",
  "rare-variant-burden",
]);

const SCIENCE_NOUN = /\b(?:affinit(?:y|ies)|associations?|bioactivit(?:y|ies)|binding|biomarkers?|cohorts?|compounds?|data(?:bases?|sets?)?|diseases?|doses?|drugs?|efficacy|evidence|expression|genes?|genetic|ligands?|models?|mutations?|patients?|potency|proteins?|records?|risks?|safety|structures?|targets?|trials?|variants?|FDA|PDB|ChEMBL|UniProt|DepMap|GTEx)\b/i;
const EVIDENCE_VERB = /\b(?:approved|associated|demonstrat(?:e|es|ed)|found|indicat(?:e|es|ed)|measur(?:e|es|ed)|report(?:s|ed)?|return(?:s|ed)?|show(?:s|ed)?|support(?:s|ed)?|contain(?:s|ed)?|include(?:s|d)?)\b/i;
const DECLARATIVE_VERB = /\b(?:is|are|was|were|has|have|had|remains?|suggests?|lacks?|express(?:es|ed)?|binds?|inhibits?|activates?)\b/i;
const CHINESE_SCIENCE = /(?:亲和力|关联|活性|结合|生物标志物|队列|化合物|数据|疾病|剂量|药物|疗效|证据|表达|基因|遗传|配体|模型|突变|患者|效力|蛋白|记录|风险|安全|结构|靶点|试验|变异)/;
const CHINESE_EVIDENCE_VERB = /(?:有|存在|批准|关联|发现|显示|表明|报告|返回|包含|支持|测得|表达|结合|抑制|激活)/;
const ACTION_PREFIX = /^(?:please\s+)?(?:add|build|click|compare|create|define|install|open|query|read|recommend|report|return|run|select|use|write)\b/i;
const LOCAL_STATUS = /^(?:I|We|APEX|我|我们|已).*(?:added|built|changed|completed|created|implemented|updated|修改|完成|创建|实现|新增|更新)/i;

function withoutCode(text) {
  let fenced = false;
  const lines = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) lines.push(line.replace(/`[^`]*`/g, ""));
  }
  return lines;
}

function tableSeparator(line) {
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function contentUnits(text) {
  const lines = withoutCode(text);
  const units = [];
  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index].trim();
    if (!line || /^#{1,6}\s/.test(line) || /^<[^>]+>/.test(line) || tableSeparator(line)) continue;
    if (line.includes("|") && tableSeparator(lines[index + 1] ?? "")) continue;
    line = line.replace(/^\s*(?:[-*+] |\d+[.)]\s+|>\s*)/, "").trim();
    if (!line) continue;
    if (line.includes("|")) {
      units.push(line);
      continue;
    }
    const protectedLinks = [];
    const protectedLine = line.replace(INLINE_HTTP_CITATION, (match) => {
      const token = `@@CITATION_${protectedLinks.length}@@`;
      protectedLinks.push(match);
      return token;
    });
    const lineUnits = [];
    for (const sentence of protectedLine.split(/(?<=[。！？])|(?<=[.!?])\s+/)) {
      const restored = sentence.replace(/@@CITATION_(\d+)@@/g, (_, i) => protectedLinks[Number(i)] ?? "").trim();
      if (!restored) continue;
      const withoutCitations = restored.replace(INLINE_HTTP_CITATION, "").trim();
      if (!withoutCitations && lineUnits.length > 0) {
        lineUnits[lineUnits.length - 1] = `${lineUnits[lineUnits.length - 1]} ${restored}`;
      } else {
        lineUnits.push(restored);
      }
    }
    units.push(...lineUnits);
  }
  return units;
}

function likelyExternalClaim(unit) {
  const plain = unit.replace(/\[[^\]]+\]\([^)]*\)/g, "").trim();
  if (!plain || ACTION_PREFIX.test(plain) || LOCAL_STATUS.test(plain)) return false;
  if (/^[^.!?。！？]*[?？]$/.test(plain)) return false;
  const englishClaim = SCIENCE_NOUN.test(plain)
    && (DECLARATIVE_VERB.test(plain) || EVIDENCE_VERB.test(plain) || /\d/.test(plain));
  const chineseClaim = CHINESE_SCIENCE.test(plain)
    && (CHINESE_EVIDENCE_VERB.test(plain) || /\d/.test(plain));
  return englishClaim || chineseClaim;
}

export function userRequestedBibliography(prompt) {
  return /\b(?:bibliography|numbered citations?|references section|source list)\b|参考文献|编号引用|来源列表/i.test(String(prompt ?? ""));
}

export function auditInlineCitations(text, { required = true, allowBibliography = false } = {}) {
  const source = String(text ?? "").trim();
  const citations = source.match(INLINE_HTTP_CITATION) ?? [];
  const units = contentUnits(source);
  const factualUnits = units.filter(likelyExternalClaim);
  const uncitedClaims = factualUnits.filter((unit) => !(unit.match(INLINE_HTTP_CITATION) ?? []).length);
  const issues = [];

  if (required && !source) issues.push("The answer is empty.");
  if (required && factualUnits.length > 0 && citations.length === 0) {
    issues.push("No inline HTTP(S) Markdown citation supports the factual claims.");
  }
  if (required && uncitedClaims.length > 0) {
    issues.push(`${uncitedClaims.length} factual claim unit(s) lack an inline citation.`);
  }
  if (!allowBibliography && TRAILING_REFERENCE_HEADING.test(source)) {
    issues.push("A trailing Sources, References, or Bibliography section is not allowed.");
  }
  TRAILING_REFERENCE_HEADING.lastIndex = 0;

  return {
    ok: issues.length === 0,
    issues,
    citationCount: citations.length,
    factualClaimCount: factualUnits.length,
    uncitedClaims: uncitedClaims.slice(0, 12),
  };
}

export function citationRepairPrompt({ answer, audit, allowBibliography = false }) {
  const examples = audit.uncitedClaims.length
    ? audit.uncitedClaims.map((claim, index) => `${index + 1}. ${claim.slice(0, 500)}`).join("\n")
    : "No individual claim excerpts were detected; address the audit issues below.";
  return `## Mandatory inline-citation repair

Your proposed answer failed APEX's runtime citation gate. Rewrite the entire answer and return only the repaired answer.

Hard requirements:
- Put a descriptive Markdown link to a consulted HTTP(S) source immediately after every externally verifiable factual sentence, bullet, or evidence-table row.
- For UniProt, PDB, ChEMBL, trial, label, regulatory, and other structured-database claims, link the exact official record or query page in the same sentence or row.
- Use only evidence already consulted in this thread. Never invent a URL or citation. Remove or explicitly label unsupported statements as unverified.
- Keep inference, recommendation, and hypothesis visibly distinct from retrieved facts.
- Do not use bare URLs or citation-only footnotes.${allowBibliography ? " Inline citations remain mandatory; the user also permits a bibliography." : " Do not add a trailing Sources, References, or Bibliography section."}

Audit issues:
${audit.issues.map((issue) => `- ${issue}`).join("\n")}

Uncited claim units:
${examples}

Proposed answer to replace:
${answer}`;
}
