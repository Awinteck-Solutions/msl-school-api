/**
 * Enrich all ICAG syllabus section/kb topics with distinctive keywords + negatives,
 * fix resolve aliases, promote FM competencies to sections, sync web copy.
 *
 *   npx ts-node src/scripts/enrichAllSyllabusKeywords.ts
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../..");
const PATHS = [
  path.join(ROOT, "API-MONGODB/src/Features/pastQuestion/data/icagSyllabus.json"),
  path.join(ROOT, "web/src/data/icagSyllabus.json"),
];

const SECTION_PACKS: Record<string, Record<string, { keywords: string[]; negative?: string[]; aliases?: string[] }>> = {
  "1.1": {
    A: {
      keywords: ["qualitative characteristics", "faithful representation", "relevance", "going concern", "accrual", "users of financial statements", "ethics", "true and fair"],
      negative: ["partnership appropriation", "bank reconciliation", "incomplete records"],
    },
    B: {
      keywords: ["double entry", "ledger", "journal", "trial balance", "books of prime entry", "sales day book", "purchase day book", "cash book"],
      negative: ["ratio analysis", "partnership appropriation"],
    },
    C: {
      keywords: ["suspense account", "bank reconciliation", "control account", "correcting errors", "error of omission", "error of commission", "compensating error"],
      negative: ["partnership goodwill", "ratio analysis"],
    },
    D: {
      keywords: ["statement of financial position", "statement of profit or loss", "income statement", "financial statements", "sofp", "sopl"],
      negative: ["incomplete records", "partnership appropriation"],
    },
    E: {
      keywords: ["partnership", "appropriation account", "goodwill", "admission of partner", "retirement of partner", "profit sharing"],
      negative: ["limited company", "share capital"],
    },
    F: {
      keywords: ["incomplete records", "statement of affairs", "mark-up", "margin", "missing figure"],
      negative: ["partnership appropriation", "ias 16"],
    },
    G: {
      keywords: ["public sector", "government accounting", "consolidated fund", "ipsas"],
      negative: ["partnership", "private company"],
    },
    H: {
      keywords: ["accounting ratios", "current ratio", "gross profit margin", "return on capital", "acid test", "gearing"],
      negative: ["incomplete records reconstruction"],
    },
  },
  "1.3": {
    A: { keywords: ["legal system", "common law", "equity", "legislation", "courts", "constitution", "case law"] },
    B: { keywords: ["contract", "offer", "acceptance", "consideration", "tort", "negligence", "law of obligations", "breach of contract"] },
    C: { keywords: ["employment law", "contract of employment", "unfair dismissal", "redundancy", "employee", "employer"] },
    D: { keywords: ["formation of company", "memorandum", "articles of association", "incorporation", "promoters", "pre-incorporation"] },
    E: { keywords: ["share capital", "debenture", "loan capital", "dividend", "capital maintenance", "financing of companies"] },
    F: { keywords: ["directors", "company secretary", "board meetings", "annual general meeting", "companies act", "regulation of companies"] },
    G: { keywords: ["liquidation", "receivership", "administration", "insolvency", "winding up", "companies in difficulty"] },
    H: { keywords: ["corporate governance", "ethics", "fiduciary", "conflict of interest", "money laundering"] },
  },
  "2.1": {
    B: {
      keywords: ["ifrs", "ias", "accounting standard", "financial reporting standard", "measurement", "recognition", "disclosure"],
      negative: ["ratio analysis only", "working capital cycle"],
      aliases: ["application of accounting standards"],
    },
    C: {
      keywords: ["single entity", "statement of financial position", "statement of profit or loss", "statement of changes in equity", "statement of cash flows", "published accounts"],
      negative: ["subsidiary", "non-controlling interest", "consolidation"],
      aliases: ["preparation of financial statements"],
    },
    D: {
      keywords: ["business combination", "consolidation", "subsidiary", "goodwill", "non-controlling interest", "nci", "group accounts", "associate", "joint venture", "ifrs 3", "ifrs 10"],
      negative: ["single entity only", "personal income tax"],
      aliases: ["group accounting", "consolidated financial statements"],
    },
    E: {
      keywords: ["ratio analysis", "interpret", "interpretation", "financial analysis", "performance analysis", "gearing", "liquidity", "profitability", "investor"],
      negative: ["prepare consolidated", "compute goodwill"],
      aliases: ["analysing and interpreting financial statements", "financial statement analysis"],
    },
  },
  "2.2": {
    A: {
      keywords: ["activity based costing", "abc", "target costing", "lifecycle costing", "throughput", "environmental management accounting", "contemporary"],
      negative: ["cash budget preparation only"],
    },
    B: {
      keywords: ["budget", "budgetary control", "flexible budget", "cash budget", "master budget", "zero based budgeting", "rolling budget"],
      negative: ["npv", "irr investment"],
    },
    C: {
      keywords: ["decision making", "relevant cost", "make or buy", "limiting factor", "linear programming", "pricing decision", "shutdown"],
      negative: ["variance analysis only"],
    },
    D: {
      keywords: ["short term decision", "contribution", "break even", "cvp", "cost volume profit", "margin of safety", "special order"],
      negative: ["balanced scorecard"],
    },
    E: {
      keywords: ["performance management", "balanced scorecard", "kpi", "divisional performance", "roi", "residual income", "transfer pricing"],
      negative: ["cash budget"],
    },
    F: {
      keywords: ["public sector", "value for money", "economy efficiency effectiveness", "non-profit", "government performance"],
      negative: ["private sector transfer pricing"],
    },
  },
  "2.3": {
    A: {
      keywords: ["assurance engagement", "reasonable assurance", "limited assurance", "true and fair", "nature of audit", "objective of audit"],
      negative: ["internal audit department structure only"],
    },
    B: {
      keywords: ["ethics", "independence", "threats", "safeguards", "code of ethics", "professional scepticism", "companies act", "regulatory"],
      negative: ["substantive procedure inventory count"],
    },
    C: {
      keywords: ["accepting engagement", "engagement letter", "client acceptance", "terms of engagement", "isa 210", "managing engagements"],
      negative: ["audit report unmodified"],
    },
    D: {
      keywords: ["audit plan", "audit strategy", "materiality", "risk assessment", "inherent risk", "control risk", "planning"],
      negative: ["auditor's report opinion"],
    },
    E: {
      keywords: ["audit evidence", "substantive procedures", "test of controls", "sampling", "analytical procedures", "isa 500"],
      negative: ["engagement letter acceptance"],
    },
    F: {
      keywords: ["subsequent events", "going concern", "written representations", "audit review", "final review"],
      negative: ["internal audit outsourcing"],
    },
    G: {
      keywords: ["auditor's report", "unmodified opinion", "qualified opinion", "adverse opinion", "disclaimer", "key audit matters", "reporting"],
      negative: ["internal control questionnaire"],
    },
    H: {
      keywords: ["internal audit", "internal auditor", "internal control", "outsourcing internal audit", "audit committee"],
      negative: ["external auditor's report opinion"],
    },
    I: {
      keywords: ["public sector audit", "value for money audit", "auditor-general", "gas", "ghana audit service"],
      negative: ["private company statutory audit only"],
    },
  },
  "2.5": {
    A: {
      keywords: ["pfm", "public financial management", "budget cycle", "gifmis", "mtef", "public expenditure"],
      negative: ["ipsas 17 property"],
    },
    B: {
      keywords: ["regulatory framework", "public financial management act", "financial administration", "conceptual framework public sector", "pfma"],
      negative: ["ratio analysis private company"],
    },
    C: {
      keywords: ["ipsas", "public sector entity", "recognition", "measurement", "revenue from non-exchange"],
      negative: ["ifrs 15 private"],
    },
    D: {
      keywords: ["preparation of financial statements", "statement of financial performance", "cash flow statement", "consolidated fund", "mda"],
      negative: ["corporate governance board only"],
    },
    E: {
      keywords: ["evaluation of financial position", "performance", "prospects", "ratio", "surplus", "deficit", "interpret"],
      negative: ["prepare journal entries only"],
    },
    F: {
      keywords: ["governance", "accountability", "transparency", "public sector board", "corruption"],
      negative: ["ipsas consolidation calculation"],
    },
  },
  "3.2": {
    A: {
      keywords: ["ethics", "legal issues", "acceptance", "engagement", "money laundering", "professional scepticism", "conflict of interest"],
    },
    B: {
      keywords: ["engagement plan", "audit strategy", "materiality", "risk-based approach", "planning memorandum"],
    },
    C: {
      keywords: ["gather evidence", "forensic", "due diligence", "assurance methods", "substantive", "controls testing"],
    },
    D: {
      keywords: ["evaluating evidence", "reporting", "modified opinion", "emphasis of matter", "key audit matters", "concluding"],
    },
    E: {
      keywords: ["auditor-general", "public accountability", "pac", "public accounts committee", "government external audit"],
    },
    F: {
      keywords: ["corporate governance", "audit committee", "board", "combined code", "king report", "non-executive"],
    },
    G: {
      keywords: ["public sector audit", "performance audit", "value for money", "compliance audit"],
    },
    H: {
      keywords: ["current developments", "contemporary issues", "data analytics audit", "artificial intelligence audit", "climate"],
    },
  },
  "3.3": {
    A: {
      keywords: ["tax administration", "self-assessment", "tax return", "tax clearance", "objection", "penalty", "tin", "compliance", "tax reform"],
      negative: ["petroleum royalty computation", "transfer pricing oecd"],
    },
    B: {
      keywords: ["business income tax", "company tax", "group relief", "capital allowance", "chargeable income", "insurance companies", "partnership", "individual companies"],
      negative: ["double taxation treaty", "e-invoicing"],
    },
    C: {
      keywords: ["fiscal policy", "economic management", "tax policy", "budget", "stabilization", "monetary"],
      negative: ["vat computation output"],
    },
    D: {
      keywords: ["natural resources", "petroleum", "mining", "royalty", "upstream", "downstream", "mineral"],
      negative: ["employment income overtime"],
    },
    E: {
      keywords: ["tax planning", "ethics", "tax avoidance", "tax evasion", "deferring tax", "ethical"],
      negative: ["compute output vat only"],
    },
    F: {
      keywords: ["transaction taxes", "vat", "customs", "excise", "nhil", "getfund", "stamp duty"],
      negative: ["petroleum interest"],
    },
    G: {
      keywords: ["emerging", "current trends", "digital tax", "e-levy", "cryptocurrency", "tax technology", "transfer pricing trends"],
      negative: ["basic paye computation"],
    },
    H: {
      keywords: ["international taxation", "double taxation", "treaty", "permanent establishment", "transfer pricing", "oecd", "foreign tax credit"],
      negative: ["local vat flat rate"],
    },
  },
  "3.4": {
    A: {
      keywords: ["strategic analysis", "pestel", "porter", "five forces", "swot", "value chain", "competitor analysis", "macro-environment"],
      negative: ["dividend policy computation only"],
    },
    B: {
      keywords: ["strategic choice", "ansoff", "generic strategies", "diversification", "acquisition", "organic growth", " BCG"],
      negative: ["audit committee composition only"],
    },
    C: {
      keywords: ["strategy implementation", "strategy into action", "change management", "organisational structure", "culture", "balanced scorecard"],
      negative: ["npv project appraisal only"],
    },
    D: {
      keywords: ["financial objectives", "shareholder value", "dividend policy", "gearing strategy", "funding strategy", "investment strategy"],
      negative: ["pestel only"],
    },
    E: {
      keywords: ["corporate governance", "board of directors", "non-executive", "remuneration committee", "ethics", "csr", "agency"],
      negative: ["porter five forces only"],
    },
  },
};

const FM_SECTIONS = [
  {
    id: "fm-a-environment-for-financial-management",
    section: "A",
    label: "Environment for financial management",
    keywords: ["financial management environment", "objectives of financial management", "stakeholder", "agency problem", "corporate strategy finance"],
    aliases: ["Explain the environment for financial management"],
  },
  {
    id: "fm-b-financing-decisions",
    section: "B",
    label: "Financing decisions",
    keywords: ["sources of finance", "equity finance", "debt finance", "capital structure", "wacc", "cost of capital", "gearing", "dividend policy"],
    aliases: ["Financing decisions", "cost of capital", "weighted average cost of capital", "capital structure"],
  },
  {
    id: "fm-c-investment-appraisal",
    section: "C",
    label: "Investment appraisal",
    keywords: ["npv", "irr", "payback", "investment appraisal", "capital rationing", "sensitivity analysis", "discounted cash flow"],
    aliases: ["Apply financial investment appraisal techniques", "investment appraisal"],
  },
  {
    id: "fm-d-treasury-and-risk",
    section: "D",
    label: "Treasury management and financial risk",
    keywords: ["treasury", "foreign exchange risk", "interest rate risk", "hedging", "forward contract", "futures", "options", "money market hedge"],
    aliases: ["treasury management", "foreign-exchange risk", "financial risk"],
  },
  {
    id: "fm-e-working-capital",
    section: "E",
    label: "Working capital management",
    keywords: ["working capital", "inventory management", "receivables", "payables", "cash management", "eoq", "overtrading"],
    aliases: ["working capital management", "receivables management"],
  },
  {
    id: "fm-g-public-financial-management",
    section: "G",
    label: "Public financial management",
    keywords: ["public financial management", "government finance", "public sector finance"],
    aliases: ["public financial management"],
  },
  {
    id: "fm-h-technology-finance",
    section: "H",
    label: "Technology and financial decision making",
    keywords: ["fintech", "blockchain finance", "digital finance", "developing technologies", "automation finance"],
    aliases: ["developing technologies on financial decision making"],
  },
];

const EXTRA_ALIASES: Record<string, string> = {
  "ADVANCED FINANCIAL REPORTING": "3.1",
  "ADVANCE FINANCIAL REPORTING": "3.1",
  "ADVANCED FINANCIAL REPORTING SOLUTIONS": "3.1",
  "ADVANCE FINANCIAL REPORTING SOLUTIONS": "3.1",
  "CORPORATE REPORTING": "3.1",
  "COST AND MANAGEMENT ACCOUNTING": "1.4",
  "COST AND MANAGEMENT ACCOUNTING SOLUTIONS": "1.4",
  "SOLUTION COST AND MANAGEMENT ACCOUNTING": "1.4",
  "SOLUTION FINANCIAL REPORTING": "2.1",
  "SOLUTION PUBLIC SECTOR ACCOUNTING": "2.5",
  "SOLUTION ADVANCED AUDIT AND PROF ETHICS": "3.2",
  "SOLUTION CORPORATE STRATEGY AND GOVERNANCE": "3.4",
  "CORPORATE STRATEGY AND GOVERNANCE": "3.4",
  "BUSINESS AND CORPORATE LAW": "1.3",
  "BUSINESS AND CORPORATE SOLUTIONS": "1.3",
};

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function enrichFile(filePath: string) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

  // aliases
  data.resolve = data.resolve || {};
  data.resolve.byAlias = { ...(data.resolve.byAlias || {}), ...EXTRA_ALIASES };

  // FM sections
  const fm = data.papers["2.4"];
  if (fm) {
    const existingIds = new Set((fm.topics || []).map((t: any) => t.id));
    for (const section of FM_SECTIONS) {
      if (existingIds.has(section.id)) {
        const row = fm.topics.find((t: any) => t.id === section.id);
        row.kind = "syllabus_section";
        row.section = section.section;
        row.label = section.label;
        row.displayLabel = `(${section.section}) ${section.label}`;
        row.keywords = uniq([...(row.keywords || []), ...section.keywords]);
        row.aliases = uniq([...(row.aliases || []), ...(section.aliases || [])]);
      } else {
        fm.topics.unshift({
          id: section.id,
          label: section.label,
          section: section.section,
          kind: "syllabus_section",
          weight: 0,
          keywords: section.keywords,
          aliases: section.aliases || [],
          standards: [],
          displayLabel: `(${section.section}) ${section.label}`,
          negativeKeywords: [],
        });
      }
    }
    // alias old competencies to new sections
    for (const topic of fm.topics) {
      if (topic.kind !== "syllabus_competency") continue;
      const letter = String(topic.label || "").match(/^\(([A-H])\)/)?.[1];
      const parent = fm.topics.find((t: any) => t.kind === "syllabus_section" && t.section === letter);
      if (parent) {
        topic.aliasOf = parent.id;
        parent.aliases = uniq([...(parent.aliases || []), topic.label]);
      }
    }
  }

  // section packs
  for (const [code, packs] of Object.entries(SECTION_PACKS)) {
    const paper = data.papers[code];
    if (!paper?.topics) continue;
    for (const topic of paper.topics) {
      if (topic.kind !== "syllabus_section" || !topic.section) continue;
      const pack = packs[topic.section];
      if (!pack) continue;
      const leaf = String(topic.label || "").replace(/^\(([A-Za-z])\)\s*/g, "").trim();
      topic.label = leaf;
      topic.displayLabel = `(${topic.section}) ${leaf}`;
      topic.shortLabel = `(${topic.section})`;
      topic.keywords = uniq([...(topic.keywords || []), ...pack.keywords]);
      topic.negativeKeywords = uniq([...(topic.negativeKeywords || []), ...(pack.negative || [])]);
      topic.aliases = uniq([...(topic.aliases || []), ...(pack.aliases || []), leaf, topic.displayLabel]);
    }
  }

  // kb_topic self keywords from label phrases
  for (const paper of Object.values(data.papers) as any[]) {
    for (const topic of paper.topics || []) {
      if (topic.kind !== "kb_topic") continue;
      const label = String(topic.label || "").trim();
      if (!label) continue;
      const parts = label
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3);
      topic.keywords = uniq([...(topic.keywords || []), label.toLowerCase(), ...parts]);
      topic.aliases = uniq([...(topic.aliases || []), label]);
    }
  }

  // standard negatives for common confusions
  for (const code of ["2.1", "3.1", "1.1"]) {
    const paper = data.papers[code];
    if (!paper) continue;
    for (const topic of paper.topics || []) {
      if (topic.kind !== "standard" && !(topic.standards || []).length) continue;
      const std = (topic.standards || [])[0] || "";
      if (/IAS 16/i.test(std) || /property, plant/i.test(topic.label)) {
        topic.negativeKeywords = uniq([...(topic.negativeKeywords || []), "investment property", "ias 40", "intangible asset"]);
      }
      if (/IAS 40/i.test(std)) {
        topic.negativeKeywords = uniq([...(topic.negativeKeywords || []), "property, plant and equipment owner occupied", "ias 16 depreciation only"]);
      }
      if (/IAS 12|Income Taxes/i.test(topic.label)) {
        topic.aliases = uniq([...(topic.aliases || []), "Income tax", "Deferred tax", "Deferred taxation"]);
        topic.keywords = uniq([...(topic.keywords || []), "deferred tax", "current tax", "tax expense", "temporary difference"]);
      }
      if (/IFRS 15|Revenue/i.test(topic.label)) {
        topic.keywords = uniq([...(topic.keywords || []), "performance obligation", "contract revenue", "variable consideration"]);
      }
      if (/IFRS 16|Leases/i.test(topic.label)) {
        topic.keywords = uniq([...(topic.keywords || []), "right-of-use", "lease liability", "finance lease", "lessee"]);
      }
      if (/IFRS 9|Financial Instruments$/i.test(topic.label)) {
        topic.keywords = uniq([...(topic.keywords || []), "amortised cost", "fvoci", "expected credit loss", "impairment of financial"]);
      }
      if (/IFRS 10|Consolidated/i.test(topic.label)) {
        topic.keywords = uniq([...(topic.keywords || []), "control", "subsidiary", "consolidation", "nci"]);
      }
    }
  }

  // ensure all sections have displayLabel
  for (const paper of Object.values(data.papers) as any[]) {
    for (const topic of paper.topics || []) {
      if (topic.kind === "syllabus_section" && topic.section) {
        const leaf = String(topic.label || "").replace(/^\(([A-Za-z])\)\s*/g, "").trim();
        topic.label = leaf;
        topic.displayLabel = `(${topic.section}) ${leaf}`;
      }
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  console.log("enriched", filePath);
}

for (const file of PATHS) enrichFile(file);
console.log("done");
