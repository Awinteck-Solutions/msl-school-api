import mongoose from "mongoose";
import { readFileSync } from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  COLLECTION_NAME,
  LESSON_FILES_BASE_URL,
  SUBSCRIPTION_COLLECTION_NAME,
  buildPointVector,
  chunkText,
  downloadFileFromS3,
  embedText,
  ensurePayloadIndexesForGeminiCollection,
  ensureQdrantCollection,
  extractPdfContent,
  geminiChatModel,
  handleQdrantOperation,
  qdrant,
  resolveVectorFormat,
  searchAiCollections,
} from "../../geminiAi/controllers/geminiAi.shared";
import AiUsage from "../../mslAi/schema/aiUsage.schema";
import { getUserEnrolledCourseIds } from "../../subscription/controllers/subscription.service";
import {
  PastQuestionInsightScope,
  PastQuestionProcessStatus,
  PastQuestionStatus,
} from "../enums/pastQuestion.enum";
import PastQuestionInsight from "../schema/pastQuestionInsight.schema";
import PastQuestionItem from "../schema/pastQuestionItem.schema";
import PastQuestionPaper from "../schema/pastQuestionPaper.schema";

export const PAST_QUESTION_COLLECTION_NAME =
  process.env.GEMINI_PAST_QUESTION_COLLECTION || "gemini_ai_past_questions";

const EXTRACT_QUESTIONS_PROMPT = `You extract exam past questions and suggested solutions from paper text.
Return ONLY a JSON array. No markdown, no commentary.
Each object must be:
{
  "number": "1" or "2(a)",
  "question": "full question text",
  "answer": "suggested solution if present, else empty string",
  "answerNotes": "examiner comments or marking notes if present, else empty string",
  "marks": number or null
}
Split into individual numbered questions. Keep lettered parts together when they belong to one question.`;

const INSIGHTS_PROMPT = `You are an ICAG exam analyst using the official ICAG Professional Qualification Syllabus 2024-2029.
From the past questions provided, produce one-time study insights.
Return ONLY JSON with this shape:
{
  "summary": "2-4 sentence overview",
  "repeatedQuestions": [{"theme": "string", "count": number, "years": [number], "examples": ["short quote"]}],
  "topics": [{"topic": "string", "count": number, "years": [number]}],
  "trends": ["string"],
  "facts": ["string"]
}
Topic rules:
- Prefer specific examinable syllabus topics and standards (e.g. "IAS 16 Property, Plant and Equipment", "IFRS 10 Consolidated Financial Statements", "Ratio analysis").
- Use the final subtopic name only. Never write breadcrumb labels like "Financial reporting > IAS 16 …".
- Do NOT invent vague umbrella labels when a standard or syllabus area applies.
- When a syllabus topic list is provided below, choose topic names from that list whenever possible.
- Count frequency of repeated themes and topics across years. If data is thin, still return the keys with empty arrays.`;

/** Final segment + strip "(H) " syllabus letter prefixes. */
export const leafTopicLabel = (value: unknown) => {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const parts = text.includes(">") ? text.split(/\s*>\s*/) : [text];
  return (parts[parts.length - 1] || text).replace(/^\(([A-Za-z])\)\s*/, "").trim();
};

const sittingRank = (sitting = "") => {
  const s = String(sitting || "");
  if (/nov|dec/i.test(s)) return 4;
  if (/aug|sep|sept/i.test(s)) return 3;
  if (/may|june|jun|july|jul/i.test(s)) return 2;
  if (/mar|april|apr/i.test(s)) return 1;
  return 2;
};

const isTopicEffectiveForSitting = (topic: any, year: unknown, sitting: unknown) => {
  const from = topic?.effectiveFrom;
  if (!from?.year) return true;
  const y = Number(year);
  const fromY = Number(from.year);
  if (!Number.isFinite(y) || !Number.isFinite(fromY)) return true;
  if (y > fromY) return true;
  if (y < fromY) return false;
  return sittingRank(String(sitting || "")) >= sittingRank(String(from.sitting || "November"));
};

type SyllabusTopicRow = {
  id?: string;
  label: string;
  displayLabel?: string;
  kind?: string;
  weight?: number;
  section?: string;
  standards?: string[];
  aliases?: string[];
  aliasOf?: string;
  effectiveFrom?: { year?: number; sitting?: string };
  keywords?: string[];
  negativeKeywords?: string[];
};

let syllabusCache: any = null;
const readSyllabus = () => {
  if (syllabusCache) return syllabusCache;
  const file = path.join(__dirname, "../data/icagSyllabus.json");
  syllabusCache = JSON.parse(readFileSync(file, "utf8"));
  return syllabusCache;
};

const resolveSyllabusCode = (paper: { paperCode?: string; title?: string }) => {
  const data = readSyllabus();
  const code = String(paper.paperCode || "").trim();
  if (code && data?.resolve?.byCode?.[code]) return code;
  const alias = String(paper.title || "")
    .replace(/\s+Solutions?\s*$/i, "")
    .trim()
    .toUpperCase();
  if (alias && data?.resolve?.byAlias?.[alias]) return data.resolve.byAlias[alias];
  return code;
};

const loadSyllabusTopicRows = (paper: {
  paperCode?: string;
  title?: string;
  level?: string;
  year?: number;
  sitting?: string;
}): SyllabusTopicRow[] => {
  try {
    const data = readSyllabus();
    const code = resolveSyllabusCode(paper);
    const entry = data?.papers?.[code];
    if (!entry?.topics?.length) return [];
    const byId = new Map(entry.topics.map((topic: any) => [topic.id, topic]));
    return entry.topics
      .filter((topic: any) => !topic.aliasOf)
      .filter((topic: any) => topic.kind !== "syllabus_competency")
      .filter((topic: any) => isTopicEffectiveForSitting(topic, paper.year, paper.sitting))
      .map((topic: any) => {
        const aliases = entry.topics.filter((row: any) => row.aliasOf === topic.id);
        const leaf = leafTopicLabel(topic.label);
        return {
          ...topic,
          label: leaf,
          displayLabel: leaf,
          aliases: Array.from(
            new Set([
              ...(topic.aliases || []),
              ...aliases.map((row: any) => leafTopicLabel(row.label)),
              ...aliases.flatMap((row: any) => row.aliases || []),
            ])
          ),
          keywords: Array.from(
            new Set([...(topic.keywords || []), ...aliases.flatMap((row: any) => row.keywords || [])])
          ),
          negativeKeywords: Array.from(
            new Set([
              ...(topic.negativeKeywords || []),
              ...aliases.flatMap((row: any) => row.negativeKeywords || []),
            ])
          ),
          canonical: byId.get(topic.id),
        } as SyllabusTopicRow;
      });
  } catch {
    return [];
  }
};

