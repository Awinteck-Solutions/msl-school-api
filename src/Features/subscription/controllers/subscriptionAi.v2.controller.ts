import { Request, Response } from "express";
import mongoose from "mongoose";
import {
  COLLECTION_NAME,
  GEMINI_CHAT_MODEL,
  SUBSCRIPTION_COLLECTION_NAME,
  buildContentFilter,
  callGeminiAudioTranscription,
  callGeminiTts,
  checkSubscriptionAiLimits,
  embedText,
  estimateTokens,
  geminiChatModel,
  getContextFromQdrant,
  searchAiCollections,
} from "../../geminiAi/controllers/geminiAi.shared";
import AiUsage from "../../mslAi/schema/aiUsage.schema";
import { recordStudentActivity } from "../../gamification/service/gamification.service";
import { getUserEnrolledCourseIds } from "./subscription.service";

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
`;

const buildGeneralPrompt = (contextText: string, question: string) =>
  `${GENERAL_SYSTEM_PROMPT}\n\nMSL Learning Context:\n${contextText}\n\nQuestion:\n${question}`;

const buildGeneralPromptWithHistory = (
  contextText: string,
  question: string,
  historyText: string
) =>
  `${GENERAL_SYSTEM_PROMPT}\n\nConversation so far:\n${historyText}\n\nMSL Learning Context:\n${contextText}\n\nQuestion:\n${question}`;

const SUMMARIZE_SYSTEM_PROMPT = `You are an educational assistant. Summarize the following content clearly and concisely for a student. Use bullet points and headings where helpful. Output the summary as HTML wrapped in a single <article> element. Use <h1>-<h3> for headings, <p> for paragraphs, <ul>/<ol> for lists. Do not include JavaScript or external links.`;

const FLASHCARD_PROMPT = (count: number) =>
  `You are an educational assistant. Based on the following content, generate exactly ${count} flashcards. Each flashcard must have "term" and "definition". Rules for "term": use exactly one or two words only—a short label, concept name, or key vocabulary. Rules for "definition": a clear answer or explanation. Output ONLY a valid JSON array of objects with keys "term" and "definition". No other text, no markdown code fence.`;

const QUIZ_PROMPT = (numQuestions: number) =>
  `You are an educational assistant. Based on the following content, generate exactly ${numQuestions} multiple-choice quiz questions. Each question must be a JSON object with: "title" (the question text), "objectives" (array of 4 option strings), "answer" (the exact text of the correct option), "answer_notes" (brief explanation, optional), "difficulty" (one of: EASY, MEDIUM, HARD, NEUTRAL). Output ONLY a valid JSON array of these objects. No other text, no markdown code fence.`;

const removeAsterisks = (text: string) => String(text || "").replace(/\*/g, "");

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
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
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

const parseJsonArray = (raw: string) => {
  let jsonStr = String(raw || "").trim();
  const codeBlock = /^```(?:json)?\s*([\s\S]*?)```$/;
  const match = jsonStr.match(codeBlock);
  if (match) jsonStr = match[1].trim();
  const parsed = JSON.parse(jsonStr);
  return Array.isArray(parsed) ? parsed : [];
};

const subscriptionUsageFilter = (studentId: string) => ({
  student: new mongoose.Types.ObjectId(studentId),
  source: "subscription",
});

const getSearchCollections = async (
  email: string | undefined,
  s3Keys?: string[],
  resourceId?: string
) => {
  const subscriptionFilter = buildContentFilter({ s3Keys, resourceId });
  const collections: Array<{ name: string; filter?: Record<string, unknown> }> =
    [{ name: SUBSCRIPTION_COLLECTION_NAME, filter: subscriptionFilter }];

  const courseIds = await getUserEnrolledCourseIds(email);
  if (courseIds.length > 0) {
    const extraMust = Array.isArray((subscriptionFilter as { must?: unknown[] } | undefined)?.must)
      ? ((subscriptionFilter as { must: unknown[] }).must)
      : [];
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
          ...extraMust,
        ],
      },
    });
  }
  return { collections, courseIds };
};

const getGenerationContext = async (params: {
  email?: string;
  s3Keys?: string[];
  topic?: string;
  resourceId?: string;
}) => {
  const { collections, courseIds } = await getSearchCollections(
    params.email,
    params.s3Keys,
    params.resourceId
  );
  const collectionNames = collections.map((item) => item.name);

  if (params.topic) {
    const embeddingVector = await embedText(params.topic);
    const searchResult = await searchAiCollections({
      collections,
      embeddingVector,
      limit: 12,
    });
    return searchResult
      .map((point) => point.payload?.text)
      .filter(Boolean)
      .join("\n\n");
  }

  const scopedContext = await getContextFromQdrant({
    s3Keys: params.s3Keys,
    collections: collectionNames,
    courseId: courseIds.length === 1 ? courseIds[0] : undefined,
    resourceId: params.resourceId,
  });
  if (scopedContext && scopedContext.trim()) return scopedContext;

  const embeddingVector = await embedText(
    "key concepts, definitions, and important topics"
  );
  const searchResult = await searchAiCollections({
    collections,
    embeddingVector,
    limit: 12,
  });
  return searchResult
    .map((point) => point.payload?.text)
    .filter(Boolean)
    .join("\n\n");
};

const persistUsage = async (payload: Record<string, unknown>) => {
  await new AiUsage({
    ...payload,
    source: "subscription",
  }).save();
};

const limitDenied = (res: Response, limitCheck: any) =>
  res.status(429).json({
    success: false,
    message: limitCheck.reason,
    limitInfo: {
      dailyUsage: limitCheck.dailyUsage,
      dailyLimit: limitCheck.dailyLimit,
      monthlyUsage: limitCheck.monthlyUsage,
      monthlyLimit: limitCheck.monthlyLimit,
    },
  });

export class SubscriptionAiV2Controller {
  static async queryGeneral(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as { id?: string; email?: string };
      const { question, s3Keys, resourceId } = req.body as {
        question?: string;
        s3Keys?: string[];
        resourceId?: string;
      };
      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }
      if (!currentUser?.id) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkSubscriptionAiLimits(currentUser.id);
      if (!limitCheck.allowed) return limitDenied(res, limitCheck);

      const { collections } = await getSearchCollections(
        currentUser.email,
        Array.isArray(s3Keys) ? s3Keys : undefined,
        resourceId
      );
      const embeddingVector = await embedText(question);
      const searchResult = await searchAiCollections({
        collections,
        embeddingVector,
        limit: 5,
      });
      const contexts = searchResult.map((point) => point.payload?.text);
      const prompt = buildGeneralPrompt(contexts.join("\n\n"), question);
      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const answer = removeAsterisks(completion.response.text());
      const usage = completion.response.usageMetadata;
      const promptTokens = usage?.promptTokenCount ?? estimateTokens(prompt);
      const completionTokens =
        usage?.candidatesTokenCount ?? estimateTokens(answer);

      await persistUsage({
        student: currentUser.id,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        queryType: "chat",
        question,
        answer,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      });
      recordStudentActivity(currentUser.id, "ai_query", {}).catch(() => {});

      return res.status(200).json({
        success: true,
        message: "Subscription AI response generated successfully.",
        response: {
          model: GEMINI_CHAT_MODEL,
          answer,
          context_used: contexts,
          limitInfo: {
            dailyUsage: (limitCheck.dailyUsage || 0) + 1,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: (limitCheck.monthlyUsage || 0) + 1,
            monthlyLimit: limitCheck.monthlyLimit,
            remainingDaily: (limitCheck.remainingDaily || 0) - 1,
            remainingMonthly: (limitCheck.remainingMonthly || 0) - 1,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "System error during subscription AI query.",
        error: error.message,
      });
    }
  }

  static async queryGeneralWithContext(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as { id?: string; email?: string };
      const { question, s3Keys, resourceId } = req.body as {
        question?: string;
        s3Keys?: string[];
        resourceId?: string;
      };
      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }
      if (!currentUser?.id) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkSubscriptionAiLimits(currentUser.id);
      if (!limitCheck.allowed) return limitDenied(res, limitCheck);

      const { collections } = await getSearchCollections(
        currentUser.email,
        Array.isArray(s3Keys) ? s3Keys : undefined,
        resourceId
      );
      const embeddingVector = await embedText(question);
      const searchResult = await searchAiCollections({
        collections,
        embeddingVector,
        limit: 5,
      });
      const contexts = searchResult.map((point) => point.payload?.text);

      const historyItems = await AiUsage.find({
        ...subscriptionUsageFilter(currentUser.id),
        $or: [
          { queryType: "chat" },
          { queryType: { $exists: false } },
          { queryType: null },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
      const historyText = historyItems
        .reverse()
        .map((item: any) => `User: ${item.question || ""}\nAssistant: ${item.answer || ""}`)
        .join("\n\n");

      const prompt = buildGeneralPromptWithHistory(
        contexts.join("\n\n"),
        question,
        historyText || "No prior chat history."
      );
      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const answer = removeAsterisks(completion.response.text());
      const usage = completion.response.usageMetadata;
      const promptTokens = usage?.promptTokenCount ?? estimateTokens(prompt);
      const completionTokens =
        usage?.candidatesTokenCount ?? estimateTokens(answer);

      await persistUsage({
        student: currentUser.id,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        queryType: "chat",
        question,
        answer,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      });
      recordStudentActivity(currentUser.id, "ai_query", {}).catch(() => {});

      return res.status(200).json({
        success: true,
        message: "Subscription AI response generated successfully.",
        response: {
          model: GEMINI_CHAT_MODEL,
          answer,
          context_used: contexts,
          limitInfo: {
            dailyUsage: (limitCheck.dailyUsage || 0) + 1,
            dailyLimit: limitCheck.dailyLimit,
            monthlyUsage: (limitCheck.monthlyUsage || 0) + 1,
            monthlyLimit: limitCheck.monthlyLimit,
            remainingDaily: (limitCheck.remainingDaily || 0) - 1,
            remainingMonthly: (limitCheck.remainingMonthly || 0) - 1,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "System error during subscription AI query.",
        error: error.message,
      });
    }
  }

  static async queryGeneralStream(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as { id?: string; email?: string };
      const { question, s3Keys, resourceId } = req.body as {
        question?: string;
        s3Keys?: string[];
        resourceId?: string;
      };
      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }
      if (!currentUser?.id) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkSubscriptionAiLimits(currentUser.id);
      if (!limitCheck.allowed) return limitDenied(res, limitCheck);

      const { collections } = await getSearchCollections(
        currentUser.email,
        Array.isArray(s3Keys) ? s3Keys : undefined,
        resourceId
      );
      const embeddingVector = await embedText(question);
      const searchResult = await searchAiCollections({
        collections,
        embeddingVector,
        limit: 5,
      });
      const prompt = buildGeneralPrompt(
        searchResult.map((point) => point.payload?.text).join("\n\n"),
        question
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

      await persistUsage({
        student: currentUser.id,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        queryType: "chat",
        question,
        answer: fullAnswer,
        prompt_tokens: estimateTokens(prompt),
        completion_tokens: estimateTokens(fullAnswer),
        total_tokens: estimateTokens(prompt) + estimateTokens(fullAnswer),
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      });
      recordStudentActivity(currentUser.id, "ai_query", {}).catch(() => {});
    } catch (error: any) {
      if (res.headersSent) {
        res.end();
        return;
      }
      return res.status(500).json({
        success: false,
        message: "System error during subscription AI query.",
        error: error.message,
      });
    }
  }

  static async queryGeneralWithContextStream(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as { id?: string; email?: string };
      const { question, s3Keys, resourceId } = req.body as {
        question?: string;
        s3Keys?: string[];
        resourceId?: string;
      };
      if (!question || !currentUser?.id) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      const limitCheck = await checkSubscriptionAiLimits(currentUser.id);
      if (!limitCheck.allowed) return limitDenied(res, limitCheck);

      const { collections } = await getSearchCollections(
        currentUser.email,
        Array.isArray(s3Keys) ? s3Keys : undefined,
        resourceId
      );
      const embeddingVector = await embedText(question);
      const searchResult = await searchAiCollections({
        collections,
        embeddingVector,
        limit: 5,
      });
      const historyItems = await AiUsage.find({
        ...subscriptionUsageFilter(currentUser.id),
        $or: [
          { queryType: "chat" },
          { queryType: { $exists: false } },
          { queryType: null },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
      const historyText = historyItems
        .reverse()
        .map((item: any) => `User: ${item.question || ""}\nAssistant: ${item.answer || ""}`)
        .join("\n\n");
      const prompt = buildGeneralPromptWithHistory(
        searchResult.map((point) => point.payload?.text).join("\n\n"),
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
      for await (const chunk of streamResult.stream) {
        const content = removeAsterisks(chunk.text());
        if (content) {
          fullAnswer += content;
          res.write(content);
        }
      }
      res.end();

      await persistUsage({
        student: currentUser.id,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        queryType: "chat",
        question,
        answer: fullAnswer,
        prompt_tokens: estimateTokens(prompt),
        completion_tokens: estimateTokens(fullAnswer),
        total_tokens: estimateTokens(prompt) + estimateTokens(fullAnswer),
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      });
      recordStudentActivity(currentUser.id, "ai_query", {}).catch(() => {});
    } catch (error: any) {
      if (res.headersSent) {
        res.end();
        return;
      }
      return res.status(500).json({
        success: false,
        message: "System error during subscription AI query.",
        error: error.message,
      });
    }
  }

  static async summarize(req: Request, res: Response) {
    try {
      const currentUser = req["currentUser"] as { id?: string; email?: string };
      const { s3Keys, topic, resourceId } = req.body as {
        s3Keys?: string[];
        topic?: string;
        resourceId?: string;
      };
      if (!currentUser?.id) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }
      const limitCheck = await checkSubscriptionAiLimits(currentUser.id);
      if (!limitCheck.allowed) return limitDenied(res, limitCheck);

      const contextText = await getGenerationContext({
        email: currentUser.email,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        topic,
        resourceId,
      });
      if (!contextText || contextText.trim().length < 1) {
        return res.status(400).json({
          success: false,
          message: "No subscription training content found to summarize.",
        });
      }

      const prompt = `${SUMMARIZE_SYSTEM_PROMPT}\n\nContent to summarize:\n\n${contextText}`;
      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const summary = completion.response.text();
      const usage = completion.response.usageMetadata;
      await persistUsage({
        student: currentUser.id,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        queryType: "summarize",
        question: topic || "[summarize]",
        answer: summary,
        prompt_tokens: usage?.promptTokenCount ?? estimateTokens(prompt),
        completion_tokens: usage?.candidatesTokenCount ?? estimateTokens(summary),
        total_tokens: estimateTokens(prompt) + estimateTokens(summary),
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      });
      recordStudentActivity(currentUser.id, "ai_query", {}).catch(() => {});

      return res.status(200).json({
        success: true,
        message: "Summary generated successfully.",
        response: {
          model: GEMINI_CHAT_MODEL,
          summary,
          limitInfo: {
            dailyUsage: (limitCheck.dailyUsage || 0) + 1,
            dailyLimit: limitCheck.dailyLimit,
            remainingDaily: (limitCheck.remainingDaily || 0) - 1,
            remainingMonthly: (limitCheck.remainingMonthly || 0) - 1,
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
      const currentUser = req["currentUser"] as { id?: string; email?: string };
      const { s3Keys, topic, count = 10, resourceId } = req.body as {
        s3Keys?: string[];
        topic?: string;
        count?: number;
        resourceId?: string;
      };
      if (!currentUser?.id) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }
      const limitCheck = await checkSubscriptionAiLimits(currentUser.id);
      if (!limitCheck.allowed) return limitDenied(res, limitCheck);

      const contextText = await getGenerationContext({
        email: currentUser.email,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        topic,
        resourceId,
      });
      if (!contextText || contextText.trim().length < 50) {
        return res.status(400).json({
          success: false,
          message: "No subscription training content found.",
        });
      }

      const numCards = Math.min(Math.max(Number(count) || 10, 1), 20);
      const prompt = `${FLASHCARD_PROMPT(numCards)}\n\nContent:\n\n${contextText}`;
      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const raw = completion.response.text();
      let items: { term: string; definition: string }[] = [];
      try {
        items = parseJsonArray(raw);
      } catch {
        return res.status(500).json({
          success: false,
          message: "AI did not return valid JSON for flashcards.",
          raw: raw.slice(0, 500),
        });
      }
      const flashcards = items
        .filter(
          (item) =>
            item &&
            typeof item.term === "string" &&
            typeof item.definition === "string"
        )
        .slice(0, numCards)
        .map((item) => ({
          term: String(item.term).trim(),
          definition: String(item.definition).trim(),
        }));

      await persistUsage({
        student: currentUser.id,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        queryType: "generate-flashcards",
        question: topic || "[generate-flashcards]",
        answer: raw,
        prompt_tokens: estimateTokens(prompt),
        completion_tokens: estimateTokens(raw),
        total_tokens: estimateTokens(prompt) + estimateTokens(raw),
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      });
      recordStudentActivity(currentUser.id, "ai_query", {}).catch(() => {});

      return res.status(200).json({
        success: true,
        message: "Flashcards generated successfully.",
        response: {
          model: GEMINI_CHAT_MODEL,
          flashcards,
          persisted: false,
          limitInfo: {
            dailyUsage: (limitCheck.dailyUsage || 0) + 1,
            dailyLimit: limitCheck.dailyLimit,
            remainingDaily: (limitCheck.remainingDaily || 0) - 1,
            remainingMonthly: (limitCheck.remainingMonthly || 0) - 1,
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
      const currentUser = req["currentUser"] as { id?: string; email?: string };
      const { s3Keys, topic, numQuestions = 5, resourceId } = req.body as {
        s3Keys?: string[];
        topic?: string;
        numQuestions?: number;
        resourceId?: string;
      };
      if (!currentUser?.id) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }
      const limitCheck = await checkSubscriptionAiLimits(currentUser.id);
      if (!limitCheck.allowed) return limitDenied(res, limitCheck);

      const contextText = await getGenerationContext({
        email: currentUser.email,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        topic,
        resourceId,
      });
      if (!contextText || contextText.trim().length < 50) {
        return res.status(400).json({
          success: false,
          message: "No subscription training content found.",
        });
      }

      const numQ = Math.min(Math.max(Number(numQuestions) || 5, 1), 25);
      const prompt = `${QUIZ_PROMPT(numQ)}\n\nContent:\n\n${contextText}`;
      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const raw = completion.response.text();
      let items: any[] = [];
      try {
        items = parseJsonArray(raw);
      } catch {
        return res.status(500).json({
          success: false,
          message: "AI did not return valid JSON for quiz questions.",
          raw: raw.slice(0, 500),
        });
      }
      const validDifficulty = ["EASY", "MEDIUM", "HARD", "NEUTRAL"];
      const questions = items
        .filter(
          (item) =>
            item &&
            typeof item.title === "string" &&
            Array.isArray(item.objectives) &&
            typeof item.answer === "string"
        )
        .slice(0, numQ)
        .map((item) => ({
          title: String(item.title).trim(),
          type: "MULTIPLE_CHOICE",
          difficulty: validDifficulty.includes(
            String(item.difficulty || "").toUpperCase()
          )
            ? String(item.difficulty).toUpperCase()
            : "NEUTRAL",
          objectives: (item.objectives || [])
            .map((option: unknown) => String(option).trim())
            .slice(0, 10),
          objectivesWithImage: [],
          answer: String(item.answer).trim(),
          answer_notes: item.answer_notes
            ? String(item.answer_notes).trim()
            : undefined,
        }));

      await persistUsage({
        student: currentUser.id,
        s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
        queryType: "generate-quiz",
        question: topic || "[generate-quiz]",
        answer: raw,
        prompt_tokens: estimateTokens(prompt),
        completion_tokens: estimateTokens(raw),
        total_tokens: estimateTokens(prompt) + estimateTokens(raw),
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
      });
      recordStudentActivity(currentUser.id, "ai_query", {}).catch(() => {});

      return res.status(200).json({
        success: true,
        message: "Quiz generated successfully.",
        response: {
          model: GEMINI_CHAT_MODEL,
          questions,
          persisted: false,
          limitInfo: {
            dailyUsage: (limitCheck.dailyUsage || 0) + 1,
            dailyLimit: limitCheck.dailyLimit,
            remainingDaily: (limitCheck.remainingDaily || 0) - 1,
            remainingMonthly: (limitCheck.remainingMonthly || 0) - 1,
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

  static async history(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing studentId",
        });
      }
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const queryType = (req.query.queryType as string) || "chat";
      const filter = {
        ...subscriptionUsageFilter(id),
        queryType,
      };
      const [history, total] = await Promise.all([
        AiUsage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        AiUsage.countDocuments(filter),
      ]);
      const totalPages = Math.ceil(total / limit);
      return res.status(200).json({
        success: true,
        message: "Subscription AI chat history fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
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

  static async nonChatHistory(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid or missing studentId",
        });
      }
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.max(1, parseInt(req.query.limit as string, 10) || 50);
      const skip = (page - 1) * limit;
      const filter = {
        ...subscriptionUsageFilter(id),
        queryType: { $in: ["generate-flashcards", "generate-quiz", "summarize"] },
      };
      const [history, total] = await Promise.all([
        AiUsage.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        AiUsage.countDocuments(filter),
      ]);
      return res.status(200).json({
        success: true,
        message: "Subscription AI recent activity fetched successfully",
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        response: history,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching recent activity",
        error: error?.message,
      });
    }
  }

  static async summarizeHistory(req: Request, res: Response) {
    try {
      const { id } = req["currentUser"] as { id?: string };
      if (!id) {
        return res.status(400).json({ success: false, message: "Invalid studentId" });
      }
      const history = await AiUsage.find({
        ...subscriptionUsageFilter(id),
        queryType: "summarize",
      })
        .sort({ createdAt: -1 })
        .lean();
      return res.status(200).json({
        success: true,
        message: "AI summaries fetched successfully",
        response: history.map((row: any) => ({
          _id: row._id,
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
      if (!id) {
        return res.status(400).json({ success: false, message: "Invalid studentId" });
      }
      const history = await AiUsage.find({
        ...subscriptionUsageFilter(id),
        queryType: "generate-flashcards",
      })
        .sort({ createdAt: -1 })
        .lean();
      return res.status(200).json({
        success: true,
        message: "AI flashcards fetched successfully",
        response: history.map((row: any) => {
          let flashcards: { term: string; definition: string }[] = [];
          try {
            flashcards = parseJsonArray(row.answer || "")
              .filter(
                (item: any) =>
                  item &&
                  typeof item.term === "string" &&
                  typeof item.definition === "string"
              )
              .map((item: any) => ({
                term: String(item.term).trim(),
                definition: String(item.definition).trim(),
              }));
          } catch {
            flashcards = [];
          }
          return {
            _id: row._id,
            flashcards,
            model: row.model,
            createdAt: row.createdAt,
          };
        }),
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
      if (!id) {
        return res.status(400).json({ success: false, message: "Invalid studentId" });
      }
      const history = await AiUsage.find({
        ...subscriptionUsageFilter(id),
        queryType: "generate-quiz",
      })
        .sort({ createdAt: -1 })
        .lean();
      return res.status(200).json({
        success: true,
        message: "AI quizzes fetched successfully",
        response: history.map((row: any) => {
          let questions: any[] = [];
          try {
            questions = parseJsonArray(row.answer || "");
          } catch {
            questions = [];
          }
          return {
            _id: row._id,
            questions,
            model: row.model,
            createdAt: row.createdAt,
          };
        }),
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Error fetching AI quizzes",
        error: error?.message,
      });
    }
  }

  static async queryGeneralWithContextAudioTextStream(
    req: Request,
    res: Response
  ) {
    try {
      const currentUser = req["currentUser"] as { id?: string; email?: string };
      const { question, s3Keys, resourceId, voiceName } = req.body as {
        question?: string;
        s3Keys?: string[];
        resourceId?: string;
        voiceName?: string;
      };
      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }
      if (!currentUser?.id) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkSubscriptionAiLimits(currentUser.id);
      if (!limitCheck.allowed) return limitDenied(res, limitCheck);

      const { collections } = await getSearchCollections(
        currentUser.email,
        Array.isArray(s3Keys) ? s3Keys : undefined,
        resourceId
      );
      const embeddingVector = await embedText(question);
      const searchResult = await searchAiCollections({
        collections,
        embeddingVector,
        limit: 5,
      });
      const contextText = searchResult
        .map((point) => point.payload?.text)
        .join("\n\n");

      const historyItems = await AiUsage.find({
        ...subscriptionUsageFilter(currentUser.id),
        $or: [
          { queryType: "chat" },
          { queryType: { $exists: false } },
          { queryType: null },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();
      const historyText = historyItems
        .reverse()
        .map(
          (item: any) =>
            `User: ${item.question || ""}\nAssistant: ${item.answer || ""}`
        )
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
        if (!textComplete || pendingAudio !== 0) return;
        try {
          await persistUsage({
            student: currentUser.id,
            s3Keys: Array.isArray(s3Keys) ? s3Keys : undefined,
            queryType: "chat",
            question,
            answer: fullAnswer,
            prompt_tokens: estimateTokens(prompt),
            completion_tokens: estimateTokens(fullAnswer),
            total_tokens: estimateTokens(prompt) + estimateTokens(fullAnswer),
            model: GEMINI_CHAT_MODEL,
            cost_estimate_usd: 0,
          });
          recordStudentActivity(currentUser.id as string, "ai_query", {}).catch(
            () => {}
          );
        } catch (persistError) {
          console.error(
            "[subscription-ai] failed to persist usage after audio text stream",
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
          if (boundaryIndex < 0) continue;

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
          chunkIndex,
        })}\n\n`
      );
      textComplete = true;
      void maybeEnd();
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "System error during subscription AI audio query.",
        error: error.message,
      });
    }
  }

  static async queryImage(req: MulterRequest, res: Response) {
    try {
      const currentUser = req["currentUser"] as { id?: string; email?: string };
      const { question, s3Keys, resourceId } = req.body as {
        question?: string;
        s3Keys?: string[] | string;
        resourceId?: string;
      };
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
      if (!currentUser?.id) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
        });
      }

      const limitCheck = await checkSubscriptionAiLimits(currentUser.id);
      if (!limitCheck.allowed) return limitDenied(res, limitCheck);

      const normalizedS3Keys = Array.isArray(s3Keys)
        ? s3Keys
        : typeof s3Keys === "string" && s3Keys.trim()
        ? [s3Keys]
        : undefined;
      const { collections } = await getSearchCollections(
        currentUser.email,
        normalizedS3Keys,
        resourceId
      );
      const embeddingVector = await embedText(question);
      const searchResult = await searchAiCollections({
        collections,
        embeddingVector,
        limit: 5,
      });
      const contextText = searchResult
        .map((point) => point.payload?.text)
        .join("\n\n");
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
      const answer = removeAsterisks(completion.response.text());
      const usage = completion.response.usageMetadata;
      await persistUsage({
        student: currentUser.id,
        s3Keys: normalizedS3Keys,
        queryType: "chat",
        question,
        answer,
        prompt_tokens: usage?.promptTokenCount ?? estimateTokens(prompt),
        completion_tokens: usage?.candidatesTokenCount ?? estimateTokens(answer),
        total_tokens: estimateTokens(prompt) + estimateTokens(answer),
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
        metadata: {
          imageMimeType: file.mimetype,
          type: "image",
        },
      });

      return res.status(200).json({
        success: true,
        message: "Image question answered successfully.",
        response: { answer },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "System error during image query.",
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
      return res.status(500).json({
        success: false,
        message: "System error during voice transcription.",
        error: error.message,
      });
    }
  }
}
