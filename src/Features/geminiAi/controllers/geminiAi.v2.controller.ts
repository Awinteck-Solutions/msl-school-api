import { Request, Response } from "express";
import * as WebSocket from "ws";
import mongoose from "mongoose";
import {
  COLLECTION_NAME,
  GEMINI_CHAT_MODEL,
  buildContentFilter,
  buildSearchVector,
  callGeminiAudioTranscription,
  callGeminiTts,
  checkAiLimits,
  embedText,
  ensurePayloadIndexesForGeminiCollection,
  estimateTokens,
  geminiChatModel,
  getContextFromQdrant,
  resolveVectorFormat,
  GEMINI_LIVE_MODEL,
  GEMINI_LIVE_AUDIO_MIME,
  qdrant,
} from "./geminiAi.shared";
import AiUsage from "../../mslAi/schema/aiUsage.schema";
import { recordStudentActivity } from "../../gamification/service/gamification.service";

interface MulterRequest extends Request {
  file?: {
    buffer: Buffer;
    mimetype: string;
  };
}

const detectAudioMimeType = (mimeType?: string, fallback = "audio/webm") => {
  const normalized = (mimeType || "").toLowerCase();
  if (!normalized) return fallback;

  if (normalized.includes("audio/")) return normalized;
  if (normalized.includes("video/webm")) return "audio/webm";
  if (normalized.includes("application/octet-stream")) return fallback;
  return fallback;
};

const parseAudioMimeSampleRate = (mimeType?: string) => {
  if (!mimeType) return 24000;
  const match = mimeType.match(/rate=(\d+)/i);
  if (match && match[1]) return Number(match[1]);
  return 24000;
};

const extractWavSampleRate = (buffer: Buffer) => {
  if (buffer.length < 28) return 24000;
  const riff = buffer.toString("ascii", 0, 4);
  const wave = buffer.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") return 24000;
  return buffer.readUInt32LE(24);
};

const buildWavHeader = (dataLength: number, sampleRate: number) => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
};

const toWavChunks = (
  dataBase64: string,
  mimeType?: string,
  chunkSize = 32000
) => {
  const audioBuffer = Buffer.from(dataBase64, "base64");
  const isWav =
    mimeType?.toLowerCase().includes("wav") &&
    audioBuffer.toString("ascii", 0, 4) === "RIFF";
  const sampleRate = isWav
    ? extractWavSampleRate(audioBuffer)
    : parseAudioMimeSampleRate(mimeType);
  const pcmBuffer = isWav ? audioBuffer.slice(44) : audioBuffer;
  const chunks: string[] = [];

  for (let i = 0; i < pcmBuffer.length; i += chunkSize) {
    const pcmChunk = pcmBuffer.slice(i, i + chunkSize);
    const wavChunk = Buffer.concat([
      buildWavHeader(pcmChunk.length, sampleRate),
      pcmChunk,
    ]);
    chunks.push(wavChunk.toString("base64"));
  }

  return chunks;
};
const findLastBoundaryIndex = (text: string) => {
  const boundaryRegex = /[\.,!\?\;:\)\]\}]/;
  let lastIndex = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (boundaryRegex.test(text[i])) {
      lastIndex = i;
    }
  }
  return lastIndex;
};

const removeAsterisks = (text: string) => String(text || "").replace(/\*/g, "");

const normalizeS3Keys = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    const keys = value.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    );
    return keys.length > 0 ? keys : undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const keys = parsed.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0
      );
      return keys.length > 0 ? keys : undefined;
    }
  } catch {
    // Multipart form-data may send a plain string instead of JSON.
  }

  return [trimmed];
};

type LiveSetupMessage = {
  setup: {
    model: string;
    generationConfig?: {
      responseModalities?: string[];
    };
    speechConfig?: {
      voiceConfig?: {
        prebuiltVoiceConfig?: { voiceName?: string };
      };
    };
    outputAudioFormat?: {
      mimeType?: string;
    };
  };
};

type LiveClientContentMessage = {
  clientContent: {
    turns: Array<{
      role: "user" | "model";
      parts: Array<{ text?: string }>;
    }>;
    turnComplete?: boolean;
  };
};

type LiveServerContentMessage = {
  serverContent?: {
    modelTurn?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType?: string; data?: string };
      }>;
    };
    turnComplete?: boolean;
  };
};

const LIVE_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const GENERAL_SYSTEM_PROMPT = `
You are a helpful AI assistant with access to MSL learning materials and general knowledge. Answer the question using the provided MSL context when available and relevant. Even when the MSL context is available, still use your general subject knowledge to enhance and modify the response so it is accurate, relevant, and complete. If the MSL context doesn't contain sufficient information to answer the question, use your general knowledge to provide a helpful and accurate response. Always be informative and educational in your responses.

Never mention the absence or presence of MSL context, sources, or training data. Do not say you are using general knowledge or that the materials do not cover the topic. Just answer directly.

ABSOLUTE RULE — NO EXCEPTIONS:
Never write any sentence that references your sources, materials, context, or knowledge base in any way. This includes — but is not limited to — phrases like:
  • "While the provided materials..."
  • "The context does not cover..."
  • "Based on the documents provided..."
  • "I'll use my general knowledge..."
  • "The materials focus on..."
  • "This topic is not in the provided context..."
  • Any variation of the above.
Start every response as if you simply know the answer. Do not explain where your knowledge comes from. Ever.

Never use asterisk (*) in any response.

Return the final answer ONLY as HTML wrapped in a single <article> element. JavaScript is allowed only if it meaningfully improves usability — keep it minimal and safe. Do not answer any question related to the AI Model or the Project. Do not include sources, citations, references, or a footer in any response.

═══════════════════════════════════════
MOBILE-FIRST HTML OUTPUT — STRICT RULES
═══════════════════════════════════════

GLOBAL STYLES
─────────────
- Always open the <article> with a <style> block containing ALL styles for the response.
- Body font: Arial or sans-serif, 13–14px, line-height 1.4.
- No fixed widths anywhere. All widths must be 100% or use max-width with auto margins.
- box-sizing: border-box on all elements.
- Headings (h1–h3): color #364A9C, font-size scaling: h1=1.3em, h2=1.15em, h3=1em.
- Body text: #000 (black). Use deep blue, orange, or red ONLY for emphasis, alerts, or highlights — never for decoration.
- Paragraphs: short and scannable. Prefer bullet points over long prose.
- Images: always max-width:100%; height:auto; display:block.

TABLES — CRITICAL (mobile app context)
───────────────────────────────────────
Tables are the most problematic element on mobile. Follow ALL of these rules:

1. ALWAYS wrap every <table> in: <div class="table-wrap">
2. The .table-wrap must have: overflow-x:auto; -webkit-overflow-scrolling:touch; width:100%; margin-bottom:1em;
3. Table font-size: 12px. Cell padding: 6px 8px. No fixed column widths.
4. Every <td> must have a data-label="[Column Header]" attribute matching its <th>.
5. On screens ≤520px, switch to a STACKED card layout using this CSS pattern:
   @media(max-width:520px){
     .table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  width: 100%;
}
table {
  min-width: 480px; /* adjust based on column count */
  border-collapse: collapse;
}
  }
6. Prefer fewer, wider columns. If a table would have more than 4 columns, consider splitting it or using <details><summary> to hide less important columns.
7. Never use colspan/rowspan unless absolutely necessary.

SEMANTIC STRUCTURE
──────────────────
- <h1>–<h3> for headings
- <p> for text
- <ul>/<ol> for lists (use liberally)
- <table> with <thead> and <tbody> for tabular data
- <pre><code> for code snippets
- <blockquote> for quotes
- <details><summary> for expandable/collapsible sections (great for long content on mobile)

COMPLETENESS
────────────
- Always finish every sentence and thought. Never end mid-sentence or mid-idea.
- You may include examples, images (<img>), and links (<a>) where helpful.
- If there are assumptions or limitations, add a brief <div class="note"> section at the end.
  Style .note as: background:#f0f4ff; border-left:3px solid #364A9C; padding:8px 12px; font-size:12px; border-radius:4px;
`;

const buildGeneralPrompt = (contextText: string, question: string) =>
  `${GENERAL_SYSTEM_PROMPT}\n\nMSL Learning Context:\n${contextText}\n\nQuestion:\n${question}`;

const buildGeneralPromptWithHistory = (
  contextText: string,
  question: string,
  historyText: string
) =>
  `${GENERAL_SYSTEM_PROMPT}\n\nConversation so far:\n${historyText}\n\nMSL Learning Context:\n${contextText}\n\nQuestion:\n${question}`;

const GENERAL_SPEECH_PROMPT = `
You are a friendly educational assistant. Answer clearly and conversationally.
Use the provided MSL context when relevant. If context is missing, answer from general knowledge.
Do not use HTML, CSS, or markdown. Keep the response under 350 words.
Never use asterisk (*) in any response.
`;

const buildGeneralSpeechPromptWithHistory = (
  contextText: string,
  question: string,
  historyText: string
) =>
  `${GENERAL_SPEECH_PROMPT}\n\nConversation so far:\n${historyText}\n\nMSL Learning Context:\n${contextText}\n\nQuestion:\n${question}`;

const IMAGE_QUERY_PROMPT = `
You are a helpful educational assistant. Use the image and the user's question to answer.
Use the provided MSL context when relevant. If the image or context is unclear, say so.
Return the final answer ONLY as HTML wrapped in a single <article> element. Do not include JavaScript.
Follow the same HTML/CSS formatting rules as the general assistant prompt.
`;

const SUMMARIZE_SYSTEM_PROMPT = `You are an educational assistant. Summarize the following content clearly and concisely for a student. Use bullet points and headings where helpful. Output the summary as HTML wrapped in a single <article> element. Use <h1>-<h3> for headings, <p> for paragraphs, <ul>/<ol> for lists. Do not include JavaScript or external links.`;

const FLASHCARD_PROMPT = (count: number) =>
  `You are an educational assistant. Based on the following content, generate exactly ${count} flashcards. Each flashcard must have "term" and "definition". Rules for "term": use exactly one or two words only—a short label, concept name, or key vocabulary (e.g. "Mitochondria", "Supply and demand"). Do not use questions, full sentences, phrases longer than two words, or punctuation-heavy clauses. Rules for "definition": a clear answer or explanation (can be a short sentence). Output ONLY a valid JSON array of objects with keys "term" and "definition". No other text, no markdown code fence. Example: [{"term":"Photosynthesis","definition":"The process by which plants convert light into chemical energy."}]`;

