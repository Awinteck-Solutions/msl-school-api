import { Request, Response } from "express";
import mongoose from "mongoose";
import {
  GEMINI_CHAT_MODEL,
  callGeminiTts,
  estimateTokens,
  geminiChatModel,
  geminiTtsToWavBase64,
  resolveCachedTtsVoice,
} from "../../geminiAi/controllers/geminiAi.shared";
import AiUsage from "../../mslAi/schema/aiUsage.schema";
import GlobalAiLimit from "../../mslAi/schema/globalAiLimit.schema";
import User from "../../user/schema/user.schema";
import { Roles } from "../../../enums/roles.enum";
import { loginAccessSnapshot } from "../../subscription/controllers/subscription.service";
import { recordStudentActivity } from "../../gamification/service/gamification.service";
import {
  PastQuestionChatScope,
  PastQuestionInsightScope,
  PastQuestionProcessStatus,
  PastQuestionStatus,
} from "../enums/pastQuestion.enum";
import PastQuestionInsight from "../schema/pastQuestionInsight.schema";
import PastQuestionItem from "../schema/pastQuestionItem.schema";
import PastQuestionPaper from "../schema/pastQuestionPaper.schema";
import {
  buildBrowseTree,
  buildPastQuestionAnalytics,
  buildCourseTopicFrequency,
  courseKey,
  findCoursePapers,
  getPastQuestionContext,
  normalizeInsightDocument,
  serializePaper,
} from "./pastQuestion.service";

const CHAT_SYSTEM_PROMPT = `
You are a helpful AI assistant for ICAG and MSL past exam questions. Use the provided past-question text and MSL learning context when relevant. You may also use general subject knowledge so the answer is complete and exam-useful.

Use the conversation history to stay consistent with earlier turns. Do not repeat prior answers unless asked. Never mention sources, context, or training data. Never use asterisk (*).
Return the final answer ONLY as HTML wrapped in a single <article> element.
`;

const CHAT_SPEECH_PROMPT = `
You are a helpful AI tutor for ICAG and MSL past exam questions. Speak clearly and conversationally.
Use the provided past-question text and MSL learning context when relevant. You may also use general subject knowledge.
Use the conversation history to stay consistent. Do not repeat prior answers unless asked.
Never mention sources, context, or training data. Never use asterisk (*).
Do not use HTML, CSS, or markdown. Keep the response under 350 words. Write in short spoken sentences.
`;

const STAFF_ROLES = new Set<string>([
  Roles.ADMIN,
  Roles.AUDITOR,
  Roles.STAFF_JUNIOR,
  Roles.STAFF_SENIOR,
]);

const DEFAULT_PAST_QUESTION_AI_LIMIT = 10;

export const pastQuestionAiLifetimeLimit = async () => {
  const limits = await GlobalAiLimit.findOneAndUpdate(
    {},
    {
      $setOnInsert: {
        dailyLimit: 10,
        monthlyLimit: 100,
        pastQuestionLifetimeLimit: DEFAULT_PAST_QUESTION_AI_LIMIT,
        description: "Default global AI limits",
      },
    },
    { upsert: true, new: true }
  );
  const value = Number(limits?.pastQuestionLifetimeLimit);
  if (Number.isFinite(value) && value >= 1) return value;
  limits.pastQuestionLifetimeLimit = DEFAULT_PAST_QUESTION_AI_LIMIT;
  await limits.save();
  return DEFAULT_PAST_QUESTION_AI_LIMIT;
};

