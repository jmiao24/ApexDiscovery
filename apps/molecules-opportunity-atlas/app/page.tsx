const APEX_SCIENCE_URL = "http://127.0.0.1:3411";

const dataSources = [
  {
    mark: "PB",
    name: "FDA Purple Book",
    type: "BIOLOGIC LICENSURE",
    url: "https://purplebooksearch.fda.gov/",
  },
  {
    mark: "DL",
    name: "DailyMed",
    type: "LABELS & MECHANISMS",
    url: "https://dailymed.nlm.nih.gov/",
  },
  {
    mark: "CT",
    name: "ClinicalTrials.gov",
    type: "CLINICAL STUDIES",
    url: "https://clinicaltrials.gov/",
  },
  {
    mark: "OT",
    name: "Open Targets",
    type: "TARGET–DISEASE EVIDENCE",
    url: "https://platform.opentargets.org/",
  },
  {
    mark: "PM",
    name: "PubMed",
    type: "CITATIONS & ABSTRACTS",
    url: "https://pubmed.ncbi.nlm.nih.gov/",
  },
  {
    mark: "PMC",
    name: "PubMed Central",
    type: "BIOMEDICAL FULL TEXT",
    url: "https://pmc.ncbi.nlm.nih.gov/",
  },
  {
    mark: "Ch",
    name: "ChEMBL",
    type: "MOLECULES & BIOACTIVITY",
    url: "https://www.ebi.ac.uk/chembl/",
  },
  {
    mark: "UP",
    name: "UniProt",
    type: "PROTEIN FUNCTION",
    url: "https://www.uniprot.org/",
  },
  {
    mark: "3D",
    name: "RCSB PDB",
    type: "PROTEIN STRUCTURES",
    url: "https://www.rcsb.org/",
  },
  {
    mark: "bR",
    name: "bioRxiv",
    type: "BIOLOGY PREPRINTS",
    url: "https://www.biorxiv.org/",
  },
  {
    mark: "mR",
    name: "medRxiv",
    type: "HEALTH SCIENCE PREPRINTS",
    url: "https://www.medrxiv.org/",
  },
  {
    mark: "aX",
    name: "arXiv",
    type: "MULTIDISCIPLINARY PREPRINTS",
    url: "https://arxiv.org/",
  },
  {
    mark: "OA",
    name: "OpenAlex",
    type: "SCHOLARLY KNOWLEDGE GRAPH",
    url: "https://openalex.org/",
  },
  {
    mark: "WHO",
    name: "WHO ICTRP",
    type: "INTERNATIONAL TRIALS",
    url: "https://trialsearch.who.int/",
  },
  {
    mark: "10-K",
    name: "SEC EDGAR",
    type: "FILINGS & MARKET CONTEXT",
    url: "https://www.sec.gov/edgar/search/",
  },
];

export default function Home() {
  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="APEX Discovery home">
          <span className="wordmark-icon" aria-hidden="true">A</span>
          <span>APEX Discovery</span>
        </a>
        <a className="header-link" href="#sources">Data sources</a>
        <a className="button button-small" href={APEX_SCIENCE_URL} target="_blank" rel="noreferrer">
          Try APEX Discovery <span aria-hidden="true">↗</span>
        </a>
      </header>

      <section className="hero" id="top">
        <div className="product-title">
          <span className="product-icon" aria-hidden="true">A</span>
          <h1>APEX Discovery</h1>
        </div>
        <h2>Agent-native discovery of molecule opportunities.</h2>
        <p>
          APEX Discovery connects regulatory records, clinical trials, target biology,
          molecular structure, bioactivity, scientific literature, and market context.
          Ask one question and investigate the evidence inside APEX Science.
        </p>
        <a className="button" href={APEX_SCIENCE_URL} target="_blank" rel="noreferrer">
          Try APEX Discovery <span aria-hidden="true">→</span>
        </a>
      </section>

      <section className="sources" id="sources" aria-labelledby="sources-heading">
        <div className="section-label">
          <h2 id="sources-heading">Data sources in APEX Discovery</h2>
          <p>Every source opens its official database.</p>
        </div>
        <div className="source-grid">
          {dataSources.map((source) => (
            <a
              className="source"
              href={source.url}
              key={source.name}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${source.name}`}
            >
              <span className="source-mark" aria-hidden="true">{source.mark}</span>
              <strong>{source.name}</strong>
              <span className="source-type">{source.type}</span>
              <span className="source-arrow" aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      </section>

      <footer>
        <span>APEX Discovery</span>
        <span>Powered by APEX Science</span>
        <span>Research use only</span>
      </footer>
    </main>
  );
}