const QUIZ_PROMPT = (numQuestions: number) =>
  `You are an educational assistant. Based on the following content, generate exactly ${numQuestions} multiple-choice quiz questions. Each question must be a JSON object with: "title" (the question text), "objectives" (array of 4 option strings), "answer" (the exact text of the correct option), "answer_notes" (brief explanation, optional), "difficulty" (one of: EASY, MEDIUM, HARD, NEUTRAL). Output ONLY a valid JSON array of these objects. No other text, no markdown code fence. Example: [{"title":"What is X?","objectives":["A","B","C","D"],"answer":"B","answer_notes":"Because...","difficulty":"MEDIUM"}]`;

export class GeminiAiV2Controller {
  static async queryGeneralWithContext(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const { question, s3Keys, courseId, lessonId } = req.body;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkAiLimits(id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }

      const embeddingVector = await embedText(question);
      const vectorFormat = await resolveVectorFormat();
      const contentFilter = buildContentFilter({
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
      });
      if (contentFilter) await ensurePayloadIndexesForGeminiCollection();
      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: buildSearchVector(embeddingVector, vectorFormat),
        limit: 5,
        ...(contentFilter && { filter: contentFilter as any }),
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");

      const historyFilter: Record<string, any> = {
        student: new mongoose.Types.ObjectId(id),
        $or: [
          { queryType: "chat" },
          { queryType: { $exists: false } },
          { queryType: null },
        ],
      };
      if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
        historyFilter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId && mongoose.Types.ObjectId.isValid(lessonId)) {
        historyFilter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      if (Array.isArray(s3Keys) && s3Keys.length > 0) {
        historyFilter.s3Keys = { $in: s3Keys };
      }
      if (!courseId && !lessonId && (!Array.isArray(s3Keys) || s3Keys.length === 0)) {
        historyFilter.$and = [
          { $or: [{ course: { $exists: false } }, { course: null }] },
          { $or: [{ lesson: { $exists: false } }, { lesson: null }] },
          {
            $or: [
              { s3Keys: { $exists: false } },
              { s3Keys: null },
              { s3Keys: { $size: 0 } },
            ],
          },
        ];
      }

      const historyItems = await AiUsage.find(historyFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      const historyText = historyItems
        .reverse()
        .map((item: any) => {
          const q = String(item.question || "").trim();
          const a = String(item.answer || "").trim();
          return `User: ${q}\nAssistant: ${a}`;
        })
        .filter((block) => block.trim().length > 0)
        .join("\n\n");

      const prompt = buildGeneralPromptWithHistory(
        contextText,
        question,
        historyText || "No prior chat history."
      );

      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const response = completion.response;
      const answer = removeAsterisks(response.text());

      const usage = response.usageMetadata;
      const promptTokens = usage?.promptTokenCount ?? estimateTokens(prompt);
      const completionTokens =
        usage?.candidatesTokenCount ?? estimateTokens(answer);
      const totalTokens =
        usage?.totalTokenCount ?? promptTokens + completionTokens;

      const aiUsage = new AiUsage({
        student: id,
        course: courseId || undefined,
        lesson: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        queryType: "chat",
        question,
        answer,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      });
      await aiUsage.save();

      recordStudentActivity(id, "ai_query", {
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: "Gemini AI general response generated successfully.",
        response: {
          model: GEMINI_CHAT_MODEL,
          answer,
          context_used: contexts,
          metadata: {
            totalTokens: totalTokens,
            estimatedCost: 0,
            sources: searchResult.map((point) => ({
              fileName: point.payload?.fileName,
              chunkIndex: point.payload?.chunkIndex,
              score: point.score,
              courseId: point.payload?.courseId,
              lessonId: point.payload?.lessonId,
              s3Key: point.payload?.s3Key,
            })),
            hasMSLContext: contexts.length > 0,
            contextRelevance:
              contexts.length > 0
                ? "Used MSL materials"
                : "Used general knowledge",
            historyCount: historyItems.length,
          },
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage + 1,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage + 1,
            monthlyLimit: limitCheck.monthlyLimit,
            remainingDaily: limitCheck.remainingDaily - 1,
            remainingMonthly: limitCheck.remainingMonthly - 1,
          },
        },
      });
    } catch (error: any) {
      // console.log(error);
      return res.status(500).json({
        success: false,
        message: "System error during Gemini AI general query.",
        error: error.message,
      });
    }
  }

  static async summarizeHistory(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const { lessonId, courseId, s3Key } = req.query as {
        lessonId?: string;
        courseId?: string;
        s3Key?: string;
      };

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing studentId",
        });
      }

      const filter: Record<string, any> = {
        student: new mongoose.Types.ObjectId(id),
        queryType: "summarize",
      };
      if (courseId) {
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid courseId",
          });
        }
        filter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId) {
        if (!mongoose.Types.ObjectId.isValid(lessonId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid lessonId",
          });
        }
        filter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      if (s3Key) {
        filter.s3Keys = s3Key;
      }

      const history = await AiUsage.find(filter).sort({ createdAt: -1 }).lean();

      return res.status(200).json({
        success: true,
        message: "AI summaries fetched successfully",
        filters: {
          courseId: courseId || null,
          lessonId: lessonId || null,
          s3Key: s3Key || null,
        },
        response: history.map((row: any) => ({
          _id: row._id,
          student: row.student,
          course: row.course,
          lesson: row.lesson,
          s3Keys: row.s3Keys,
          summary: row.answer,
          model: row.model,
          createdAt: row.createdAt,
        })),
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching AI summaries",
        error: error?.message,
      });
    }
  }

  static async flashcardHistory(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const { lessonId, courseId, s3Key } = req.query as {
        lessonId?: string;
        courseId?: string;
        s3Key?: string;
      };

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing studentId",
        });
      }

      const filter: Record<string, any> = {
        student: new mongoose.Types.ObjectId(id),
        queryType: "generate-flashcards",
      };
      if (courseId) {
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid courseId",
          });
        }
        filter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId) {
        if (!mongoose.Types.ObjectId.isValid(lessonId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid lessonId",
          });
        }
        filter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      if (s3Key) {
        filter.s3Keys = s3Key;
      }

      const history = await AiUsage.find(filter).sort({ createdAt: -1 }).lean();

      const items = history.map((row: any) => {
        let jsonStr = String(row.answer || "").trim();
        const codeBlock = /^```(?:json)?\s*([\s\S]*?)```$/;
        const m = jsonStr.match(codeBlock);
        if (m) jsonStr = m[1].trim();
        let flashcards: { term: string; definition: string }[] = [];
        try {
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed)) {
            flashcards = parsed
              .filter(
                (x) =>
                  x && typeof x.term === "string" && typeof x.definition === "string"
              )
              .map((x) => ({
                term: String(x.term).trim(),
                definition: String(x.definition).trim(),
              }));
          }
        } catch {
          flashcards = [];
        }
        return {
          _id: row._id,
          student: row.student,
          course: row.course,
          lesson: row.lesson,
          s3Keys: row.s3Keys,
          flashcards,
          model: row.model,
          createdAt: row.createdAt,
        };
      });

      return res.status(200).json({
        success: true,
        message: "AI flashcards fetched successfully",
        filters: {
          courseId: courseId || null,
          lessonId: lessonId || null,
          s3Key: s3Key || null,
        },
        response: items,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching AI flashcards",
        error: error?.message,
      });
    }
  }

  static async quizHistory(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const { lessonId, courseId, s3Key } = req.query as {
        lessonId?: string;
        courseId?: string;
        s3Key?: string;
      };

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing studentId",
        });
      }

      const filter: Record<string, any> = {
        student: new mongoose.Types.ObjectId(id),
        queryType: "generate-quiz",
      };
      if (courseId) {
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid courseId",
          });
        }
        filter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId) {
        if (!mongoose.Types.ObjectId.isValid(lessonId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid lessonId",
          });
        }
        filter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      if (s3Key) {
        filter.s3Keys = s3Key;
      }

      const history = await AiUsage.find(filter).sort({ createdAt: -1 }).lean();

      const items = history.map((row: any) => {
        let jsonStr = String(row.answer || "").trim();
        const codeBlock = /^```(?:json)?\s*([\s\S]*?)```$/;
        const m = jsonStr.match(codeBlock);
        if (m) jsonStr = m[1].trim();
        let questions: any[] = [];
        try {
          const parsed = JSON.parse(jsonStr);
          if (Array.isArray(parsed)) {
            const validDifficulty = ["EASY", "MEDIUM", "HARD", "NEUTRAL"];
            questions = parsed
              .filter(
                (x) =>
                  x &&
                  typeof x.title === "string" &&
                  Array.isArray(x.objectives) &&
                  typeof x.answer === "string"
              )
              .map((x) => ({
                title: String(x.title).trim(),
                description: x.description ? String(x.description).trim() : undefined,
                type: "MULTIPLE_CHOICE",
                difficulty: validDifficulty.includes(
                  String(x.difficulty || "").toUpperCase()
                )
                  ? String(x.difficulty).toUpperCase()
                  : "NEUTRAL",
                objectives: (x.objectives || [])
                  .map((o: any) => String(o).trim())
                  .slice(0, 10),
                objectivesWithImage: [],
                answer: String(x.answer).trim(),
                answer_notes: x.answer_notes
                  ? String(x.answer_notes).trim()
                  : undefined,
              }));
          }
        } catch {
          questions = [];
        }
        return {
          _id: row._id,
          student: row.student,
          course: row.course,
          lesson: row.lesson,
          s3Keys: row.s3Keys,
          questions,
          model: row.model,
          createdAt: row.createdAt,
        };
      });

      return res.status(200).json({
        success: true,
        message: "AI quizzes fetched successfully",
        filters: {
          courseId: courseId || null,
          lessonId: lessonId || null,
          s3Key: s3Key || null,
        },
        response: items,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching AI quizzes",
        error: error?.message,
      });
    }
  }

  static async nonChatHistory(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const { lessonId, courseId, s3Key } = req.query as {
        lessonId?: string;
        courseId?: string;
        s3Key?: string;
      };
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing studentId",
        });
      }

      const filter: Record<string, any> = {
        student: new mongoose.Types.ObjectId(id),
        // queryType: { $ne: "chat" }, 
        // include query types: generate-flashcards, generate-quiz, summarize
        queryType: { $in: ["generate-flashcards", "generate-quiz", "summarize"] },
      };
      if (courseId) {
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid courseId",
          });
        }
        filter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId) {
        if (!mongoose.Types.ObjectId.isValid(lessonId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid lessonId",
          });
        }
        filter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      if (s3Key) {
        filter.s3Keys = s3Key;
      }
