import mongoose from "mongoose";
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

const INSIGHTS_PROMPT = `You are an ICAG exam analyst. From the past questions provided, produce one-time study insights.
Return ONLY JSON with this shape:
{
  "summary": "2-4 sentence overview",
  "repeatedQuestions": [{"theme": "string", "count": number, "years": [number], "examples": ["short quote"]}],
  "topics": [{"topic": "string", "count": number, "years": [number]}],
  "trends": ["string"],
  "facts": ["string"]
}
Count frequency of repeated themes and topics across years. Be specific. If data is thin, still return the keys with empty arrays.`;

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

const generateInsightPayload = async (label: string, corpus: string) => {
  const completion = await geminiChatModel.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `${INSIGHTS_PROMPT}\n\n${label}\n\n${corpus.slice(0, 140000)}`,
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
    topics: Array.isArray(parsed?.topics) ? parsed.topics : [],
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
    itemCorpus(items, paper) || paper.extractedText || ""
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
    corpus
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