const loadSyllabusTopics = (paper: {
  paperCode?: string;
  title?: string;
  level?: string;
  year?: number;
  sitting?: string;
}) =>
  loadSyllabusTopicRows(paper)
    .map((topic) => topic.label)
    .filter(Boolean);

const WEAK_SCORE_TOKENS = new Set([
  "tax",
  "taxes",
  "taxation",
  "income",
  "ghana",
  "ghanaian",
  "system",
  "policy",
  "issues",
  "practice",
  "application",
  "information",
  "technology",
  "liabilities",
  "administration",
  "financial",
  "reporting",
  "ias",
  "ifrs",
  "ipsas",
]);

const phraseHits = (hay: string, phrases: string[] = []) =>
  (phrases || [])
    .map((item) => String(item || "").toLowerCase().trim())
    .filter((phrase) => {
      if (phrase.length < 4) return false;
      if (phrase.includes(" ")) return hay.includes(phrase);
      return phrase.length >= 6 && !WEAK_SCORE_TOKENS.has(phrase) && hay.includes(phrase);
    });

const textStds = (text: string) =>
  (String(text || "").toLowerCase().match(/\b(?:ias|ifrs|ipsas)\s*\d+[a-z]?\b/g) || []).map((item) =>
    item.replace(/\s+/g, " ").trim()
  );

export const scoreSyllabusTopic = (topic: SyllabusTopicRow, questionText: string) => {
  const hay = String(questionText || "").toLowerCase();
  if (!hay.trim()) return 0;

  const negatives = phraseHits(hay, topic.negativeKeywords || []);
  // Any negative hit disqualifies the topic — prevents e.g. consolidation Qs matching "single entity".
  if (negatives.length) return 0;

  let score = 0;
  const stds = (topic.standards || []).map((item) => item.toLowerCase().replace(/\s+/g, " ").trim());
  const found = textStds(hay);
  stds.forEach((std) => {
    if (found.includes(std) || hay.includes(std)) score += 4.5;
  });
  found.forEach((std) => {
    if ((topic.label || "").toLowerCase().includes(std)) score += 1.25;
  });

  const keywordHits = phraseHits(hay, topic.keywords || []);
  if (keywordHits.length) {
    score += Math.min(4.5, keywordHits.length * 1.35);
    keywordHits.forEach((hit) => {
      if (hit.includes(" ")) score += 0.55;
    });
  }

  phraseHits(hay, topic.aliases || []).forEach((alias) => {
    score += alias.includes(" ") || alias.length > 12 ? 2.6 : 1.2;
  });

  const compact = leafTopicLabel(topic.label).toLowerCase();
  if (compact.length > 12 && compact.length < 80 && hay.includes(compact)) score += 2.4;

  if (topic.kind === "syllabus_competency") score -= 0.35;
  return Math.max(0, score);
};

export const matchSyllabusTopic = (questionText: string, topics: SyllabusTopicRow[], minimum = 1.6) => {
  let best: SyllabusTopicRow | null = null;
  let bestScore = minimum;
  let second = 0;
  (topics || []).forEach((topic) => {
    const score = scoreSyllabusTopic(topic, questionText);
    if (score > bestScore) {
      second = bestScore;
      best = topic;
      bestScore = score;
    } else if (score > second) {
      second = score;
    }
  });
  if (best && bestScore - second < 0.45 && bestScore < 3.2) return null;
  return best ? { topic: best, score: bestScore } : null;
};

const formatSyllabusDisplay = (topic?: SyllabusTopicRow | null) => {
  if (!topic) return "";
  // Title only — omit syllabus grid letters like "(D)".
  return leafTopicLabel(topic.label || topic.displayLabel || "");
};

const bareStandardTitle = (label: string) =>
  leafTopicLabel(label)
    .replace(/^(?:ias|ifrs|ipsas)\s*\d+[a-z]?\s*/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(and|of|the|for|with)\b/g, " ")
    .replace(/\s+/g, " ")
    .replace(/s\b/g, "")
    .trim();