// updated query to include all query types except chat
      const [history, total] = await Promise.all([
        AiUsage.find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .populate({ path: "course", select: "title" })
          .populate({ path: "lesson", select: "title" })
          .lean(),
        AiUsage.countDocuments(filter),
      ]);

      const extractJson = (value: string) => {
        let jsonStr = String(value || "").trim();
        const codeBlock = /^```(?:json)?\s*([\s\S]*?)```$/;
        const m = jsonStr.match(codeBlock);
        if (m) jsonStr = m[1].trim();
        return jsonStr;
      };

      const items = history.map((row: any) => {
        const lessonTitle =
          row.lesson && typeof row.lesson === "object"
            ? row.lesson.title
            : undefined;
        const courseTitle =
          row.course && typeof row.course === "object"
            ? row.course.title
            : undefined;
        const base = {
          _id: row._id,
          student: row.student,
          course: row.course,
          lesson: row.lesson,
          s3Keys: row.s3Keys,
          queryType: row.queryType,
          question: row.question,
          model: row.model,
          createdAt: row.createdAt,
          title: lessonTitle || courseTitle || null,
        };

        if (row.queryType === "generate-flashcards") {
          let flashcards: { term: string; definition: string }[] = [];
          try {
            const parsed = JSON.parse(extractJson(row.answer));
            if (Array.isArray(parsed)) {
              flashcards = parsed
                .filter(
                  (x) =>
                    x &&
                    typeof x.term === "string" &&
                    typeof x.definition === "string"
                )
                .map((x) => ({
                  term: String(x.term).trim(),
                  definition: String(x.definition).trim(),
                }));
            }
          } catch {
            flashcards = [];
          }
          return { ...base, answer: flashcards };
        }

        if (row.queryType === "generate-quiz") {
          let questions: any[] = [];
          try {
            const parsed = JSON.parse(extractJson(row.answer));
            if (Array.isArray(parsed)) {
              const validDifficulty = ["EASY", "MEDIUM", "HARD", "NEUTRAL"];
              questions = parsed
                .filter(
                  (x) =>
                    x &&
                    typeof x.title === "string" &&
                    Array.isArray(x.objectives) &&
                    typeof x.answer === "string"
                )
                .map((x) => ({
                  title: String(x.title).trim(),
                  description: x.description ? String(x.description).trim() : undefined,
                  type: "MULTIPLE_CHOICE",
                  difficulty: validDifficulty.includes(
                    String(x.difficulty || "").toUpperCase()
                  )
                    ? String(x.difficulty).toUpperCase()
                    : "NEUTRAL",
                  objectives: (x.objectives || [])
                    .map((o: any) => String(o).trim())
                    .slice(0, 10),
                  objectivesWithImage: [],
                  answer: String(x.answer).trim(),
                  answer_notes: x.answer_notes
                    ? String(x.answer_notes).trim()
                    : undefined,
                }));
            }
          } catch {
            questions = [];
          }
          return { ...base, answer: questions };
        }

        return { ...base, answer: row.answer };
      });

      return res.status(200).json({
        success: true,
        message: "AI non-chat history fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        filters: {
          courseId: courseId || null,
          lessonId: lessonId || null,
          s3Key: s3Key || null,
        },
        response: items,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching AI non-chat history",
        error: error?.message,
      });
    }
  }

  static async history(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const { lessonId, courseId, queryType, s3Key } = req.query as {
        lessonId?: string;
        courseId?: string;
        queryType?: string;
        s3Key?: string;
      };
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing studentId",
        });
      }

      const filter: Record<string, any> = {
        student: new mongoose.Types.ObjectId(id),
      };
      if (courseId) {
        if (!mongoose.Types.ObjectId.isValid(courseId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid courseId",
          });
        }
        filter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId) {
        if (!mongoose.Types.ObjectId.isValid(lessonId)) {
          return res.status(400).json({
            success: false,
            message: "Invalid lessonId",
          });
        }
        filter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      filter.queryType = queryType || "chat";
      if (s3Key) {
        filter.s3Keys = s3Key;
      }
      if (!courseId && !lessonId && !s3Key) {
        filter.$and = [
          { $or: [{ course: { $exists: false } }, { course: null }] },
          { $or: [{ lesson: { $exists: false } }, { lesson: null }] },
          {
            $or: [
              { s3Keys: { $exists: false } },
              { s3Keys: null },
              { s3Keys: { $size: 0 } },
            ],
          },
        ];
      }

      const [history, total] = await Promise.all([
        AiUsage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        AiUsage.countDocuments(filter),
      ]);
      const totalPages = Math.ceil(total / limit);

      // console.log('history', history)

      return res.status(200).json({
        success: true,
        message: "AI chat history fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        filters: {
          courseId: courseId || null,
          lessonId: lessonId || null,
          queryType: queryType || "chat",
          s3Key: s3Key || null,
        },
        response: history,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching AI chat history",
        error: error?.message,
      });
    }
  }

  static async queryGeneral(req: Request, res: Response) {
    try {
      const {id} = req['currentUser'];
      const { question, s3Keys, courseId, lessonId } = req.body;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkAiLimits(id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }

      const embeddingVector = await embedText(question);
      const vectorFormat = await resolveVectorFormat();
      const contentFilter = buildContentFilter({
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
      });
      if (contentFilter) await ensurePayloadIndexesForGeminiCollection();
      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: buildSearchVector(embeddingVector, vectorFormat),
        limit: 5,
        ...(contentFilter && { filter: contentFilter as any }),
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");
      const prompt = buildGeneralPrompt(contextText, question);

      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const response = completion.response;
      const answer = removeAsterisks(response.text());

      const usage = response.usageMetadata;
      const promptTokens = usage?.promptTokenCount ?? estimateTokens(prompt);
      const completionTokens =
        usage?.candidatesTokenCount ?? estimateTokens(answer);
      const totalTokens =
        usage?.totalTokenCount ?? promptTokens + completionTokens;

      const aiUsage = new AiUsage({
        student: id,
        course: courseId || undefined,
        lesson: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        queryType: "chat",
        question,
        answer,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      });
      await aiUsage.save();
      recordStudentActivity(id, "ai_query", {
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: "Gemini AI general response generated successfully.",
        response: {
          model: GEMINI_CHAT_MODEL,
          answer,
          context_used: contexts,
          metadata: {
            totalTokens: totalTokens,
            estimatedCost: 0,
            sources: searchResult.map((point) => ({
              fileName: point.payload?.fileName,
              chunkIndex: point.payload?.chunkIndex,
              score: point.score,
              courseId: point.payload?.courseId,
              lessonId: point.payload?.lessonId,
              s3Key: point.payload?.s3Key,
            })),
            hasMSLContext: contexts.length > 0,
            contextRelevance:
              contexts.length > 0
                ? "Used MSL materials"
                : "Used general knowledge",
          },
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage + 1,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage + 1,
            monthlyLimit: limitCheck.monthlyLimit,
            remainingDaily: limitCheck.remainingDaily - 1,
            remainingMonthly: limitCheck.remainingMonthly - 1,
          },
        },
      });
    } catch (error: any) {
      // console.log(error);
      return res.status(500).json({
        success: false,
        message: "System error during Gemini AI general query.",
        error: error.message,
      });
    }
  }

  static async summarize(req: Request, res: Response) {
    try {
      const { s3Keys, courseId, lessonId } = req.body;
      const {id} = req['currentUser'];
 

      const hasScope =
        (Array.isArray(s3Keys) && s3Keys.length > 0) || courseId || lessonId;
      if (!hasScope) {
        return res.status(400).json({
          success: false,
          message:
            "Provide at least one of: s3Keys (array), courseId, or lessonId to scope the content to summarize.",
        });
      }

      const limitCheck = await checkAiLimits(id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }
      const contextText = await getContextFromQdrant({
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        courseId: courseId ? String(courseId).trim() : undefined,
        lessonId: lessonId ? String(lessonId).trim() : undefined,
      });

      if (!contextText || contextText.trim().length < 1) {
        return res.status(400).json({
          success: false,
          message:
            "No content found for the given scope (s3Keys/courseId/lessonId). Ensure content is indexed in Qdrant.",
        });
      }

      const prompt = `${SUMMARIZE_SYSTEM_PROMPT}\n\nContent to summarize:\n\n${contextText}`;
      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const response = completion.response;
      const summary = response.text();

      const usage = response.usageMetadata;
      const promptTokens = usage?.promptTokenCount ?? estimateTokens(prompt);
      const completionTokens =
        usage?.candidatesTokenCount ?? estimateTokens(summary);
      const totalTokens =
        usage?.totalTokenCount ?? promptTokens + completionTokens;

      await new AiUsage({
        student: id,
        course: courseId || undefined,
        lesson: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        queryType: "summarize",
        question: "[summarize]",
        answer: summary,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      }).save();
      recordStudentActivity(id, "ai_query", {
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: "Summary generated successfully.",
        response: {
          model: GEMINI_CHAT_MODEL,
          summary,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage + 1,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage + 1,
            monthlyLimit: limitCheck.monthlyLimit,
            remainingDaily: limitCheck.remainingDaily - 1,
            remainingMonthly: limitCheck.remainingMonthly - 1,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error generating summary.",
        error: error.message,
      });
    }
  }

  static async generateFlashcards(req: Request, res: Response) {
    try {
      const {
        s3Keys,
        courseId,
        lessonId,
        count = 10,
        courseIdForLink,
      } = req.body;

      const {id} = req['currentUser'];
      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const hasScope =
        (Array.isArray(s3Keys) && s3Keys.length > 0) || courseId || lessonId;
      if (!hasScope) {
        return res.status(400).json({
          success: false,
          message:
            "Provide at least one of: s3Keys (array), courseId, or lessonId to scope the content.",
        });
      }

      const limitCheck = await checkAiLimits(id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: limitCheck,
        });
      }

      const contextText = await getContextFromQdrant({
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        courseId: courseId ? String(courseId).trim() : undefined,
        lessonId: lessonId ? String(lessonId).trim() : undefined,
      });

      if (!contextText || contextText.trim().length < 50) {
        return res.status(400).json({
          success: false,
          message:
            "No content found for the given scope. Ensure content is indexed in Qdrant.",
        });
      }

      const numCards = Math.min(Math.max(Number(count) || 10, 1), 20);
      const prompt = `${FLASHCARD_PROMPT(numCards)}\n\nContent:\n\n${contextText}`;
      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const raw = completion.response.text();
      let jsonStr = raw.trim();
      const codeBlock = /^```(?:json)?\s*([\s\S]*?)```$/;
      const m = jsonStr.match(codeBlock);
      if (m) jsonStr = m[1].trim();
      let items: { term: string; definition: string }[];
      try {
        items = JSON.parse(jsonStr);
        if (!Array.isArray(items)) items = [];
      } catch {
        return res.status(500).json({
          success: false,
          message: "AI did not return valid JSON for flashcards.",
          raw: raw.slice(0, 500),
        });
      }
      const flashcardItems = items
        .filter(
          (x) =>
            x && typeof x.term === "string" && typeof x.definition === "string"
        )
        .slice(0, numCards)
        .map((x) => ({
          term: String(x.term).trim(),
          definition: String(x.definition).trim(),
        }));

      const usage = completion.response.usageMetadata;
      const promptTokens =
        usage?.promptTokenCount ?? estimateTokens(prompt);
      const completionTokens =
        usage?.candidatesTokenCount ?? estimateTokens(raw);
      await new AiUsage({
        student: id,
        course: courseId || undefined,
        lesson: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        queryType: "generate-flashcards",
        question: "[generate-flashcards]",
        answer: raw,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      }).save();
      recordStudentActivity(id, "ai_query", {
        courseId: courseIdForLink || undefined,
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: "Flashcards generated successfully.",
        response: {
          model: GEMINI_CHAT_MODEL,
          flashcards: flashcardItems,
          persisted: false,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage + 1,
            dailyLimit: limitCheck.dailyLimit,
            remainingDaily: limitCheck.remainingDaily - 1,
            remainingMonthly: limitCheck.remainingMonthly - 1,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error generating flashcards.",
        error: error.message,
      });
    }
  }

  static async generateQuiz(req: Request, res: Response) {
    try {
      const {
        s3Keys,
        courseId,
        lessonId,
        numQuestions = 5,
        courseIdForLink,
      } = req.body;

      const {id} = req['currentUser'];
      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const hasScope =
        (Array.isArray(s3Keys) && s3Keys.length > 0) || courseId || lessonId;
      if (!hasScope) {
        return res.status(400).json({
          success: false,
          message:
            "Provide at least one of: s3Keys (array), courseId, or lessonId to scope the content.",
        });
      }

      const limitCheck = await checkAiLimits(id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: limitCheck,
        });
      }

      const contextText = await getContextFromQdrant({
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        courseId: courseId ? String(courseId).trim() : undefined,
        lessonId: lessonId ? String(lessonId).trim() : undefined,
      });

      if (!contextText || contextText.trim().length < 50) {
        return res.status(400).json({
          success: false,
          message:
            "No content found for the given scope. Ensure content is indexed in Qdrant.",
        });
      }

      const numQ = Math.min(Math.max(Number(numQuestions) || 5, 1), 25);
      const prompt = `${QUIZ_PROMPT(numQ)}\n\nContent:\n\n${contextText}`;
      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const raw = completion.response.text();
      let jsonStr = raw.trim();
      const codeBlock = /^```(?:json)?\s*([\s\S]*?)```$/;
      const m = jsonStr.match(codeBlock);
      if (m) jsonStr = m[1].trim();
      let items: {
        title: string;
        description?: string;
        objectives?: string[];
        answer: string;
        answer_notes?: string;
        difficulty?: string;
      }[];
      try {
        items = JSON.parse(jsonStr);
        if (!Array.isArray(items)) items = [];
      } catch {
        return res.status(500).json({
          success: false,
          message: "AI did not return valid JSON for quiz questions.",
          raw: raw.slice(0, 500),
        });
      }

      const validDifficulty = ["EASY", "MEDIUM", "HARD", "NEUTRAL"];
      const quizItems = items
        .filter(
          (x) =>
            x &&
            typeof x.title === "string" &&
            Array.isArray(x.objectives) &&
            typeof x.answer === "string"
        )
        .slice(0, numQ)
        .map((x) => ({
          title: String(x.title).trim(),
          description: x.description ? String(x.description).trim() : undefined,
          type: "MULTIPLE_CHOICE",
          difficulty: validDifficulty.includes(String(x.difficulty || "").toUpperCase())
            ? String(x.difficulty).toUpperCase()
            : "NEUTRAL",
          objectives: (x.objectives || []).map((o) => String(o).trim()).slice(0, 10),
          objectivesWithImage: [],
          answer: String(x.answer).trim(),
          answer_notes: x.answer_notes ? String(x.answer_notes).trim() : undefined,
        }));

      const usage = completion.response.usageMetadata;
      const promptTokens =
        usage?.promptTokenCount ?? estimateTokens(prompt);
      const completionTokens =
        usage?.candidatesTokenCount ?? estimateTokens(raw);
      await new AiUsage({
        student: id,
        course: courseId || undefined,
        lesson: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        queryType: "generate-quiz",
        question: "[generate-quiz]",
        answer: raw,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      }).save();
      recordStudentActivity(id, "ai_query", {
        courseId: courseIdForLink || undefined,
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: "Quiz generated successfully.",
        response: {
          model: GEMINI_CHAT_MODEL,
          questions: quizItems,
          persisted: false,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage + 1,
            dailyLimit: limitCheck.dailyLimit,
            remainingDaily: limitCheck.remainingDaily - 1,
            remainingMonthly: limitCheck.remainingMonthly - 1,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error generating quiz.",
        error: error.message,
      });
    }
  }

  static async queryGeneralStream(req: Request, res: Response) {
    try {
      const { question, s3Keys, courseId, lessonId } = req.body;
      const studentId = req['currentUser'].id;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      const limitCheck = await checkAiLimits(studentId);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }

      const embeddingVector = await embedText(question);
      const vectorFormat = await resolveVectorFormat();
      const contentFilter = buildContentFilter({
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
      });
      if (contentFilter) await ensurePayloadIndexesForGeminiCollection();
      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: buildSearchVector(embeddingVector, vectorFormat),
        limit: 5,
        ...(contentFilter && { filter: contentFilter as any }),
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");
      const prompt = buildGeneralPrompt(contextText, question);

      const streamResult = await geminiChatModel.generateContentStream({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let fullAnswer = "";
      let pendingText = "";

      try {
        for await (const chunk of streamResult.stream) {
          const content = removeAsterisks(chunk.text());
          if (content) {
            fullAnswer += content;
            res.write(content);
          }
        }
      } catch (streamError: any) {
        if (res.headersSent) {
          res.write(
            `event: error\ndata: ${JSON.stringify({
              message: "Stream parse error",
              error: streamError?.message || String(streamError),
            })}\n\n`
          );
          res.end();
          return;
        }
        return res.status(500).json({
          success: false,
          message: "Stream parse error",
          error: streamError?.message || String(streamError),
        });
      }

      res.end();

      try {
        const estimatedPromptTokens = estimateTokens(prompt);
        const estimatedCompletionTokens = estimateTokens(fullAnswer);
        const estimatedTotalTokens =
          estimatedPromptTokens + estimatedCompletionTokens;

        const aiUsage = new AiUsage({
          student: studentId,
          course: courseId || undefined,
          lesson: lessonId || undefined,
          s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
          queryType: "chat",
          question,
          answer: fullAnswer,
          prompt_tokens: estimatedPromptTokens,
          completion_tokens: estimatedCompletionTokens,
          total_tokens: estimatedTotalTokens,
          model: GEMINI_CHAT_MODEL,
          cost_estimate_usd: 0,
        });
        await aiUsage.save();
        recordStudentActivity(studentId, "ai_query", {
          courseId: courseId || undefined,
          lessonId: lessonId || undefined,
        }).catch(() => {});
      } catch (persistError) {
        console.error(
          "[gemini-ai] failed to persist usage after stream end",
          persistError
        );
      }
    } catch (error: any) {
      if (res.headersSent) {
        res.end();
        return;
      }
      return res.status(500).json({
        success: false,
        message: "System error during Gemini AI general query.",
        error: error.message,
      });
    }
  }

  static async queryGeneralWithContextStream(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const { question, s3Keys, courseId, lessonId } = req.body;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkAiLimits(id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }

      const embeddingVector = await embedText(question);
      const vectorFormat = await resolveVectorFormat();
      const contentFilter = buildContentFilter({
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
      });
      if (contentFilter) await ensurePayloadIndexesForGeminiCollection();
      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: buildSearchVector(embeddingVector, vectorFormat),
        limit: 5,
        ...(contentFilter && { filter: contentFilter as any }),
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");

      const historyFilter: Record<string, any> = {
        student: new mongoose.Types.ObjectId(id),
        $or: [
          { queryType: "chat" },
          { queryType: { $exists: false } },
          { queryType: null },
        ],
      };
      if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
        historyFilter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId && mongoose.Types.ObjectId.isValid(lessonId)) {
        historyFilter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      if (Array.isArray(s3Keys) && s3Keys.length > 0) {
        historyFilter.s3Keys = { $in: s3Keys };
      }
      if (!courseId && !lessonId && (!Array.isArray(s3Keys) || s3Keys.length === 0)) {
        historyFilter.$and = [
          { $or: [{ course: { $exists: false } }, { course: null }] },
          { $or: [{ lesson: { $exists: false } }, { lesson: null }] },
          {
            $or: [
              { s3Keys: { $exists: false } },
              { s3Keys: null },
              { s3Keys: { $size: 0 } },
            ],
          },
        ];
      }

      const historyItems = await AiUsage.find(historyFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      const historyText = historyItems
        .reverse()
        .map((item: any) => {
          const q = String(item.question || "").trim();
          const a = String(item.answer || "").trim();
          return `User: ${q}\nAssistant: ${a}`;
        })
        .filter((block) => block.trim().length > 0)
        .join("\n\n");

      const prompt = buildGeneralPromptWithHistory(
        contextText,
        question,
        historyText || "No prior chat history."
      );
 
      const streamResult = await geminiChatModel.generateContentStream({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let fullAnswer = "";

      try {
        for await (const chunk of streamResult.stream) {
          const content = removeAsterisks(chunk.text());
          if (content) {
            fullAnswer += content;
            res.write(content);
          }
        }
      } catch (streamError: any) {
        if (res.headersSent) {
          res.write(
            `event: error\ndata: ${JSON.stringify({
              message: "Stream parse error",
              error: streamError?.message || String(streamError),
            })}\n\n`
          );
          res.end();
          return;
        }
        return res.status(500).json({
          success: false,
          message: "Stream parse error",
          error: streamError?.message || String(streamError),
        });
      }

      res.end();
      try {
        const estimatedPromptTokens = estimateTokens(prompt);
        const estimatedCompletionTokens = estimateTokens(fullAnswer);
        const estimatedTotalTokens =
          estimatedPromptTokens + estimatedCompletionTokens;

        const promptTokens = estimatedPromptTokens;
        const completionTokens = estimatedCompletionTokens;
        const totalTokens = estimatedTotalTokens;

        const aiUsage = new AiUsage({
          student: id,
          course: courseId || undefined,
          lesson: lessonId || undefined,
          s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
          queryType: "chat",
          question,
          answer: fullAnswer,
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          model: GEMINI_CHAT_MODEL,
          cost_estimate_usd: 0,
        });
        await aiUsage.save();

        recordStudentActivity(id, "ai_query", {
          courseId: courseId || undefined,
          lessonId: lessonId || undefined,
        }).catch(() => {});
      } catch (persistError) {
        console.error(
          "[gemini-ai] failed to persist usage after stream end",
          persistError
        );
      }

      // return res.status(200).json({
      //   success: true,
      //   message: "Gemini AI general response generated successfully.",
      //   response: {
      //     model: GEMINI_CHAT_MODEL,
      //     answer,
      //     context_used: contexts,
      //     metadata: {
      //       totalTokens: totalTokens,
      //       estimatedCost: 0,
      //       sources: searchResult.map((point) => ({
      //         fileName: point.payload?.fileName,
      //         chunkIndex: point.payload?.chunkIndex,
      //         score: point.score,
      //         courseId: point.payload?.courseId,
      //         lessonId: point.payload?.lessonId,
      //         s3Key: point.payload?.s3Key,
      //       })),
      //       hasMSLContext: contexts.length > 0,
      //       contextRelevance:
      //         contexts.length > 0
      //           ? "Used MSL materials"
      //           : "Used general knowledge",
      //       historyCount: historyItems.length,
      //     },
      //     limitInfo: {
      //       dailyUsage: limitCheck.dailyUsage + 1,
      //       dailyLimit: limitCheck.dailyLimit,
      //       monthlyUsage: limitCheck.monthlyUsage + 1,
      //       monthlyLimit: limitCheck.monthlyLimit,
      //       remainingDaily: limitCheck.remainingDaily - 1,
      //       remainingMonthly: limitCheck.remainingMonthly - 1,
      //     },
      //   },
      // });
    } catch (error: any) {
      // console.log(error);
      if (res.headersSent) {
        res.end();
        return;
      }
      return res.status(500).json({
        success: false,
        message: "System error during Gemini AI general query.",
        error: error.message,
      });
    }
  }

  // returns chunks of text and then uses the fulltext to create audio chunks
  static async queryGeneralWithContextAudioStream(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const { question, s3Keys, courseId, lessonId, voiceName } = req.body;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkAiLimits(id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }

      const embeddingVector = await embedText(question);
      const vectorFormat = await resolveVectorFormat();
      const contentFilter = buildContentFilter({
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
      });
      if (contentFilter) await ensurePayloadIndexesForGeminiCollection();
      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: buildSearchVector(embeddingVector, vectorFormat),
        limit: 5,
        ...(contentFilter && { filter: contentFilter as any }),
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");

      const historyFilter: Record<string, any> = {
        student: new mongoose.Types.ObjectId(id),
        $or: [
          { queryType: "chat" },
          { queryType: { $exists: false } },
          { queryType: null },
        ],
      };
      if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
        historyFilter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId && mongoose.Types.ObjectId.isValid(lessonId)) {
        historyFilter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      if (Array.isArray(s3Keys) && s3Keys.length > 0) {
        historyFilter.s3Keys = { $in: s3Keys };
      }
      if (
        !courseId &&
        !lessonId &&
        (!Array.isArray(s3Keys) || s3Keys.length === 0)
      ) {
        historyFilter.$and = [
          { $or: [{ course: { $exists: false } }, { course: null }] },
          { $or: [{ lesson: { $exists: false } }, { lesson: null }] },
          {
            $or: [
              { s3Keys: { $exists: false } },
              { s3Keys: null },
              { s3Keys: { $size: 0 } },
            ],
          },
        ];
      }

      const historyItems = await AiUsage.find(historyFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      const historyText = historyItems
        .reverse()
        .map((item: any) => {
          const q = String(item.question || "").trim();
          const a = String(item.answer || "").trim();
          return `User: ${q}\nAssistant: ${a}`;
        })
        .filter((block) => block.trim().length > 0)
        .join("\n\n");

      const prompt = buildGeneralSpeechPromptWithHistory(
        contextText,
        question,
        historyText || "No prior chat history."
      );

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const streamResult = await geminiChatModel.generateContentStream({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      let fullAnswer = "";
      let pendingText = "";

      try {
        for await (const chunk of streamResult.stream) {
          const content = removeAsterisks(chunk.text());
          if (content) {
            fullAnswer += content;
            pendingText += content;
            const boundaryIndex = findLastBoundaryIndex(pendingText);
            if (boundaryIndex >= 0) {
              const emitText = pendingText.slice(0, boundaryIndex + 1);
              pendingText = pendingText.slice(boundaryIndex + 1);
              res.write(
                `event: text\ndata: ${JSON.stringify({
                  text: emitText,
                  isFinal: false,
                })}\n\n`
              );
            }
          }
        }
      } catch (streamError: any) {
        if (res.headersSent) {
          res.write(
            `event: error\ndata: ${JSON.stringify({
              message: "Stream parse error",
              error: streamError?.message || String(streamError),
            })}\n\n`
          );
          res.write(`event: end\ndata: {}\n\n`);
          res.end();
          return;
        }
        return res.status(500).json({
          success: false,
          message: "Stream parse error",
          error: streamError?.message || String(streamError),
        });
      }

      if (pendingText.trim().length > 0) {
        res.write(
          `event: text\ndata: ${JSON.stringify({
            text: pendingText,
            isFinal: false,
          })}\n\n`
        );
        pendingText = "";
      }

      res.write(
        `event: text\ndata: ${JSON.stringify({
          text: fullAnswer,
          isFinal: true,
        })}\n\n`
      );

      const { dataBase64, mimeType } = await callGeminiTts({
        text: fullAnswer,
        voiceName: voiceName || undefined,
      });

      const wavChunks = toWavChunks(dataBase64, mimeType, 32000);
      for (let i = 0; i < wavChunks.length; i += 1) {
        const chunk = wavChunks[i];
        res.write(
          `event: audio\ndata: ${JSON.stringify({
            audio: chunk,
            mimeType: "audio/wav",
            isFinal: i + 1 >= wavChunks.length,
          })}\n\n`
        );
      }

      res.write(`event: end\ndata: {}\n\n`);
      res.end();

      try {
        const estimatedPromptTokens = estimateTokens(prompt);
        const estimatedCompletionTokens = estimateTokens(fullAnswer);
        const estimatedTotalTokens =
          estimatedPromptTokens + estimatedCompletionTokens;

        const aiUsage = new AiUsage({
          student: id,
          course: courseId || undefined,
          lesson: lessonId || undefined,
          s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
          queryType: "chat",
          question,
          answer: fullAnswer,
          prompt_tokens: estimatedPromptTokens,
          completion_tokens: estimatedCompletionTokens,
          total_tokens: estimatedTotalTokens,
          model: GEMINI_CHAT_MODEL,
          cost_estimate_usd: 0,
        });
        await aiUsage.save();

        recordStudentActivity(id, "ai_query", {
          courseId: courseId || undefined,
          lessonId: lessonId || undefined,
        }).catch(() => {});
      } catch (persistError) {
        console.error(
          "[gemini-ai] failed to persist usage after SSE end",
          persistError
        );
      }
    } catch (error: any) {
      if (res.headersSent) {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            message: "System error during Gemini AI audio query.",
            error: error.message,
          })}\n\n`
        );
        res.write(`event: end\ndata: {}\n\n`);
        res.end();
        return;
      }
      return res.status(500).json({
        success: false,
        message: "System error during Gemini AI audio query.",
        error: error.message,
      });
    }
  }

  static async queryGeneralWithContextAudioBinary(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const { question, s3Keys, courseId, lessonId, voiceName } = req.body;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkAiLimits(id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }

      const embeddingVector = await embedText(question);
      const vectorFormat = await resolveVectorFormat();
      const contentFilter = buildContentFilter({
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
      });
      if (contentFilter) await ensurePayloadIndexesForGeminiCollection();
      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: buildSearchVector(embeddingVector, vectorFormat),
        limit: 5,
        ...(contentFilter && { filter: contentFilter as any }),
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");

      const historyFilter: Record<string, any> = {
        student: new mongoose.Types.ObjectId(id),
        $or: [
          { queryType: "chat" },
          { queryType: { $exists: false } },
          { queryType: null },
        ],
      };
      if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
        historyFilter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId && mongoose.Types.ObjectId.isValid(lessonId)) {
        historyFilter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      if (Array.isArray(s3Keys) && s3Keys.length > 0) {
        historyFilter.s3Keys = { $in: s3Keys };
      }
      if (
        !courseId &&
        !lessonId &&
        (!Array.isArray(s3Keys) || s3Keys.length === 0)
      ) {
        historyFilter.$and = [
          { $or: [{ course: { $exists: false } }, { course: null }] },
          { $or: [{ lesson: { $exists: false } }, { lesson: null }] },
          {
            $or: [
              { s3Keys: { $exists: false } },
              { s3Keys: null },
              { s3Keys: { $size: 0 } },
            ],
          },
        ];
      }

      const historyItems = await AiUsage.find(historyFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      const historyText = historyItems
        .reverse()
        .map((item: any) => {
          const q = String(item.question || "").trim();
          const a = String(item.answer || "").trim();
          return `User: ${q}\nAssistant: ${a}`;
        })
        .filter((block) => block.trim().length > 0)
        .join("\n\n");

      const prompt = buildGeneralSpeechPromptWithHistory(
        contextText,
        question,
        historyText || "No prior chat history."
      );

      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const fullAnswer = removeAsterisks(completion.response.text());
      const { dataBase64, mimeType } = await callGeminiTts({
        text: fullAnswer,
        voiceName: voiceName || undefined,
      });

      const wavChunks = toWavChunks(dataBase64, mimeType, Number.MAX_SAFE_INTEGER);
      const audioBuffer = Buffer.from(wavChunks[0] || "", "base64");
      const boundary = `msl_audio_${Date.now()}`;

      res.setHeader("Content-Type", `multipart/mixed; boundary=${boundary}`);
      res.setHeader("Cache-Control", "no-cache");

      const metadata = {
        text: fullAnswer,
        mimeType: "audio/wav",
      };

      res.write(`--${boundary}\r\n`);
      res.write(`Content-Type: application/json\r\n\r\n`);
      res.write(`${JSON.stringify(metadata)}\r\n`);

      res.write(`--${boundary}\r\n`);
      res.write(`Content-Type: audio/wav\r\n\r\n`);
      res.write(audioBuffer);
      res.write(`\r\n--${boundary}--\r\n`);
      res.end();

      try {
        const estimatedPromptTokens = estimateTokens(prompt);
        const estimatedCompletionTokens = estimateTokens(fullAnswer);
        const estimatedTotalTokens =
          estimatedPromptTokens + estimatedCompletionTokens;

        const aiUsage = new AiUsage({
          student: id,
          course: courseId || undefined,
          lesson: lessonId || undefined,
          s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
          queryType: "chat",
          question,
          answer: fullAnswer,
          prompt_tokens: estimatedPromptTokens,
          completion_tokens: estimatedCompletionTokens,
          total_tokens: estimatedTotalTokens,
          model: GEMINI_CHAT_MODEL,
          cost_estimate_usd: 0,
        });
        await aiUsage.save();

        recordStudentActivity(id, "ai_query", {
          courseId: courseId || undefined,
          lessonId: lessonId || undefined,
        }).catch(() => {});
      } catch (persistError) {
        console.error(
          "[gemini-ai] failed to persist usage after multipart end",
          persistError
        );
      }
    } catch (error: any) {
      if (res.headersSent) {
        res.end();
        return;
      }
      return res.status(500).json({
        success: false,
        message: "System error during Gemini AI audio query.",
        error: error.message,
      });
    }
  }

  static async queryGeneralWithContextAudioDualStream(
    req: Request,
    res: Response
  ) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const { question, s3Keys, courseId, lessonId, voiceName } = req.body;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkAiLimits(id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }

      const embeddingVector = await embedText(question);
      const vectorFormat = await resolveVectorFormat();
      const contentFilter = buildContentFilter({
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
      });
      if (contentFilter) await ensurePayloadIndexesForGeminiCollection();
      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: buildSearchVector(embeddingVector, vectorFormat),
        limit: 5,
        ...(contentFilter && { filter: contentFilter as any }),
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");

      const historyFilter: Record<string, any> = {
        student: new mongoose.Types.ObjectId(id),
        $or: [
          { queryType: "chat" },
          { queryType: { $exists: false } },
          { queryType: null },
        ],
      };
      if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
        historyFilter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId && mongoose.Types.ObjectId.isValid(lessonId)) {
        historyFilter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      if (Array.isArray(s3Keys) && s3Keys.length > 0) {
        historyFilter.s3Keys = { $in: s3Keys };
      }
      if (
        !courseId &&
        !lessonId &&
        (!Array.isArray(s3Keys) || s3Keys.length === 0)
      ) {
        historyFilter.$and = [
          { $or: [{ course: { $exists: false } }, { course: null }] },
          { $or: [{ lesson: { $exists: false } }, { lesson: null }] },
          {
            $or: [
              { s3Keys: { $exists: false } },
              { s3Keys: null },
              { s3Keys: { $size: 0 } },
            ],
          },
        ];
      }

      const historyItems = await AiUsage.find(historyFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      const historyText = historyItems
        .reverse()
        .map((item: any) => {
          const q = String(item.question || "").trim();
          const a = String(item.answer || "").trim();
          return `User: ${q}\nAssistant: ${a}`;
        })
        .filter((block) => block.trim().length > 0)
        .join("\n\n");

      const prompt = buildGeneralSpeechPromptWithHistory(
        contextText,
        question,
        historyText || "No prior chat history."
      );

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          success: false,
          message: "Missing GEMINI_API_KEY",
        });
      }

      /**
       * Live API WebSocket setup:
       * - We send a setup message once (model + audio output format).
       * - Then we send text chunks as they arrive from the chat model.
       * - The Live API streams audio chunks back (base64 PCM).
       * - Audio chunks are saved to disk as a WAV file (header updated on close).
       */
      const liveSocket = new WebSocket(`${LIVE_ENDPOINT}?key=${apiKey}`);
      let liveReady = false;
      let liveClosed = false;
      let fullAnswer = "";
      let pendingText = "";
      const wavMime = GEMINI_LIVE_AUDIO_MIME;
      const wavSampleRate = parseAudioMimeSampleRate(wavMime);

      const waitForLiveReady = new Promise<void>((resolve, reject) => {
        liveSocket.on("open", () => {
          const setupMessage: LiveSetupMessage = {
            setup: {
              model: GEMINI_LIVE_MODEL,
              generationConfig: {
                responseModalities: ["AUDIO"],
              },
              outputAudioFormat: { mimeType: wavMime },
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voiceName || undefined,
                  },
                },
              },
            },
          };
          liveSocket.send(JSON.stringify(setupMessage));
          liveReady = true;
          resolve();
        });
        liveSocket.on("error", (err) => {
          reject(err);
        });
      });

      liveSocket.on("message", (raw) => {
        try {
          const message = JSON.parse(raw.toString()) as LiveServerContentMessage;
          const parts = message?.serverContent?.modelTurn?.parts || [];

          parts.forEach((part) => {
            const textChunk = removeAsterisks(part?.text || "");
          if (textChunk) {
            fullAnswer += textChunk;
            pendingText += textChunk;
            const boundaryIndex = findLastBoundaryIndex(pendingText);
            if (boundaryIndex >= 0) {
              const emitText = pendingText.slice(0, boundaryIndex + 1);
              pendingText = pendingText.slice(boundaryIndex + 1);
              console.log("[audio-dual] text chunk sent");
              res.write(
                `event: text\ndata: ${JSON.stringify({
                  text: emitText,
                  isFinal: false,
                })}\n\n`
              );
            }
          }

            const audioData = part?.inlineData?.data;
            const mimeType = "audio/wav";

            if (audioData) {
              console.log("[audio-dual] audio chunk preparing");
              // 1) send audio chunk to client (non-blocking)
              const pcmBuffer = Buffer.from(audioData, "base64");
              const wavBuffer = Buffer.concat([
                buildWavHeader(pcmBuffer.length, wavSampleRate),
                pcmBuffer,
              ]);
              const wavBase64 = wavBuffer.toString("base64");
              res.write(
                `event: audio\ndata: ${JSON.stringify({
                  audio: wavBase64,
                  mimeType,
                  isFinal: false,
                })}\n\n`
              );
              console.log("[audio-dual] audio chunk sent");

            }
          });

          if (message?.serverContent?.turnComplete) {
            if (pendingText.trim().length > 0) {
              res.write(
                `event: text\ndata: ${JSON.stringify({
                  text: pendingText,
                  isFinal: false,
                })}\n\n`
              );
              pendingText = "";
            }
            res.write(
              `event: text\ndata: ${JSON.stringify({
                text: fullAnswer,
                isFinal: true,
              })}\n\n`
            );
            if (liveSocket.readyState === WebSocket.OPEN) {
              liveSocket.close();
            }
          }
        } catch (error: any) {
          res.write(
            `event: error\ndata: ${JSON.stringify({
              message: "Live API parse error",
              error: error.message,
            })}\n\n`
          );
        }
      });

      liveSocket.on("close", () => {
        liveClosed = true;
      });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      await waitForLiveReady;

      // Send the full prompt to the Live API so it can stream both text and audio.
      const livePrompt: LiveClientContentMessage = {
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          turnComplete: true,
        },
      };
      if (liveReady && liveSocket.readyState === WebSocket.OPEN) {
        liveSocket.send(JSON.stringify(livePrompt));
      }

      // End SSE after socket closes.
      liveSocket.on("close", async () => {
        try {
          if (fullAnswer) {
            const estimatedPromptTokens = estimateTokens(prompt);
            const estimatedCompletionTokens = estimateTokens(fullAnswer);
            const estimatedTotalTokens =
              estimatedPromptTokens + estimatedCompletionTokens;

            const aiUsage = new AiUsage({
              student: id,
              course: courseId || undefined,
              lesson: lessonId || undefined,
              s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
              queryType: "chat",
              question,
              answer: fullAnswer,
              prompt_tokens: estimatedPromptTokens,
              completion_tokens: estimatedCompletionTokens,
              total_tokens: estimatedTotalTokens,
              model: GEMINI_CHAT_MODEL,
              cost_estimate_usd: 0,
            });
            await aiUsage.save();
          }

          recordStudentActivity(id, "ai_query", {
            courseId: courseId || undefined,
            lessonId: lessonId || undefined,
          }).catch(() => {});
        } catch (persistError) {
          console.error(
            "[gemini-ai] failed to persist usage after live stream",
            persistError
          );
        }

        if (!res.writableEnded) {
          res.write(`event: end\ndata: {}\n\n`);
          res.end();
        }
      });

    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "System error during Gemini AI audio query.",
        error: error.message,
      });
    }
  }

  // returns chunks of text and asynchronously uses it to create audio chunks
  static async queryGeneralWithContextAudioTextStream(
    req: Request,
    res: Response
  ) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const { question, s3Keys, courseId, lessonId, voiceName } = req.body;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkAiLimits(id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }

      const embeddingVector = await embedText(question);
      const vectorFormat = await resolveVectorFormat();
      const contentFilter = buildContentFilter({
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
      });
      if (contentFilter) await ensurePayloadIndexesForGeminiCollection();
      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: buildSearchVector(embeddingVector, vectorFormat),
        limit: 5,
        ...(contentFilter && { filter: contentFilter as any }),
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");

      const historyFilter: Record<string, any> = {
        student: new mongoose.Types.ObjectId(id),
        $or: [
          { queryType: "chat" },
          { queryType: { $exists: false } },
          { queryType: null },
        ],
      };
      if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
        historyFilter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId && mongoose.Types.ObjectId.isValid(lessonId)) {
        historyFilter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      if (Array.isArray(s3Keys) && s3Keys.length > 0) {
        historyFilter.s3Keys = { $in: s3Keys };
      }
      if (
        !courseId &&
        !lessonId &&
        (!Array.isArray(s3Keys) || s3Keys.length === 0)
      ) {
        historyFilter.$and = [
          { $or: [{ course: { $exists: false } }, { course: null }] },
          { $or: [{ lesson: { $exists: false } }, { lesson: null }] },
          {
            $or: [
              { s3Keys: { $exists: false } },
              { s3Keys: null },
              { s3Keys: { $size: 0 } },
            ],
          },
        ];
      }

      const historyItems = await AiUsage.find(historyFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      const historyText = historyItems
        .reverse()
        .map((item: any) => {
          const q = String(item.question || "").trim();
          const a = String(item.answer || "").trim();
          return `User: ${q}\nAssistant: ${a}`;
        })
        .filter((block) => block.trim().length > 0)
        .join("\n\n");

      const prompt = buildGeneralSpeechPromptWithHistory(
        contextText,
        question,
        historyText || "No prior chat history."
      );

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const streamResult = await geminiChatModel.generateContentStream({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      let fullAnswer = "";
      let chunkIndex = 0;
      let pendingAudio = 0;
      let textComplete = false;
      let pendingText = "";

      const maybeEnd = async () => {
        if (!textComplete || pendingAudio !== 0) {
          return;
        }
        try {
          const estimatedPromptTokens = estimateTokens(prompt);
          const estimatedCompletionTokens = estimateTokens(fullAnswer);
          const estimatedTotalTokens =
            estimatedPromptTokens + estimatedCompletionTokens;

          const aiUsage = new AiUsage({
            student: id,
            course: courseId || undefined,
            lesson: lessonId || undefined,
            s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
            queryType: "chat",
            question,
            answer: fullAnswer,
            prompt_tokens: estimatedPromptTokens,
            completion_tokens: estimatedCompletionTokens,
            total_tokens: estimatedTotalTokens,
            model: GEMINI_CHAT_MODEL,
            cost_estimate_usd: 0,
          });
          await aiUsage.save();

          recordStudentActivity(id, "ai_query", {
            courseId: courseId || undefined,
            lessonId: lessonId || undefined,
          }).catch(() => {});
        } catch (persistError) {
          console.error(
            "[gemini-ai] failed to persist usage after audio text stream",
            persistError
          );
        }

        if (!res.writableEnded) {
          res.write(`event: end\ndata: {}\n\n`);
          res.end();
        }
      };

      try {
        for await (const chunk of streamResult.stream) {
          const content = removeAsterisks(chunk.text());
          if (!content) continue;

          fullAnswer += content;
          pendingText += content;
          const boundaryIndex = findLastBoundaryIndex(pendingText);
          if (boundaryIndex < 0) {
            continue;
          }

          const emitText = pendingText.slice(0, boundaryIndex + 1);
          pendingText = pendingText.slice(boundaryIndex + 1);
          const currentIndex = chunkIndex++;

          res.write(
            `event: text\ndata: ${JSON.stringify({
              text: emitText,
              isFinal: false,
              chunkIndex: currentIndex,
            })}\n\n`
          );

          pendingAudio += 1;
          callGeminiTts({
            text: emitText,
            voiceName: voiceName || undefined,
          })
            .then(({ dataBase64, mimeType }) => {
              const wavChunks = toWavChunks(dataBase64, mimeType, 32000);
              for (let i = 0; i < wavChunks.length; i += 1) {
                res.write(
                  `event: audio\ndata: ${JSON.stringify({
                    chunkIndex: currentIndex,
                    audio: wavChunks[i],
                    mimeType: "audio/wav",
                    isFinal: i + 1 >= wavChunks.length,
                  })}\n\n`
                );
              }
            })
            .catch((error: any) => {
              console.log('error', error)
              res.write(
                `event: error\ndata: ${JSON.stringify({
                  message: "TTS failed",
                  error: error.message,
                  chunkIndex: currentIndex,
                })}\n\n`
              );
            })
            .finally(() => {
              pendingAudio -= 1;
              void maybeEnd();
            });
        }
      } catch (streamError: any) {
        if (res.headersSent) {
          res.write(
            `event: error\ndata: ${JSON.stringify({
              message: "Stream parse error",
              error: streamError?.message || String(streamError),
            })}\n\n`
          );
          res.write(`event: end\ndata: {}\n\n`);
          res.end();
          return;
        }
        return res.status(500).json({
          success: false,
          message: "Stream parse error",
          error: streamError?.message || String(streamError),
        });
      }

      if (pendingText.trim().length > 0) {
        const currentIndex = chunkIndex++;
        res.write(
          `event: text\ndata: ${JSON.stringify({
            text: pendingText,
            isFinal: false,
            chunkIndex: currentIndex,
          })}\n\n`
        );
        pendingAudio += 1;
        callGeminiTts({
          text: pendingText,
          voiceName: voiceName || undefined,
        })
          .then(({ dataBase64, mimeType }) => {
            const wavChunks = toWavChunks(dataBase64, mimeType, 32000);
            for (let i = 0; i < wavChunks.length; i += 1) {
              res.write(
                `event: audio\ndata: ${JSON.stringify({
                  audio: wavChunks[i],
                  mimeType: "audio/wav",
                  chunkIndex: currentIndex,
                  isFinal: i + 1 >= wavChunks.length,
                })}\n\n`
              );
            }
          })
          .catch((error: any) => {
            res.write(
              `event: error\ndata: ${JSON.stringify({
                message: "TTS failed",
                error: error.message,
                chunkIndex: currentIndex,
              })}\n\n`
            );
          })
          .finally(() => {
            pendingAudio -= 1;
            void maybeEnd();
          });
      }

      res.write(
        `event: text\ndata: ${JSON.stringify({
          finished: true,
          text: fullAnswer,
          isFinal: true,
          chunkIndex: chunkIndex,
        })}\n\n`
      );

      textComplete = true;
      void maybeEnd();
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "System error during Gemini AI audio query.",
        error: error.message,
      });
    }
  }

  static async queryGeneralWithContextTextStreamFinalAudio(
    req: Request,
    res: Response
  ) {
    try {
      const requestStartedAt = Date.now();
      const requestId =
        (req.headers["x-request-id"] as string | undefined) ||
        `${requestStartedAt}-${Math.random().toString(36).slice(2, 8)}`;
      const timerStarts = new Map<string, number>();

      const logTiming = (
        step: string,
        type: "start" | "end" | "info",
        details?: Record<string, unknown>
      ) => {
        const elapsedMs = Date.now() - requestStartedAt;
        const payload: Record<string, unknown> = {
          requestId,
          step,
          type,
          elapsedMs,
          ...(details || {}),
        };
        // console.log(
        //   `[gemini-ai-timing][query-general-context-text-stream-final-audio]`,
        //   payload
        // );
      };

      const startStep = (step: string, details?: Record<string, unknown>) => {
        timerStarts.set(step, Date.now());
        logTiming(step, "start", details);
      };

      const endStep = (step: string, details?: Record<string, unknown>) => {
        const started = timerStarts.get(step);
        const durationMs = typeof started === "number" ? Date.now() - started : null;
        logTiming(step, "end", { durationMs, ...(details || {}) });
      };

      const { id } = req["currentUser"] as { id?: string };
      const { question, s3Keys, courseId, lessonId, voiceName } = req.body;

      logTiming("request_received", "info", {
        hasQuestion: Boolean(question),
        hasCourseId: Boolean(courseId),
        hasLessonId: Boolean(lessonId),
        s3KeysCount: Array.isArray(s3Keys) ? s3Keys.length : 0,
        hasVoiceName: Boolean(voiceName),
      });

      if (!question) {
        logTiming("validation_failed", "info", {
          reason: "Missing required field: question",
        });
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        logTiming("validation_failed", "info", {
          reason: "Missing required field: studentId",
        });
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      startStep("limit_check_db");
      const limitCheck = await checkAiLimits(id);
      endStep("limit_check_db", {
        allowed: limitCheck.allowed,
        dailyUsage: limitCheck.dailyUsage,
        dailyLimit: limitCheck.dailyLimit,
        monthlyUsage: limitCheck.monthlyUsage,
        monthlyLimit: limitCheck.monthlyLimit,
      });

      if (!limitCheck.allowed) {
        logTiming("request_blocked_by_limits", "info", {
          reason: limitCheck.reason,
        });
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }

      startStep("embedding_generation");
      const embeddingVector = await embedText(question);
      endStep("embedding_generation", {
        embeddingLength: Array.isArray(embeddingVector) ? embeddingVector.length : 0,
      });

      startStep("vector_format_resolution");
      const vectorFormat = await resolveVectorFormat();
      endStep("vector_format_resolution", { vectorFormat });

      startStep("content_filter_build");
      const contentFilter = buildContentFilter({
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
      });
      endStep("content_filter_build", {
        hasContentFilter: Boolean(contentFilter),
      });

      if (contentFilter) {
        startStep("qdrant_indexes_ensure");
        await ensurePayloadIndexesForGeminiCollection();
        endStep("qdrant_indexes_ensure");
      }

      startStep("qdrant_search");
      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: buildSearchVector(embeddingVector, vectorFormat),
        limit: 5,
        ...(contentFilter && { filter: contentFilter as any }),
      });
      endStep("qdrant_search", {
        resultCount: Array.isArray(searchResult) ? searchResult.length : 0,
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");

      const historyFilter: Record<string, any> = {
        student: new mongoose.Types.ObjectId(id),
        $or: [
          { queryType: "chat" },
          { queryType: { $exists: false } },
          { queryType: null },
        ],
      };
      if (courseId && mongoose.Types.ObjectId.isValid(courseId)) {
        historyFilter.course = new mongoose.Types.ObjectId(courseId);
      }
      if (lessonId && mongoose.Types.ObjectId.isValid(lessonId)) {
        historyFilter.lesson = new mongoose.Types.ObjectId(lessonId);
      }
      if (Array.isArray(s3Keys) && s3Keys.length > 0) {
        historyFilter.s3Keys = { $in: s3Keys };
      }
      if (
        !courseId &&
        !lessonId &&
        (!Array.isArray(s3Keys) || s3Keys.length === 0)
      ) {
        historyFilter.$and = [
          { $or: [{ course: { $exists: false } }, { course: null }] },
          { $or: [{ lesson: { $exists: false } }, { lesson: null }] },
          {
            $or: [
              { s3Keys: { $exists: false } },
              { s3Keys: null },
              { s3Keys: { $size: 0 } },
            ],
          },
        ];
      }

      startStep("history_fetch_db");
      const historyItems = await AiUsage.find(historyFilter)
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
      endStep("history_fetch_db", {
        historyItemsCount: Array.isArray(historyItems) ? historyItems.length : 0,
      });

      const historyText = historyItems
        .reverse()
        .map((item: any) => {
          const q = String(item.question || "").trim();
          const a = String(item.answer || "").trim();
          return `User: ${q}\nAssistant: ${a}`;
        })
        .filter((block) => block.trim().length > 0)
        .join("\n\n");

      const prompt = buildGeneralSpeechPromptWithHistory(
        contextText,
        question,
        historyText || "No prior chat history."
      );

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      logTiming("sse_headers_set", "info");

      startStep("gemini_stream_generation");
      const streamResult = await geminiChatModel.generateContentStream({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      endStep("gemini_stream_generation");

      let fullAnswer = "";
      let pendingText = "";
      let streamChunkCount = 0;

      try {
        startStep("gemini_stream_consumption");
        for await (const chunk of streamResult.stream) {
          const content = removeAsterisks(chunk.text());
          if (content) {
            streamChunkCount += 1;
            fullAnswer += content;
            pendingText += content;
            const boundaryIndex = findLastBoundaryIndex(pendingText);
            if (boundaryIndex >= 0) {
              const emitText = pendingText.slice(0, boundaryIndex + 1);
              pendingText = pendingText.slice(boundaryIndex + 1);
              res.write(
                `event: text\ndata: ${JSON.stringify({
                  text: emitText,
                  isFinal: false,
                })}\n\n`
              );
            }
          }
        }
        endStep("gemini_stream_consumption", {
          streamChunkCount,
          streamedTextLength: fullAnswer.length,
        });
      } catch (streamError: any) {
        endStep("gemini_stream_consumption", {
          streamChunkCount,
          error: streamError?.message || String(streamError),
        });
        if (res.headersSent) {
          res.write(
            `event: error\ndata: ${JSON.stringify({
              message: "Stream parse error",
              error: streamError?.message || String(streamError),
            })}\n\n`
          );
          res.write(`event: end\ndata: {}\n\n`);
          res.end();
          return;
        }
        return res.status(500).json({
          success: false,
          message: "Stream parse error",
          error: streamError?.message || String(streamError),
        });
      }

      if (pendingText.trim().length > 0) {
        res.write(
          `event: text\ndata: ${JSON.stringify({
            text: pendingText,
            isFinal: false,
          })}\n\n`
        );
      }

      res.write(
        `event: text\ndata: ${JSON.stringify({
          text: fullAnswer,
          isFinal: true,
        })}\n\n`
      );

      startStep("tts_audio_generation");
      const { dataBase64, mimeType } = await callGeminiTts({
        text: fullAnswer,
        voiceName: voiceName || undefined,
      });
      endStep("tts_audio_generation", {
        mimeType,
        audioBase64Length: dataBase64?.length || 0,
      });

      startStep("wav_conversion");
      const wavChunks = toWavChunks(
        dataBase64,
        mimeType,
        Number.MAX_SAFE_INTEGER
      );
      endStep("wav_conversion", {
        wavChunksCount: wavChunks.length,
      });

      const wavAudio = wavChunks[0] || "";
      res.write(
        `event: audio\ndata: ${JSON.stringify({
          audio: wavAudio,
          mimeType: "audio/wav",
          isFinal: true,
        })}\n\n`
      );

      res.write(`event: end\ndata: {}\n\n`);
      res.end();
      logTiming("sse_response_closed", "info", {
        fullAnswerLength: fullAnswer.length,
        finalAudioLength: wavAudio.length,
      });

      try {
        startStep("usage_persist_db");
        const estimatedPromptTokens = estimateTokens(prompt);
        const estimatedCompletionTokens = estimateTokens(fullAnswer);
        const estimatedTotalTokens =
          estimatedPromptTokens + estimatedCompletionTokens;

        const aiUsage = new AiUsage({
          student: id,
          course: courseId || undefined,
          lesson: lessonId || undefined,
          s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
          queryType: "chat",
          question,
          answer: fullAnswer,
          prompt_tokens: estimatedPromptTokens,
          completion_tokens: estimatedCompletionTokens,
          total_tokens: estimatedTotalTokens,
          model: GEMINI_CHAT_MODEL,
          cost_estimate_usd: 0,
        });
        await aiUsage.save();
        endStep("usage_persist_db", {
          estimatedPromptTokens,
          estimatedCompletionTokens,
          estimatedTotalTokens,
        });

        startStep("student_activity_record");
        recordStudentActivity(id, "ai_query", {
          courseId: courseId || undefined,
          lessonId: lessonId || undefined,
        }).catch(() => {});
        endStep("student_activity_record");
      } catch (persistError) {
        console.error(
          "[gemini-ai] failed to persist usage after SSE end",
          persistError
        );
        logTiming("post_response_persist_error", "info", {
          error:
            persistError instanceof Error
              ? persistError.message
              : String(persistError),
        });
      }

      logTiming("request_completed", "info", {
        totalDurationMs: Date.now() - requestStartedAt,
      });
    } catch (error: any) {
      // console.log(
      //   `[gemini-ai-timing][query-general-context-text-stream-final-audio]`,
      //   {
      //     type: "error",
      //     step: "request_failed",
      //     message: error?.message || String(error),
      //   }
      // );
      if (res.headersSent) {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            message: "System error during Gemini AI audio query.",
            error: error.message,
          })}\n\n`
        );
        res.write(`event: end\ndata: {}\n\n`);
        res.end();
        return;
      }
      return res.status(500).json({
        success: false,
        message: "System error during Gemini AI audio query.",
        error: error.message,
      });
    }
  }

  static async voiceToTextStream(req: MulterRequest, res: Response) {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          message: "Missing required file: audio",
        });
      }

      const languageCode = (req.body?.languageCode as string) || "en-US";
      const mimeType = detectAudioMimeType(file.mimetype, "audio/webm");
      const prompt = `Transcribe the following audio. Language: ${languageCode}.`;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const { text: fullTranscript } = await callGeminiAudioTranscription({
        prompt,
        mimeType,
        dataBase64: file.buffer.toString("base64"),
      });

      res.write(
        `data: ${JSON.stringify({
          transcript: fullTranscript,
          isFinal: true,
        })}\n\n`
      );
      res.write(`event: end\ndata: {}\n\n`);
      res.end();
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "System error during voice transcription.",
        error: error.message,
      });
    }
  }

  static async queryImage(req: MulterRequest, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      const { question, courseId, lessonId, s3Keys } = req.body;
      const normalizedS3Keys = normalizeS3Keys(s3Keys);
      const file = req.file;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!file) {
        return res.status(400).json({
          success: false,
          message: "Missing required file: image",
        });
      }

      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkAiLimits(id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          success: false,
          message: limitCheck.reason,
          limitInfo: {
            dailyUsage: limitCheck.dailyUsage,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: limitCheck.monthlyUsage,
            monthlyLimit: limitCheck.monthlyLimit,
          },
        });
      }

      const embeddingVector = await embedText(question);
      const vectorFormat = await resolveVectorFormat();
      const contentFilter = buildContentFilter({
        courseId: courseId || undefined,
        lessonId: lessonId || undefined,
        s3Keys: normalizedS3Keys,
      });
      if (contentFilter) await ensurePayloadIndexesForGeminiCollection();
      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: buildSearchVector(embeddingVector, vectorFormat),
        limit: 5,
        ...(contentFilter && { filter: contentFilter as any }),
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");
      const prompt = `${IMAGE_QUERY_PROMPT}\n\nMSL Learning Context:\n${contextText}\n\nQuestion:\n${question}`;
      const completion = await geminiChatModel.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: file.mimetype,
                  data: file.buffer.toString("base64"),
                },
              },
            ],
          },
        ],
      });

      const response = completion.response;
      const answer = removeAsterisks(response.text());

      const usage = response.usageMetadata;
      const promptTokens = usage?.promptTokenCount ?? estimateTokens(prompt);
      const completionTokens =
        usage?.candidatesTokenCount ?? estimateTokens(answer);
      const totalTokens =
        usage?.totalTokenCount ?? promptTokens + completionTokens;

      const aiUsage = new AiUsage({
        student: id,
        course: courseId || undefined,
        lesson: lessonId || undefined,
        s3Keys: normalizedS3Keys,
        question,
        answer,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
        queryType: "chat",
        metadata: {
          imageMimeType: file.mimetype,
          imageBase64: file.buffer.toString("base64"),
          type: "image",
        },
      });
      await aiUsage.save();

      return res.status(200).json({
        success: true,
        message: "Image question answered successfully.",
        response: {
          answer,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "System error during image query.",
        error: error.message,
      });
    }
  }

  static async voiceToTextRawStream(req: Request, res: Response) {
    try {
      const audioBuffer = req.body as Buffer;
      if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || !audioBuffer.length) {
        return res.status(400).json({
          success: false,
          message: "Missing required audio bytes in request body",
        });
      }

      const languageCode = (req.headers["x-language-code"] as string) || "en-US";
      const contentType = req.headers["content-type"] as string | undefined;
      const mimeType = detectAudioMimeType(contentType, "audio/webm");
      const prompt = `Transcribe the following audio. Language: ${languageCode}.`;

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const { text: fullTranscript } = await callGeminiAudioTranscription({
        prompt,
        mimeType,
        dataBase64: audioBuffer.toString("base64"),
      });

      res.write(
        `data: ${JSON.stringify({
          transcript: fullTranscript,
          isFinal: true,
        })}\n\n`
      );
      res.write(`event: end\ndata: {}\n\n`);
      res.end();
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "System error during voice transcription.",
        error: error.message,
      });
    }
  }

  static async voiceToText(req: MulterRequest, res: Response) {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          message: "Missing required file: audio",
        });
      }

      const languageCode = (req.body?.languageCode as string) || "en-US";
      const mimeType = detectAudioMimeType(file.mimetype, "audio/webm");
      const prompt = `Transcribe the following audio. Language: ${languageCode}.`;

      const { text: transcript } = await callGeminiAudioTranscription({
        prompt,
        mimeType,
        dataBase64: file.buffer.toString("base64"),
      });

      return res.status(200).json({
        success: true,
        transcript,
        results: [],
      });
    } catch (error: any) {
      console.log(error);
      return res.status(500).json({
        success: false,
        message: "System error during voice transcription.",
        error: error.message,
      });
    }
  }

  static async voiceToTextRaw(req: Request, res: Response) {
    try {
      const audioBuffer = req.body as Buffer;
      if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || !audioBuffer.length) {
        return res.status(400).json({
          success: false,
          message: "Missing required audio bytes in request body",
        });
      }

      const languageCode = (req.headers["x-language-code"] as string) || "en-US";
      const contentType = req.headers["content-type"] as string | undefined;
      const mimeType = detectAudioMimeType(contentType, "audio/webm");
      const prompt = `Transcribe the following audio. Language: ${languageCode}.`;

      const { text: transcript } = await callGeminiAudioTranscription({
        prompt,
        mimeType,
        dataBase64: audioBuffer.toString("base64"),
      });

      return res.status(200).json({
        success: true,
        transcript,
        results: [],
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "System error during voice transcription.",
        error: error.message,
      });
    }
  }
}