export const checkPastQuestionAiLifetime = async (
  studentId: string,
  role?: string,
  email?: string
) => {
  const limit = await pastQuestionAiLifetimeLimit();
  const unlimited = {
    allowed: true,
    unlimited: true as boolean | undefined,
    used: 0,
    limit,
    remaining: limit,
    reason: undefined as string | undefined,
  };
  if (role && STAFF_ROLES.has(role)) return unlimited;
  const access = await loginAccessSnapshot(studentId, email);
  if (access.activeSubscription || access.enrolledStatus) return unlimited;
  const user = await User.findById(studentId).select("ai_limit").lean();
  if ((user as any)?.ai_limit?.isActive === false) {
    return {
      allowed: false,
      unlimited: false,
      reason: "AI access is disabled for this user",
      used: 0,
      limit,
      remaining: 0,
    };
  }
  const used = await AiUsage.countDocuments({
    student: studentId,
    source: "past-question",
  });
  if (used >= limit) {
    return {
      allowed: false,
      unlimited: false,
      reason: `Past question AI limit of ${limit} lifetime queries reached`,
      used,
      limit,
      remaining: 0,
    };
  }
  return {
    allowed: true,
    unlimited: false,
    used,
    limit,
    remaining: limit - used,
    reason: undefined,
  };
};

const removeAsterisks = (text: string) => String(text || "").replace(/\*/g, "");

const stripHtml = (value: unknown) =>
  String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeChatHistory = (history: unknown, limit = 12) => {
  if (!Array.isArray(history)) return [] as Array<{ role: "user" | "model"; text: string }>;
  return history
    .map((row: any) => {
      const roleRaw = String(row?.role || "").toLowerCase();
      const role: "user" | "model" =
        roleRaw === "assistant" || roleRaw === "model" || roleRaw === "ai" ? "model" : "user";
      const text = stripHtml(row?.text || row?.content || row?.question || row?.answer || "");
      if (!text) return null;
      return { role, text: text.slice(0, 4000) };
    })
    .filter(Boolean)
    .slice(-limit) as Array<{ role: "user" | "model"; text: string }>;
};