const expandStandardLabel = (label: string, rows: SyllabusTopicRow[]) => {
  const leaf = leafTopicLabel(label);
  const lower = leaf.toLowerCase();
  const catalog = rows || [];

  const aliasHit = catalog.find((topic) => {
    const names = [topic.label, topic.displayLabel, ...(topic.aliases || [])]
      .filter(Boolean)
      .map((value) => leafTopicLabel(value).toLowerCase());
    return names.includes(lower);
  });
  if (aliasHit) return formatSyllabusDisplay(aliasHit) || leafTopicLabel(aliasHit.label);

  const stdMatch = leaf.match(/\b((?:ias|ifrs|ipsas)\s*\d+[a-z]?)\b/i);
  if (stdMatch) {
    const std = stdMatch[1].toLowerCase().replace(/\s+/g, " ").trim();
    const pretty = std.replace(/^(ias|ifrs|ipsas)\s+/i, (prefix) => `${prefix.trim().toUpperCase()} `);
    const hit = catalog.find((topic) =>
      (topic.standards || []).some((item) => item.toLowerCase().replace(/\s+/g, " ").trim() === std)
    );
    if (hit) return formatSyllabusDisplay(hit) || leafTopicLabel(hit.label);

    const byLabel = catalog.find((topic) => topic.label.toLowerCase().startsWith(std));
    if (byLabel) return formatSyllabusDisplay(byLabel) || leafTopicLabel(byLabel.label);

    try {
      const titles = readSyllabus()?.standardTitles || {};
      if (titles[pretty]) return titles[pretty];
      const key = Object.keys(titles).find((item) => item.toLowerCase() === pretty.toLowerCase());
      if (key) return titles[key];
    } catch {
      /* ignore */
    }
    return leaf;
  }

  // Title without short label, e.g. "Income tax" → "IAS 12 Income Taxes"
  const lowerBare = bareStandardTitle(leaf);
  const byBareTitle = catalog.find((topic) => {
    if (!(topic.standards || []).length && topic.kind !== "standard") return false;
    const bare = bareStandardTitle(topic.label);
    return Boolean(bare) && bare === lowerBare;
  });
  if (byBareTitle) return formatSyllabusDisplay(byBareTitle) || leafTopicLabel(byBareTitle.label);

  try {
    const titles = readSyllabus()?.standardTitles || {};
    const fromDictBare = Object.entries(titles).find(([, title]) => bareStandardTitle(String(title)) === lowerBare);
    if (fromDictBare) return String(fromDictBare[1]);
  } catch {
    /* ignore */
  }

  return leaf;
};

const WEAK_TOPIC_TOKENS = new Set([
  "tax",
  "taxes",
  "taxation",
  "income",
  "ghana",
  "ghanaian",
  "system",
  "policy",
  "issues",
  "practice",
  "application",
  "liabilities",
  "administration",
]);

const resolveCanonicalTopicLabel = (raw: string, catalog: SyllabusTopicRow[]) => {
  const leaf = leafTopicLabel(raw);
  if (!leaf) return "";
  if (!catalog.length) return expandStandardLabel(leaf, catalog);

  const lower = leaf.toLowerCase();
  const aliasHit = catalog.find((item) => {
    const names = [item.label, item.displayLabel, ...(item.aliases || [])]
      .filter(Boolean)
      .map((value) => leafTopicLabel(value).toLowerCase());
    return names.includes(lower);
  });
  if (aliasHit) return formatSyllabusDisplay(aliasHit) || leafTopicLabel(aliasHit.label);

  // Phrase alias containment (prefer longer distinctive aliases)
  let phraseBest: SyllabusTopicRow | null = null;
  let phraseScore = 0;
  catalog.forEach((item) => {
    const phrases = [item.label, ...(item.aliases || [])]
      .filter(Boolean)
      .map((value) => leafTopicLabel(value).toLowerCase())
      .filter((value) => value.length >= 5);
    phrases.forEach((phrase) => {
      if (!lower.includes(phrase) && !phrase.includes(lower)) return;
      const weak = phrase
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .every((token) => WEAK_TOPIC_TOKENS.has(token) || token.length <= 3);
      if (weak) return;
      const score = phrase.length + (lower === phrase ? 20 : lower.includes(phrase) ? 8 : 3);
      if (score > phraseScore) {
        phraseScore = score;
        phraseBest = item;
      }
    });
  });
  if (phraseBest && phraseScore >= 14) {
    return formatSyllabusDisplay(phraseBest) || leafTopicLabel(phraseBest.label);
  }

  const expanded = expandStandardLabel(leaf, catalog);
  if (expanded !== leaf) return expanded;

  // Standards / distinctive keyword match only (avoid generic "tax"/"income")
  let best: SyllabusTopicRow | null = null;
  let bestScore = 0;
  catalog.forEach((item) => {
    let score = 0;
    (item.standards || []).forEach((std) => {
      if (lower.includes(String(std).toLowerCase())) score += 5;
    });
    const keywords = (item.keywords || [])
      .map((value) => String(value).toLowerCase())
      .filter((value) => value.length > 4 && !WEAK_TOPIC_TOKENS.has(value));
    const keywordHits = keywords.filter((word) => lower.includes(word)).length;
    if (keywords.length) score += (keywordHits / Math.min(keywords.length, 8)) * 2.5;
    if (item.kind === "standard") score += 0.25;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  });
  if (best && bestScore >= 2.2) return formatSyllabusDisplay(best) || leafTopicLabel(best.label);
  return leaf;
};

const normalizeTopicRows = (rows: unknown[], paper?: { paperCode?: string; title?: string; year?: number; sitting?: string }) => {
  const catalog = paper ? loadSyllabusTopicRows(paper) : [];
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      if (row == null) return null;
      const raw = typeof row === "string" ? row : (row as any).topic || (row as any).label || "";
      const topic = resolveCanonicalTopicLabel(String(raw), catalog);
      if (!topic) return null;
      if (typeof row === "string") return { topic, count: 1, years: [] as number[] };
      return {
        ...(row as Record<string, unknown>),
        topic,
      };
    })
    .filter(Boolean);
};

export const normalizeInsightDocument = (insight: any, paper?: any) => {
  if (!insight) return insight;
  const plain = typeof insight.toObject === "function" ? insight.toObject() : { ...insight };
  const ref = paper || {
    paperCode: plain.paperCode,
    title: plain.title,
    year: plain.year,
    sitting: plain.sitting,
  };
  return {
    ...plain,
    topics: normalizeTopicRows(plain.topics || [], ref),
  };
};

