import { Request, Response } from "express";
import mongoose from "mongoose";
import {
  GEMINI_CHAT_MODEL,
  checkAiLimits,
  estimateTokens,
  geminiChatModel,
} from "../../geminiAi/controllers/geminiAi.shared";
import AiUsage from "../../mslAi/schema/aiUsage.schema";
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
  courseKey,
  findCoursePapers,
  getPastQuestionContext,
  serializePaper,
} from "./pastQuestion.service";

const CHAT_SYSTEM_PROMPT = `
You are a helpful AI assistant for ICAG and MSL past exam questions. Use the provided past-question text and MSL learning context when relevant. You may also use general subject knowledge so the answer is complete and exam-useful.

Never mention sources, context, or training data. Never use asterisk (*).
Return the final answer ONLY as HTML wrapped in a single <article> element.
`;

const removeAsterisks = (text: string) => String(text || "").replace(/\*/g, "");

export class PastQuestionV2Controller {
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
      return res.status(200).json({
        status: true,
        message: "Past question insights fetched",
        response: {
          paper: paperInsight,
          course: courseInsight,
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
      return res.status(200).json({
        status: true,
        message: "Course past-question insights fetched",
        response: {
          insight,
          papers: papers.map((paper: any) => serializePaper(paper)),
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
      const currentUser = req["currentUser"] as { id?: string; email?: string };
      const {
        question,
        scope = PastQuestionChatScope.PAPER,
        paperId,
        questionId,
        categoryId,
        level,
        paperCode,
      } = req.body as {
        question?: string;
        scope?: string;
        paperId?: string;
        questionId?: string;
        categoryId?: string;
        level?: string;
        paperCode?: string;
      };
      if (!currentUser?.id) {
        return res.status(401).json({ status: false, message: "Unauthorized" });
      }
      if (!question || !String(question).trim()) {
        return res.status(400).json({
          status: false,
          message: "question is required",
        });
      }

      const limitCheck = await checkAiLimits(currentUser.id);
      if (!limitCheck.allowed) {
        return res.status(429).json({
          status: false,
          message: limitCheck.reason,
          limitInfo: limitCheck,
        });
      }

      let paper: any = null;
      let item: any = null;
      const chatScope = String(scope || PastQuestionChatScope.PAPER);

      if (chatScope === PastQuestionChatScope.QUESTION) {
        if (!questionId || !mongoose.Types.ObjectId.isValid(questionId)) {
          return res.status(400).json({
            status: false,
            message: "questionId is required for question scope",
          });
        }
        item = await PastQuestionItem.findById(questionId).lean();
        if (!item) {
          return res.status(404).json({ status: false, message: "Question not found" });
        }
        paper = await PastQuestionPaper.findById(item.paper).lean();
      } else if (chatScope === PastQuestionChatScope.PAPER) {
        if (!paperId || !mongoose.Types.ObjectId.isValid(paperId)) {
          return res.status(400).json({
            status: false,
            message: "paperId is required for paper scope",
          });
        }
        paper = await PastQuestionPaper.findById(paperId).lean();
      } else {
        if (!paperId && categoryId && level) {
          const papers = await findCoursePapers({
            categoryId,
            level,
            paperCode,
          });
          paper = papers[0];
        } else if (paperId && mongoose.Types.ObjectId.isValid(paperId)) {
          paper = await PastQuestionPaper.findById(paperId).lean();
        }
      }

      if (!paper) {
        return res.status(404).json({
          status: false,
          message: "Past question paper not found",
        });
      }

      const contextText = await getPastQuestionContext({
        email: currentUser.email,
        question,
        paper,
        item,
        scope: chatScope as "course" | "paper" | "question",
      });
      const prompt = `${CHAT_SYSTEM_PROMPT}\n\nPast question / MSL context:\n${contextText}\n\nStudent question:\n${question}`;
      const completion = await geminiChatModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      const answer = removeAsterisks(completion.response.text());
      const usage = completion.response.usageMetadata;
      await new AiUsage({
        student: currentUser.id,
        queryType: "chat",
        source: "past-question",
        question,
        answer,
        prompt_tokens: usage?.promptTokenCount ?? estimateTokens(prompt),
        completion_tokens: usage?.candidatesTokenCount ?? estimateTokens(answer),
        total_tokens: estimateTokens(prompt) + estimateTokens(answer),
        model: GEMINI_CHAT_MODEL,
        cost_estimate_usd: 0,
        metadata: {
          scope: chatScope,
          paperId: String(paper._id),
          questionId: item ? String(item._id) : undefined,
        },
      }).save();
      recordStudentActivity(currentUser.id, "ai_query", {}).catch(() => {});

      return res.status(200).json({
        status: true,
        success: true,
        message: "Past question chat response",
        response: {
          model: GEMINI_CHAT_MODEL,
          answer,
          scope: chatScope,
          paperId: paper._id,
          questionId: item?._id,
          limitInfo: {
            dailyUsage: (limitCheck.dailyUsage || 0) + 1,
            dailyLimit: limitCheck.dailyLimit,
            remainingDaily: (limitCheck.remainingDaily || 0) - 1,
          },
        },
      });
    } catch (error: any) {
      return res.status(500).json({
        status: false,
        message: "Failed to chat on past question",
        error: error?.message || error,
      });
    }
  }
}