export class PastQuestionV2Controller {
  static async history(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as { id?: string } | undefined;
      if (!currentUser?.id || !mongoose.Types.ObjectId.isValid(currentUser.id)) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }
      const paperId = String(req.query.paperId || "").trim();
      const filter: Record<string, unknown> = {
        student: new mongoose.Types.ObjectId(currentUser.id),
        source: "past-question",
        queryType: "chat",
      };
      if (paperId) filter["metadata.paperId"] = paperId;
      const rows = await AiUsage.find(filter)
        .sort({ createdAt: 1 })
        .limit(40)
        .select("question answer createdAt metadata")
        .lean();
      return res.status(200).json({
        status: true,
        message: "Past question chat history",
        response: rows.map((row: any) => ({
          _id: row._id,
          question: row.question || "",
          answer: row.answer || "",
          createdAt: row.createdAt,
          paperId: row.metadata?.paperId || null,
          scope: row.metadata?.scope || null,
        })),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch past question chat history",
        error: error?.message || error,
      });
    }
  }

  static async aiQuota(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as
        | { id?: string; role?: string; email?: string }
        | undefined;
      if (!currentUser?.id) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }
      const quota = await checkPastQuestionAiLifetime(
        currentUser.id,
        currentUser.role,
        currentUser.email
      );
      return res.status(200).json({
        status: true,
        message: "Past question AI quota",
        response: quota,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch past question AI quota",
        error: error?.message || error,
      });
    }
  }

  static async tree(req: Request, res: Response) {
    try {
      const { categoryId, year, level } = req.query as Record<string, string>;
      const filter: Record<string, unknown> = {
        status: PastQuestionStatus.ACTIVE,
        processStatus: PastQuestionProcessStatus.SUCCESS,
      };
      if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
        filter.categoryId = new mongoose.Types.ObjectId(categoryId);
      }
      if (year) filter.year = Number(year);
      if (level) filter.level = level;
      const papers = await PastQuestionPaper.find(filter)
        .populate({ path: "categoryId", select: "name status" })
        .sort({ year: -1, sitting: 1, level: 1, title: 1 })
        .select("-extractedText")
        .lean();
      return res.status(200).json({
        status: true,
        message: "Past questions fetched",
        response: buildBrowseTree(papers),
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch past questions",
        error: error?.message || error,
      });
    }
  }

  static async getPaper(req: Request, res: Response) {
    try {
      const id = String(req.params.id || "");
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid id" });
      }
      const paper = await PastQuestionPaper.findOne({
        _id: id,
        status: PastQuestionStatus.ACTIVE,
      })
        .populate({ path: "categoryId", select: "name status" })
        .select("-extractedText")
        .lean();
      if (!paper) {
        return res.status(404).json({ status: false, message: "Paper not found" });
      }
      const questions = await PastQuestionItem.find({ paper: paper._id })
        .sort({ order: 1 })
        .lean();
      return res.status(200).json({
        status: true,
        message: "Past question paper fetched",
        response: { ...serializePaper(paper), questions },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch paper",
        error: error?.message || error,
      });
    }
  }

  static async paperInsights(req: Request, res: Response) {
    try {
      const id = String(req.params.id || "");
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ status: false, message: "Invalid id" });
      }
      const paper = await PastQuestionPaper.findById(id).lean();
      if (!paper) {
        return res.status(404).json({ status: false, message: "Paper not found" });
      }
      const [paperInsight, courseInsight] = await Promise.all([
        PastQuestionInsight.findOne({
          scope: PastQuestionInsightScope.PAPER,
          paper: paper._id,
        }).lean(),
        PastQuestionInsight.findOne({
          scope: PastQuestionInsightScope.COURSE,
          ...courseKey(paper),
        }).lean(),
      ]);
      const coursePapers = await findCoursePapers({
        categoryId: String(paper.categoryId?._id || paper.categoryId),
        level: paper.level,
        paperCode: paper.paperCode || "",
        title: paper.title || "",
      });
      const topicFrequency = await buildCourseTopicFrequency(coursePapers);
      return res.status(200).json({
        status: true,
        message: "Past question insights fetched",
        response: {
          paper: normalizeInsightDocument(paperInsight, paper),
          course: normalizeInsightDocument(courseInsight, paper),
          topicFrequency,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch insights",
        error: error?.message || error,
      });
    }
  }

  static async insightAnalytics(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as { id?: string };
      const { categoryId } = req.query as Record<string, string>;
      const response = await buildPastQuestionAnalytics({
        admin: false,
        studentId: currentUser?.id,
        categoryId,
      });
      return res.status(200).json({
        status: true,
        message: "Past question insight analytics",
        response,
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to build insight analytics",
        error: error?.message || error,
      });
    }
  }

  static async courseInsights(req: Request, res: Response) {
    try {
      const { categoryId, level, paperCode, title } = req.query as Record<
        string,
        string
      >;
      if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId) || !level) {
        return res.status(400).json({
          status: false,
          message: "categoryId and level are required",
        });
      }
      const papers = await findCoursePapers({
        categoryId,
        level,
        paperCode,
        title,
      });
      const sample = papers[0];
      if (!sample) {
        return res.status(404).json({
          status: false,
          message: "No past questions found for this course paper",
        });
      }
      const insight = await PastQuestionInsight.findOne({
        scope: PastQuestionInsightScope.COURSE,
        ...courseKey(sample),
      }).lean();
      const topicFrequency = await buildCourseTopicFrequency(papers);
      return res.status(200).json({
        status: true,
        message: "Course past-question insights fetched",
        response: {
          insight: normalizeInsightDocument(insight, sample),
          papers: papers.map((paper: any) => serializePaper(paper)),
          topicFrequency,
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to fetch course insights",
        error: error?.message || error,
      });
    }
  }

  static async chat(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as {
        id?: string;
        email?: string;
        role?: string;
      };
      if (!currentUser?.id) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }

      const result = await runPastQuestionChat(currentUser, req.body || {});
      return res.status(200).json({
        status: true,
        success: true,
        message: "Past question chat response",
        response: {
          model: GEMINI_CHAT_MODEL,
          answer: result.answer,
          scope: result.chatScope,
          paperId: result.paper._id,
          questionId: result.item?._id,
          limitInfo: result.limitInfo,
        },
      });
    } catch (error: any) {
      const status = Number(error?.status) || 500;
      return res.status(status).json({
        status: false,
        message: error?.message || "Failed to chat on past question",
        error: error?.message || error,
        ...(error?.limitInfo ? { limitInfo: error.limitInfo } : {}),
      });
    }
  }

  /**
   * Streams spoken past-question answers: text arrives sentence-by-sentence while
   * Gemini TTS runs in parallel so audio can start before the full reply is done.
   */
  static async chatAudioStream(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as {
        id?: string;
        email?: string;
        role?: string;
      };
      if (!currentUser?.id) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }

      const body = (req.body || {}) as PastQuestionChatBody & {
        voiceId?: string;
        voiceName?: string;
      };

      const prepared = await preparePastQuestionChat(currentUser, body, {
        speech: true,
      });
      const resolvedVoice = await resolveCachedTtsVoice(
        body.voiceId || undefined,
        body.voiceName || undefined
      );

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const streamResult = await geminiChatModel.generateContentStream({
        contents: [{ role: "user", parts: [{ text: prepared.prompt }] }],
      });

      let fullAnswer = "";
      let pendingText = "";
      let chunkIndex = 0;
      let pendingAudio = 0;
      let textComplete = false;

      const maybeEnd = async () => {
        if (!textComplete || pendingAudio !== 0 || res.writableEnded) return;
        const answerHtml = plainSpeechToHtml(fullAnswer);
        try {
          await new AiUsage({
            student: currentUser.id,
            queryType: "chat",
            source: "past-question",
            question: prepared.question,
            answer: answerHtml,
            prompt_tokens: estimateTokens(prepared.prompt),
            completion_tokens: estimateTokens(fullAnswer),
            total_tokens:
              estimateTokens(prepared.prompt) + estimateTokens(fullAnswer),
            model: GEMINI_CHAT_MODEL,
            cost_estimate_usd: 0,
            metadata: {
              scope: prepared.chatScope,
              paperId: String(prepared.paper._id),
              questionId: prepared.item ? String(prepared.item._id) : undefined,
              historyTurns: prepared.prior.length,
              audio: true,
            },
          }).save();
          recordStudentActivity(currentUser.id as string, "ai_query", {}).catch(
            () => {}
          );
        } catch (persistError) {
          console.error(
            "[past-question] failed to persist audio chat usage",
            persistError
          );
        }

        res.write(
          `event: text\ndata: ${JSON.stringify({
            text: answerHtml,
            isFinal: true,
            finished: true,
            limitInfo: prepared.limitInfo,
            scope: prepared.chatScope,
            paperId: prepared.paper._id,
            questionId: prepared.item?._id,
          })}\n\n`
        );
        res.write(`event: end\ndata: {}\n\n`);
        res.end();
      };

      const emitTtsChunk = (emitText: string) => {
        const spoken = String(emitText || "").trim();
        if (!spoken) return;
        const currentIndex = chunkIndex++;
        pendingAudio += 1;
        callGeminiTts({ text: spoken, voice: resolvedVoice })
          .then(({ dataBase64, mimeType }) => {
            const wav = geminiTtsToWavBase64(dataBase64, mimeType);
            res.write(
              `event: audio\ndata: ${JSON.stringify({
                audio: wav,
                mimeType: "audio/wav",
                chunkIndex: currentIndex,
                isFinal: true,
              })}\n\n`
            );
          })
          .catch((error: any) => {
            res.write(
              `event: error\ndata: ${JSON.stringify({
                message: "TTS failed",
                error: error?.message || String(error),
                chunkIndex: currentIndex,
              })}\n\n`
            );
          })
          .finally(() => {
            pendingAudio -= 1;
            void maybeEnd();
          });
      };

      try {
        for await (const chunk of streamResult.stream) {
          const content = removeAsterisks(chunk.text());
          if (!content) continue;
          fullAnswer += content;
          pendingText += content;
          res.write(
            `event: text\ndata: ${JSON.stringify({
              text: content,
              isFinal: false,
            })}\n\n`
          );
          const boundaryIndex = findSpeechBoundary(pendingText);
          if (boundaryIndex < 0) continue;
          const emitText = pendingText.slice(0, boundaryIndex + 1);
          pendingText = pendingText.slice(boundaryIndex + 1);
          emitTtsChunk(emitText);
        }
      } catch (streamError: any) {
        if (res.headersSent) {
          res.write(
            `event: error\ndata: ${JSON.stringify({
              message: streamError?.message || "Stream parse error",
            })}\n\n`
          );
          res.write(`event: end\ndata: {}\n\n`);
          res.end();
          return;
        }
        throw streamError;
      }

      if (pendingText.trim()) {
        emitTtsChunk(pendingText);
        pendingText = "";
      }

      textComplete = true;
      void maybeEnd();
    } catch (error: any) {
      if (res.headersSent) {
        res.write(
          `event: error\ndata: ${JSON.stringify({
            message: error?.message || "Failed to chat on past question",
          })}\n\n`
        );
        res.write(`event: end\ndata: {}\n\n`);
        res.end();
        return;
      }
      const status = Number(error?.status) || 500;
      return res.status(status).json({
        status: false,
        message: error?.message || "Failed to chat on past question",
        error: error?.message || error,
        ...(error?.limitInfo ? { limitInfo: error.limitInfo } : {}),
      });
    }
  }
}