const parseJson = (raw: string) => {
  let jsonStr = String(raw || "").trim();
  const fenced = jsonStr.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (fenced) jsonStr = fenced[1].trim();
  const start = jsonStr.search(/[\{\[]/);
  if (start > 0) jsonStr = jsonStr.slice(start);
  return JSON.parse(jsonStr);
};

export const publicFileUrl = (fileKey: string) => {
  if (!fileKey) return null;
  if (/^https?:\/\//i.test(fileKey)) return fileKey;
  const base = (LESSON_FILES_BASE_URL || "").replace(/\/$/, "");
  return base ? `${base}/${fileKey}` : fileKey;
};

export const courseKey = (paper: {
  categoryId: any;
  level?: string;
  paperCode?: string;
  title?: string;
}) => ({
  categoryId: paper.categoryId,
  level: String(paper.level || "").trim(),
  paperCode: String(paper.paperCode || paper.title || "")
    .trim()
    .toUpperCase(),
});

const paperFilter = (paperId: string) => ({
  must: [{ key: "paperId", match: { value: String(paperId) } }],
});

export const ensurePastQuestionCollection = async () => {
  await ensureQdrantCollection(PAST_QUESTION_COLLECTION_NAME);
  await ensurePayloadIndexesForGeminiCollection(PAST_QUESTION_COLLECTION_NAME);
};

export const deletePastQuestionVectors = async (paperId: string) => {
  await ensurePastQuestionCollection();
  await handleQdrantOperation(
    async () =>
      qdrant.delete(PAST_QUESTION_COLLECTION_NAME, {
        wait: true,
        filter: paperFilter(paperId) as any,
      }),
    "past question qdrant delete"
  );
};

const upsertPaperVectors = async (paper: any, items: any[]) => {
  await ensurePastQuestionCollection();
  const format = await resolveVectorFormat(PAST_QUESTION_COLLECTION_NAME);
  const points: any[] = [];
  const texts: { text: string; questionId?: string }[] = [];

  for (const item of items) {
    const blob = [
      `Question ${item.number || ""}`.trim(),
      item.question,
      item.answer ? `Suggested solution:\n${item.answer}` : "",
      item.answerNotes ? `Notes:\n${item.answerNotes}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    texts.push({ text: blob, questionId: String(item._id) });
  }
  if (paper.extractedText) {
    texts.push({ text: paper.extractedText });
  }

  for (const entry of texts) {
    const chunks = chunkText(entry.text, 400);
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const vector = await embedText(chunk);
      points.push({
        id: uuidv4(),
        vector: buildPointVector(vector, format),
        payload: {
          text: chunk,
          sourceType: "past-question",
          paperId: String(paper._id),
          questionId: entry.questionId || "",
          paperCode: String(paper.paperCode || ""),
          categoryId: String(paper.categoryId),
          level: String(paper.level || ""),
          year: paper.year,
          s3Key: paper.fileKey,
        },
      });
    }
  }

  const batchSize = 10;
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    await handleQdrantOperation(
      async () =>
        qdrant.upsert(PAST_QUESTION_COLLECTION_NAME, {
          wait: true,
          points: batch,
        }),
      "past question qdrant upsert"
    );
  }
};

export const extractQuestionsFromText = async (text: string) => {
  const clipped = String(text || "").slice(0, 160000);
  const completion = await geminiChatModel.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${EXTRACT_QUESTIONS_PROMPT}\n\nPaper text:\n\n${clipped}`,
          },
        ],
      },
    ],
  });
  const parsed = parseJson(completion.response.text());
  const rows = Array.isArray(parsed) ? parsed : [];
  return rows
    .filter((row) => row && typeof row.question === "string" && row.question.trim())
    .map((row, index) => ({
      number: String(row.number || index + 1).trim(),
      question: String(row.question).trim(),
      answer: String(row.answer || "").trim(),
      answerNotes: String(row.answerNotes || row.answer_notes || "").trim(),
      marks:
        row.marks === null || row.marks === undefined || row.marks === ""
          ? null
          : Number(row.marks),
      order: index,
    }));
};

const generateInsightPayload = async (
  label: string,
  corpus: string,
  syllabusTopics: string[] = [],
  paper?: { paperCode?: string; title?: string; year?: number; sitting?: string }
) => {
  const topicGuide = syllabusTopics.length
    ? `\n\nPreferred ICAG syllabus topics for this paper (use these names when they fit):\n- ${syllabusTopics.join(
        "\n- "
      )}`
    : "";
  const completion = await geminiChatModel.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${INSIGHTS_PROMPT}${topicGuide}\n\n${label}\n\n${corpus.slice(0, 140000)}`,
          },
        ],
      },
    ],
  });
  const parsed = parseJson(completion.response.text());
  return {
    summary: String(parsed?.summary || "").trim(),
    repeatedQuestions: Array.isArray(parsed?.repeatedQuestions)
      ? parsed.repeatedQuestions
      : [],
    topics: normalizeTopicRows(Array.isArray(parsed?.topics) ? parsed.topics : [], paper),
    trends: Array.isArray(parsed?.trends)
      ? parsed.trends.map((item: unknown) => String(item))
      : [],
    facts: Array.isArray(parsed?.facts)
      ? parsed.facts.map((item: unknown) => String(item))
      : [],
  };
};

const itemCorpus = (items: any[], paper: any) =>
  items
    .map(
      (item) =>
        `[${paper.year} ${paper.sitting || ""} Q${item.number}]\n${item.question}\nAnswer: ${
          item.answer || ""
        }\nNotes: ${item.answerNotes || ""}`
    )
    .join("\n\n");

export const refreshPaperInsights = async (paperId: string) => {
  const paper = await PastQuestionPaper.findById(paperId);
  if (!paper) return null;
  const items = await PastQuestionItem.find({ paper: paper._id }).sort({
    order: 1,
  });
  const payload = await generateInsightPayload(
    `Paper: ${paper.title} ${paper.paperCode} ${paper.sitting} ${paper.year} Level ${paper.level}`,
    itemCorpus(items, paper) || paper.extractedText || "",
    loadSyllabusTopics(paper),
    paper
  );
  return PastQuestionInsight.findOneAndUpdate(
    { scope: PastQuestionInsightScope.PAPER, paper: paper._id },
    {
      $set: {
        scope: PastQuestionInsightScope.PAPER,
        paper: paper._id,
        ...courseKey(paper),
        title: paper.title,
        ...payload,
        sourcePaperIds: [paper._id],
        generatedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );
};

export const refreshCourseInsights = async (paper: {
  categoryId: any;
  level?: string;
  paperCode?: string;
  title?: string;
}) => {
  const key = courseKey(paper);
  const papers = await PastQuestionPaper.find({
    categoryId: key.categoryId,
    level: key.level,
    $or: [
      { paperCode: key.paperCode },
      { paperCode: "", title: paper.title },
    ],
    processStatus: PastQuestionProcessStatus.SUCCESS,
    status: PastQuestionStatus.ACTIVE,
  }).sort({ year: 1, sitting: 1 });

  const paperIds = papers.map((row: any) => row._id);
  const items = await PastQuestionItem.find({
    paper: { $in: paperIds },
  }).sort({ order: 1 });
  const itemsByPaper = new Map<string, any[]>();
  for (const item of items) {
    const id = String(item.paper);
    const list = itemsByPaper.get(id) || [];
    list.push(item);
    itemsByPaper.set(id, list);
  }
  const corpus = papers
    .map((row: any) => itemCorpus(itemsByPaper.get(String(row._id)) || [], row))
    .filter(Boolean)
    .join("\n\n----\n\n");

  const payload = await generateInsightPayload(
    `Course paper ${paper.title || ""} ${key.paperCode} Level ${key.level} across ${papers
      .map((row: any) => `${row.sitting || ""} ${row.year}`.trim())
      .join(", ")}`,
    corpus,
    loadSyllabusTopicRows(paper)
      .concat(
        papers.flatMap((row: any) =>
          loadSyllabusTopicRows({
            paperCode: row.paperCode || paper.paperCode,
            title: row.title || paper.title,
            year: row.year,
            sitting: row.sitting,
          })
        )
      )
      .map((topic) => topic.label)
      .filter((label, index, all) => label && all.indexOf(label) === index),
    paper
  );

  return PastQuestionInsight.findOneAndUpdate(
    {
      scope: PastQuestionInsightScope.COURSE,
      categoryId: key.categoryId,
      level: key.level,
      paperCode: key.paperCode,
      paper: { $exists: false },
    },
    {
      $set: {
        scope: PastQuestionInsightScope.COURSE,
        ...key,
        title: paper.title || "",
        ...payload,
        sourcePaperIds: paperIds,
        generatedAt: new Date(),
      },
      $unset: { paper: 1 },
    },
    { upsert: true, new: true }
  );
};

export const processPastQuestionPaper = async (paperId: string) => {
  const paper = await PastQuestionPaper.findById(paperId);
  if (!paper) throw new Error("Paper not found");

  paper.processStatus = PastQuestionProcessStatus.PROCESSING;
  paper.lastError = null;
  await paper.save();

  try {
    const buffer = await downloadFileFromS3(paper.fileKey);
    const extractedText = await extractPdfContent(buffer);
    paper.extractedText = extractedText;
    const extracted = await extractQuestionsFromText(extractedText);

    await PastQuestionItem.deleteMany({ paper: paper._id });
    const created =
      extracted.length > 0
        ? await PastQuestionItem.insertMany(
            extracted.map((item) => ({ ...item, paper: paper._id }))
          )
        : [];

    await deletePastQuestionVectors(String(paper._id)).catch(() => {});
    await upsertPaperVectors(paper, created);

    paper.questionCount = created.length;
    paper.processStatus = PastQuestionProcessStatus.SUCCESS;
    paper.processedAt = new Date();
    await paper.save();

    await refreshPaperInsights(String(paper._id)).catch((error) => {
      console.warn("[past-questions] paper insights failed", error?.message || error);
    });
    await refreshCourseInsights(paper).catch((error) => {
      console.warn("[past-questions] course insights failed", error?.message || error);
    });

    return paper;
  } catch (error: any) {
    paper.processStatus = PastQuestionProcessStatus.FAILED;
    paper.lastError = error?.message || String(error);
    await paper.save();
    throw error;
  }
};

export const replacePaperQuestions = async (
  paperId: string,
  questions: Array<{
    number?: string;
    question: string;
    answer?: string;
    answerNotes?: string;
    marks?: number | null;
  }>
) => {
  const paper = await PastQuestionPaper.findById(paperId);
  if (!paper) throw new Error("Paper not found");
  await PastQuestionItem.deleteMany({ paper: paper._id });
  const created = await PastQuestionItem.insertMany(
    questions
      .filter((item) => item.question && item.question.trim())
      .map((item, order) => ({
        paper: paper._id,
        number: String(item.number || order + 1),
        question: item.question.trim(),
        answer: String(item.answer || "").trim(),
        answerNotes: String(item.answerNotes || "").trim(),
        marks:
          item.marks === null || item.marks === undefined
            ? null
            : Number(item.marks),
        order,
      }))
  );
  paper.questionCount = created.length;
  paper.processStatus = PastQuestionProcessStatus.SUCCESS;
  paper.processedAt = new Date();
  await paper.save();
  await deletePastQuestionVectors(String(paper._id)).catch(() => {});
  await upsertPaperVectors(paper, created);
  await refreshPaperInsights(String(paper._id)).catch(() => {});
  await refreshCourseInsights(paper).catch(() => {});
  return { paper, items: created };
};

const normalizeLabel = (value: unknown) => leafTopicLabel(value);

const bumpCount = (
  map: Map<string, { label: string; count: number; years: Set<number> }>,
  label: unknown,
  count: unknown,
  years: unknown
) => {
  const text = normalizeLabel(label);
  if (!text) return;
  const key = text.toLowerCase();
  const current = map.get(key) || { label: text, count: 0, years: new Set<number>() };
  const weight = Number(count);
  current.count += Number.isFinite(weight) && weight > 0 ? weight : 1;
  if (Array.isArray(years)) {
    years.forEach((year) => {
      const numeric = Number(year);
      if (Number.isFinite(numeric)) current.years.add(numeric);
    });
  }
  map.set(key, current);
};

const ranked = (map: Map<string, { label: string; count: number; years: Set<number> }>, limit: number) =>
  Array.from(map.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((item) => ({
      label: item.label,
      count: item.count,
      years: Array.from(item.years).sort((a, b) => b - a),
    }));

export const buildPastQuestionAnalytics = async (options: {
  admin?: boolean;
  studentId?: string;
  categoryId?: string;
}) => {
  const paperFilter: Record<string, unknown> = {};
  if (!options.admin) {
    paperFilter.status = PastQuestionStatus.ACTIVE;
    paperFilter.processStatus = PastQuestionProcessStatus.SUCCESS;
  }
  if (options.categoryId && mongoose.Types.ObjectId.isValid(options.categoryId)) {
    paperFilter.categoryId = new mongoose.Types.ObjectId(options.categoryId);
  }

  const papers = await PastQuestionPaper.find(paperFilter)
    .select("title year sitting level paperCode status processStatus questionCount")
    .lean();
  const paperIds = papers.map((paper: any) => paper._id);
  const insights = paperIds.length
    ? await PastQuestionInsight.find({
        $or: [{ paper: { $in: paperIds } }, { sourcePaperIds: { $in: paperIds } }],
      }).lean()
    : [];

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const usageMatch: Record<string, unknown> = { source: "past-question" };
  if (!options.admin && options.studentId && mongoose.Types.ObjectId.isValid(options.studentId)) {
    usageMatch.student = new mongoose.Types.ObjectId(options.studentId);
  }
  const usage = await AiUsage.aggregate([
    { $match: usageMatch },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              queries: { $sum: 1 },
              tokens: { $sum: { $ifNull: ["$total_tokens", 0] } },
            },
          },
        ],
        recent: [{ $match: { createdAt: { $gte: since } } }, { $count: "queries" }],
        byScope: [
          {
            $group: {
              _id: { $ifNull: ["$metadata.scope", "unknown"] },
              queries: { $sum: 1 },
              tokens: { $sum: { $ifNull: ["$total_tokens", 0] } },
            },
          },
          { $sort: { queries: -1 } },
        ],
      },
    },
  ]);
  const usageRow = usage[0] || { totals: [], recent: [], byScope: [] };

  const topics = new Map<string, { label: string; count: number; years: Set<number> }>();
  const repeated = new Map<string, { label: string; count: number; years: Set<number> }>();
  const trends = new Map<string, { label: string; count: number; years: Set<number> }>();
  let paperInsights = 0;
  let courseInsights = 0;

  for (const insight of insights) {
    if (insight.scope === PastQuestionInsightScope.PAPER) paperInsights += 1;
    if (insight.scope === PastQuestionInsightScope.COURSE) courseInsights += 1;
    if (insight.scope !== PastQuestionInsightScope.PAPER) continue;
    (insight.topics || []).forEach((topic: any) =>
      bumpCount(topics, topic?.topic || topic, topic?.count, topic?.years)
    );
    (insight.repeatedQuestions || []).forEach((item: any) =>
      bumpCount(repeated, item?.theme || item, item?.count, item?.years)
    );
    (insight.trends || []).forEach((item: unknown) => bumpCount(trends, item, 1, []));
  }

  const statusCounts = papers.reduce((acc: Record<string, number>, paper: any) => {
    const key = String(paper.processStatus || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    audience: options.admin ? "admin" : "student",
    coverage: {
      papers: papers.length,
      questions: papers.reduce((sum: number, paper: any) => sum + Number(paper.questionCount || 0), 0),
      paperInsights,
      courseInsights,
      processed: statusCounts[PastQuestionProcessStatus.SUCCESS] || 0,
      failed: options.admin ? statusCounts[PastQuestionProcessStatus.FAILED] || 0 : undefined,
      pending: options.admin ? statusCounts[PastQuestionProcessStatus.PENDING] || 0 : undefined,
      processing: options.admin ? statusCounts[PastQuestionProcessStatus.PROCESSING] || 0 : undefined,
    },
    topics: ranked(topics, 12).map((item) => ({
      topic: item.label,
      count: item.count,
      years: item.years,
    })),
    repeatedQuestions: ranked(repeated, 8).map((item) => ({
      theme: item.label,
      count: item.count,
      years: item.years,
    })),
    trends: ranked(trends, 8).map((item) => ({ text: item.label, count: item.count })),
    chat: {
      queries: usageRow.totals[0]?.queries || 0,
      tokens: usageRow.totals[0]?.tokens || 0,
      last30Days: usageRow.recent[0]?.queries || 0,
      byScope: (usageRow.byScope || []).map((row: any) => ({
        scope: row._id || "unknown",
        queries: row.queries || 0,
        tokens: row.tokens || 0,
      })),
    },
    recentInsights: insights
      .slice()
      .sort(
        (a: any, b: any) =>
          new Date(b.generatedAt || 0).getTime() - new Date(a.generatedAt || 0).getTime()
      )
      .slice(0, 8)
      .map((insight: any) => ({
        scope: insight.scope,
        title: insight.title,
        level: insight.level,
        paperCode: insight.paperCode,
        generatedAt: insight.generatedAt,
      })),
  };
};

export const buildBrowseTree = (papers: any[]) => {
  const categories = new Map<string, any>();
  for (const paper of papers) {
    const category = paper.categoryId;
    const categoryId = String(category?._id || category);
    if (!categories.has(categoryId)) {
      categories.set(categoryId, {
        category: category?._id
          ? { _id: category._id, name: category.name, status: category.status }
          : { _id: categoryId },
        years: new Map<number, Map<string, any[]>>(),
      });
    }
    const bucket = categories.get(categoryId);
    if (!bucket.years.has(paper.year)) {
      bucket.years.set(paper.year, new Map<string, any[]>());
    }
    const levels = bucket.years.get(paper.year);
    const level = String(paper.level);
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level).push(serializePaper(paper));
  }

  return Array.from(categories.values()).map((category) => ({
    category: category.category,
    years: Array.from(category.years.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([year, levels]) => ({
        year,
        levels: Array.from(levels.entries())
          .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
          .map(([level, papersForLevel]) => ({
            level,
            papers: papersForLevel.sort((a: any, b: any) =>
              String(a.sitting || "").localeCompare(String(b.sitting || ""))
            ),
          })),
      })),
  }));
};

export const serializePaper = (paper: any, extra: Record<string, unknown> = {}) => ({
  _id: paper._id,
  categoryId: paper.categoryId,
  year: paper.year,
  sitting: paper.sitting || "",
  level: paper.level,
  title: paper.title,
  paperCode: paper.paperCode || "",
  fileKey: paper.fileKey,
  fileName: paper.fileName,
  fileUrl: paper.fileUrl || publicFileUrl(paper.fileKey),
  fileSizeMB: paper.fileSizeMB,
  status: paper.status,
  processStatus: paper.processStatus,
  questionCount: paper.questionCount,
  lastError: paper.lastError,
  processedAt: paper.processedAt,
  createdAt: paper.createdAt,
  updatedAt: paper.updatedAt,
  ...extra,
});

const topicKey = (value: unknown) => {
  const raw = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const standard = raw.match(/\b(?:ifrs|ias|ipsas)\s*\d+[a-z]?\b/);
  if (standard) return standard[0].replace(/\s+/g, " ");
  return raw;
};

export const classifyQuestionTopics = (
  items: Array<{ number?: string; question?: string; marks?: number | null }>,
  paper: { paperCode?: string; title?: string; year?: number; sitting?: string }
) => {
  const all = loadSyllabusTopicRows(paper);
  const sectionsOrStandards = all.filter(
    (topic) => topic.kind === "syllabus_section" || topic.kind === "standard" || (topic.standards || []).length
  );
  const kbTopics = all.filter((topic) => topic.kind === "kb_topic");
  // Prefer official sections/standards; fall back to kb topics when a paper has no section map.
  const catalog = sectionsOrStandards.length
    ? sectionsOrStandards
    : kbTopics.length
      ? kbTopics
      : all;
  const buckets = new Map<
    string,
    { topic: string; count: number; years: number[]; questionNumbers: string[] }
  >();

  (items || []).forEach((item) => {
    const matched = matchSyllabusTopic(String(item.question || ""), catalog, 1.5);
    if (!matched) return;
    const label = formatSyllabusDisplay(matched.topic) || leafTopicLabel(matched.topic.label);
    const key = topicKey(label);
    if (!key) return;
    const next = buckets.get(key) || {
      topic: label,
      count: 0,
      years: paper.year ? [Number(paper.year)] : [],
      questionNumbers: [] as string[],
    };
    next.count += 1;
    if (item.number) next.questionNumbers.push(String(item.number));
    buckets.set(key, next);
  });

  return Array.from(buckets.values()).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
};

export const rebuildPaperInsightTopics = async (paperId: string) => {
  const paper = await PastQuestionPaper.findById(paperId);
  if (!paper) return null;
  const items = await PastQuestionItem.find({ paper: paper._id }).sort({ order: 1 }).lean();
  const topics = classifyQuestionTopics(items, paper);
  return PastQuestionInsight.findOneAndUpdate(
    { scope: PastQuestionInsightScope.PAPER, paper: paper._id },
    {
      $set: {
        topics,
        generatedAt: new Date(),
      },
    },
    { new: true }
  );
};

const mapTopicToSyllabusLabel = (label: string, allowed: string[], rows: SyllabusTopicRow[] = []) => {
  const leaf = leafTopicLabel(label);
  if (!allowed.length && !rows.length) return leaf;
  const catalog = rows.length ? rows : allowed.map((item) => ({ label: item } as SyllabusTopicRow));
  const resolved = resolveCanonicalTopicLabel(leaf, catalog as SyllabusTopicRow[]);
  if (resolved !== leaf) return resolved;
  const lower = leaf.toLowerCase();
  const std = (lower.match(/\b(?:ifrs|ias|ipsas)\s*\d+[a-z]?\b/) || [])[0];
  if (std) {
    const hit = (catalog as SyllabusTopicRow[]).find(
      (item) =>
        item.label.toLowerCase().includes(std) ||
        (item.standards || []).some((code) => String(code).toLowerCase().includes(std))
    );
    if (hit) return formatSyllabusDisplay(hit) || leafTopicLabel(hit.label);
  }
  let best: SyllabusTopicRow | null = null;
  let bestScore = 0;
  (catalog as SyllabusTopicRow[]).forEach((item) => {
    const words = item.label
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3);
    if (!words.length) return;
    const hits = words.filter((word) => lower.includes(word)).length;
    const score = hits / words.length;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  });
  if (best && bestScore >= 0.45) return formatSyllabusDisplay(best) || leafTopicLabel(best.label);
  return leaf;
};

export const buildCourseTopicFrequency = async (papers: any[]) => {
  if (!papers?.length) {
    return {
      sittings: 0,
      topics: [] as Array<{
        topic: string;
        questions: number;
        sittings: number;
        years: number[];
        sittingLabels: string[];
      }>,
    };
  }

  const sample = papers[0];
  const syllabusRows = Array.from(
    new Map(
      papers
        .flatMap((paper) =>
          loadSyllabusTopicRows({
            paperCode: paper.paperCode || sample?.paperCode,
            title: paper.title || sample?.title,
            year: paper.year,
            sitting: paper.sitting,
          })
        )
        .map((topic) => [topic.label.toLowerCase(), topic])
    ).values()
  );
  const syllabusTopics = syllabusRows.map((topic) => topic.label);

  const paperIds = papers.map((paper) => paper._id);
  const paperById = new Map(papers.map((paper) => [String(paper._id), paper]));
  const insights = await PastQuestionInsight.find({
    scope: PastQuestionInsightScope.PAPER,
    paper: { $in: paperIds },
  }).lean();

  const buckets = new Map<
    string,
    {
      topic: string;
      questions: number;
      years: Set<number>;
      sittingKeys: Set<string>;
      sittingLabels: Set<string>;
      paperIds: Set<string>;
    }
  >();

  insights.forEach((insight: any) => {
    const paper = paperById.get(String(insight.paper));
    if (!paper) return;
    const year = Number(paper.year) || Number((insight.years || [])[0]) || 0;
    const sittingLabel = [paper.sitting, paper.year].filter(Boolean).join(" ").trim();
    const sittingKey = `${paper.year}|${paper.sitting || ""}|${paper._id}`;
    (insight.topics || []).forEach((row: any) => {
      const raw = String(row?.topic || row || "").trim();
      if (!raw) return;
      const label = mapTopicToSyllabusLabel(raw, syllabusTopics, syllabusRows);
      const key = topicKey(label);
      if (!key) return;
      // Skip topics not effective for this sitting
      const topicMeta = syllabusRows.find(
        (item) => leafTopicLabel(item.label).toLowerCase() === label.toLowerCase()
      );
      if (topicMeta && !isTopicEffectiveForSitting(topicMeta, paper.year, paper.sitting)) return;
      const next = buckets.get(key) || {
        topic: label,
        questions: 0,
        years: new Set<number>(),
        sittingKeys: new Set<string>(),
        sittingLabels: new Set<string>(),
        paperIds: new Set<string>(),
      };
      if (label.length >= next.topic.length) next.topic = label;
      next.questions += Math.max(1, Number(row?.count) || 1);
      if (year) next.years.add(year);
      (Array.isArray(row?.years) ? row.years : []).forEach((value: unknown) => {
        const parsed = Number(value);
        if (parsed) next.years.add(parsed);
      });
      next.sittingKeys.add(sittingKey);
      next.paperIds.add(String(paper._id));
      if (sittingLabel) next.sittingLabels.add(sittingLabel);
      buckets.set(key, next);
    });
  });

  return {
    sittings: papers.length,
    topics: Array.from(buckets.values())
      .map((item) => ({
        topic: item.topic,
        questions: item.questions,
        sittings: item.sittingKeys.size,
        years: Array.from(item.years).sort((a, b) => a - b),
        sittingLabels: Array.from(item.sittingLabels).sort((a, b) => {
          const yearA = Number(String(a).match(/\d{4}/)?.[0] || 0);
          const yearB = Number(String(b).match(/\d{4}/)?.[0] || 0);
          return yearB - yearA || String(a).localeCompare(String(b));
        }),
        paperIds: Array.from(item.paperIds),
      }))
      .sort(
        (a, b) =>
          b.sittings - a.sittings ||
          b.questions - a.questions ||
          a.topic.localeCompare(b.topic)
      ),
  };
};

export const getGeneralRagCollections = async (
  email?: string,
  extraFilter?: Record<string, unknown>
) => {
  const collections: Array<{ name: string; filter?: Record<string, unknown> }> =
    [{ name: SUBSCRIPTION_COLLECTION_NAME, filter: extraFilter }];
  const courseIds = await getUserEnrolledCourseIds(email);
  if (courseIds.length > 0) {
    collections.push({
      name: COLLECTION_NAME,
      filter: {
        must: [
          {
            should: [
              { key: "courseId", match: { any: courseIds } },
              { key: "courseIds", match: { any: courseIds } },
            ],
          },
        ],
      },
    });
  }
  return collections;
};

export const getPastQuestionContext = async (params: {
  email?: string;
  question: string;
  paper?: any;
  item?: any;
  scope: "course" | "paper" | "question";
}) => {
  const parts: string[] = [];
  if (params.scope === "question" && params.item) {
    parts.push(
      [
        `Past question ${params.item.number || ""}`.trim(),
        params.item.question,
        params.item.answer ? `Suggested solution:\n${params.item.answer}` : "",
        params.item.answerNotes ? `Answer notes:\n${params.item.answerNotes}` : "",
      ]
        .filter(Boolean)
        .join("\n\n")
    );
  } else if (params.scope === "paper" && params.paper) {
    const items = await PastQuestionItem.find({ paper: params.paper._id }).sort({
      order: 1,
    });
    parts.push(itemCorpus(items, params.paper) || params.paper.extractedText || "");
  }

  const embeddingVector = await embedText(params.question);
  const pqFilter =
    params.scope === "question" && params.item
      ? {
          must: [
            { key: "paperId", match: { value: String(params.paper._id) } },
            { key: "questionId", match: { value: String(params.item._id) } },
          ],
        }
      : params.scope === "paper" && params.paper
        ? paperFilter(String(params.paper._id))
        : params.paper
          ? {
              must: [
                {
                  key: "categoryId",
                  match: { value: String(params.paper.categoryId) },
                },
                {
                  key: "paperCode",
                  match: { value: String(params.paper.paperCode || "") },
                },
              ],
            }
          : undefined;

  const collections = [
    ...(await getGeneralRagCollections(params.email)),
    {
      name: PAST_QUESTION_COLLECTION_NAME,
      filter: pqFilter,
    },
  ];
  const searchResult = await searchAiCollections({
    collections,
    embeddingVector,
    limit: 8,
  });
  const rag = searchResult
    .map((point) => point.payload?.text)
    .filter(Boolean)
    .join("\n\n");
  if (rag) parts.push(rag);
  return parts.join("\n\n");
};

export const findCoursePapers = (params: {
  categoryId: string;
  level: string;
  paperCode?: string;
  title?: string;
}) => {
  const code = String(params.paperCode || "").trim().toUpperCase();
  const filter: Record<string, unknown> = {
    categoryId: new mongoose.Types.ObjectId(params.categoryId),
    level: String(params.level).trim(),
    status: PastQuestionStatus.ACTIVE,
    processStatus: PastQuestionProcessStatus.SUCCESS,
  };
  if (code) filter.paperCode = code;
  else if (params.title) filter.title = params.title;
  return PastQuestionPaper.find(filter).sort({ year: -1, sitting: 1 });
};