type PastQuestionChatBody = {
  question?: string;
  scope?: string;
  paperId?: string;
  questionId?: string;
  categoryId?: string;
  level?: string;
  paperCode?: string;
  title?: string;
  history?: unknown;
};

type PastQuestionChatUser = {
  id?: string;
  email?: string;
  role?: string;
};

const httpError = (status: number, message: string, extra: Record<string, unknown> = {}) => {
  const error: any = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
};

const findSpeechBoundary = (text: string, minChars = 48) => {
  if (String(text || "").trim().length < minChars) return -1;
  const sentence = /[.!?…](?=\s|$)/g;
  let lastIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = sentence.exec(text)) !== null) lastIndex = match.index;
  if (lastIndex >= 0) return lastIndex;
  const soft = /[,;:](?=\s|$)/g;
  while ((match = soft.exec(text)) !== null) lastIndex = match.index;
  return lastIndex;
};

const escapeHtml = (value: string) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const plainSpeechToHtml = (text: string) => {
  const paragraphs = String(text || "")
    .trim()
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!paragraphs.length) return "<article></article>";
  return `<article>${paragraphs
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br/>")}</p>`)
    .join("")}</article>`;
};

async function preparePastQuestionChat(
  currentUser: PastQuestionChatUser,
  body: PastQuestionChatBody,
  options: { speech?: boolean } = {}
) {
  const {
    question,
    scope = PastQuestionChatScope.PAPER,
    paperId,
    questionId,
    categoryId,
    level,
    paperCode,
    title,
    history,
  } = body;

  if (!question || !String(question).trim()) {
    throw httpError(400, "question is required");
  }

  const limitCheck = await checkPastQuestionAiLifetime(
    currentUser.id as string,
    currentUser.role,
    currentUser.email
  );
  if (!limitCheck.allowed) {
    throw httpError(429, limitCheck.reason || "Past question AI limit reached", {
      limitInfo: limitCheck,
    });
  }

  let paper: any = null;
  let item: any = null;
  const chatScope = String(scope || PastQuestionChatScope.PAPER);

  if (chatScope === PastQuestionChatScope.QUESTION) {
    if (!questionId || !mongoose.Types.ObjectId.isValid(questionId)) {
      throw httpError(400, "questionId is required for question scope");
    }
    item = await PastQuestionItem.findById(questionId).lean();
    if (!item) throw httpError(404, "Question not found");
    paper = await PastQuestionPaper.findById(item.paper).lean();
  } else if (chatScope === PastQuestionChatScope.PAPER) {
    if (!paperId || !mongoose.Types.ObjectId.isValid(paperId)) {
      throw httpError(400, "paperId is required for paper scope");
    }
    paper = await PastQuestionPaper.findById(paperId).lean();
  } else if (!paperId && categoryId && level) {
    const papers = await findCoursePapers({
      categoryId,
      level,
      paperCode,
      title,
    });
    paper = papers[0];
  } else if (paperId && mongoose.Types.ObjectId.isValid(paperId)) {
    paper = await PastQuestionPaper.findById(paperId).lean();
  }

  if (!paper) throw httpError(404, "Past question paper not found");

  const contextText = await getPastQuestionContext({
    email: currentUser.email,
    question,
    paper,
    item,
    scope: chatScope as "course" | "paper" | "question",
  });

  let prior = normalizeChatHistory(history);
  if (!prior.length) {
    const recent = await AiUsage.find({
      student: currentUser.id,
      source: "past-question",
      queryType: "chat",
      "metadata.paperId": String(paper._id),
    })
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();
    prior = recent
      .reverse()
      .flatMap((row: any) => {
        const turns: Array<{ role: "user" | "model"; text: string }> = [];
        if (row.question) {
          turns.push({ role: "user", text: stripHtml(row.question).slice(0, 4000) });
        }
        if (row.answer) {
          turns.push({ role: "model", text: stripHtml(row.answer).slice(0, 4000) });
        }
        return turns;
      })
      .slice(-12);
  }

  const historyText = prior.length
    ? prior
        .map((turn) => `${turn.role === "user" ? "Student" : "Assistant"}: ${turn.text}`)
        .join("\n\n")
    : "No prior chat history.";

  const system = options.speech ? CHAT_SPEECH_PROMPT : CHAT_SYSTEM_PROMPT;
  const prompt = `${system}\n\nConversation so far:\n${historyText}\n\nPast question / MSL context:\n${contextText}\n\nStudent question:\n${question}`;

  return {
    question: String(question).trim(),
    paper,
    item,
    chatScope,
    prior,
    prompt,
    limitInfo: {
      used: (limitCheck.used || 0) + 1,
      limit: limitCheck.limit,
      remaining: Math.max(0, (limitCheck.remaining || 0) - 1),
      unlimited: Boolean(limitCheck.unlimited),
    },
  };
}

async function runPastQuestionChat(
  currentUser: PastQuestionChatUser,
  body: PastQuestionChatBody
) {
  const prepared = await preparePastQuestionChat(currentUser, body);
  const completion = await geminiChatModel.generateContent({
    contents: [{ role: "user", parts: [{ text: prepared.prompt }] }],
  });
  const answer = removeAsterisks(completion.response.text());
  const usage = completion.response.usageMetadata;
  await new AiUsage({
    student: currentUser.id,
    queryType: "chat",
    source: "past-question",
    question: prepared.question,
    answer,
    prompt_tokens: usage?.promptTokenCount ?? estimateTokens(prepared.prompt),
    completion_tokens: usage?.candidatesTokenCount ?? estimateTokens(answer),
    total_tokens: estimateTokens(prepared.prompt) + estimateTokens(answer),
    model: GEMINI_CHAT_MODEL,
    cost_estimate_usd: 0,
    metadata: {
      scope: prepared.chatScope,
      paperId: String(prepared.paper._id),
      questionId: prepared.item ? String(prepared.item._id) : undefined,
      historyTurns: prepared.prior.length,
    },
  }).save();
  recordStudentActivity(currentUser.id as string, "ai_query", {}).catch(() => {});

  return {
    answer,
    paper: prepared.paper,
    item: prepared.item,
    chatScope: prepared.chatScope,
    limitInfo: prepared.limitInfo,
  };
}
