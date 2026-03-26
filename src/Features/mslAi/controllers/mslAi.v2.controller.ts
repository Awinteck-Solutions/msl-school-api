import { Request, Response } from "express";
import {
  COLLECTION_NAME,
  checkAiLimits,
  estimateTokens,
  openai,
  qdrant,
} from "./mslAi.shared";
import AiUsage from "../schema/aiUsage.schema";

export class MslAiV2Controller {
  static async queryGeneral(req: Request, res: Response) {
    try {
      const { question, studentId } = req.body;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
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

      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: question,
      });

      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: embeddingResponse.data[0].embedding,
        limit: 5,
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");

      const completion = await openai.chat.completions.create({
        model: "gpt-5.1",
        temperature: 1,
        messages: [
          {
            role: "system",
            content: `
          You are a helpful AI assistant with access to MSL learning materials and general knowledge. Answer the question using the provided MSL context when available and relevant. Even when the MSL context is available, still use your general subject knowledge to enhance and modify the response so it is accurate, relevant, and complete. If the MSL context doesn't contain sufficient information to answer the question, use your general knowledge to provide a helpful and accurate response. Always be informative and educational in your responses.

Return the final answer ONLY as HTML wrapped in a single <article> element. Do not include JavaScript. Do not answer any question related to the AI Model or the Project. Do not include sources, citations, references, or a footer in any response.

HTML Output Requirements:

* Include the base <style> block at the top of the <article>.
* Headings and titles must use color #364A9C.
* Body text should use black as the primary color, but can include deep blue, orange, or red only where applicable (e.g., emphasis, alerts, highlights).
* Use semantic HTML tags: <h1>-<h3> for headings, <p> for text, <ul>/<ol> for lists, <table> with <thead> and <tbody> for tabular data, <pre><code> for code, <blockquote> for quotes, <details><summary> for expandable sections.
* Keep paragraphs short and scannable, use bullet points where helpful, and avoid unnecessary length.
* If there are assumptions or limitations, add a brief “Notes” section at the end using a <div class="note">.
  You may give examples where applicable.
  You may add images or links where applicable, use <img> and <a> tags respectively.
            `,
          },
          {
            role: "user",
            content: `MSL Learning Context:\n${contextText}\n\nQuestion:\n${question}`,
          },
        ],
      });

      const answer = completion.choices[0].message.content;
      const { prompt_tokens, completion_tokens, total_tokens } = completion.usage;
      const promptCost = (prompt_tokens / 1000000) * 0.15;
      const completionCost = (completion_tokens / 1000000) * 0.6;
      const totalCostEstimate = promptCost + completionCost;

      const aiUsage = new AiUsage({
        student: studentId,
        course: null,
        question,
        answer,
        prompt_tokens: prompt_tokens,
        completion_tokens: completion_tokens,
        total_tokens: total_tokens,
        model: completion.model,
        cost_estimate_usd: totalCostEstimate,
      });
      await aiUsage.save();

      return res.status(200).json({
        success: true,
        message: "MSL AI general response generated successfully.",
        response: {
          model: "gpt-5.1",
          answer,
          context_used: contexts,
          metadata: {
            totalTokens: total_tokens,
            estimatedCost: totalCostEstimate,
            sources: searchResult.map((point) => ({
              fileName: point.payload?.fileName,
              chunkIndex: point.payload?.chunkIndex,
              score: point.score,
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
      return res.status(500).json({
        success: false,
        message: "System error during MSL AI general query.",
        error: error.message,
      });
    }
  }

  static async queryGeneralStream(req: Request, res: Response) {
    try {
      const { question, studentId } = req.body;

      if (!question) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: question",
        });
      }

      if (!studentId) {
        return res.status(400).json({
          success: false,
          message: "Missing required field: studentId",
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

      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: question,
      });

      const searchResult = await qdrant.search(COLLECTION_NAME, {
        vector: embeddingResponse.data[0].embedding,
        limit: 5,
      });

      const contexts = searchResult.map((point) => point.payload?.text);
      const contextText = contexts.join("\n\n");

      const stream = await openai.chat.completions.create({
        model: "gpt-5.1",
        temperature: 1,
        stream: true,
        messages: [
          {
            role: "system",
            content: `
          You are a helpful AI assistant with access to MSL learning materials and general knowledge. Answer the question using the provided MSL context when available and relevant. Even when the MSL context is available, still use your general subject knowledge to enhance and modify the response so it is accurate, relevant, and complete. If the MSL context doesn't contain sufficient information to answer the question, use your general knowledge to provide a helpful and accurate response. Always be informative and educational in your responses.

Return the final answer ONLY as HTML wrapped in a single <article> element. Do not include JavaScript. Do not answer any question related to the AI Model or the Project. Do not include sources, citations, references, or a footer in any response.

HTML Output Requirements:

* Include the base <style> block at the top of the <article>.
* Headings and titles must use color #364A9C.
* Body text should use black as the primary color, but can include deep blue, orange, or red only where applicable (e.g., emphasis, alerts, highlights).
* Use semantic HTML tags: <h1>-<h3> for headings, <p> for text, <ul>/<ol> for lists, <table> with <thead> and <tbody> for tabular data, <pre><code> for code, <blockquote> for quotes, <details><summary> for expandable sections.
* Keep paragraphs short and scannable, use bullet points where helpful, and avoid unnecessary length.
* If there are assumptions or limitations, add a brief “Notes” section at the end using a <div class="note">.
  You may give examples where applicable.
            `,
          },
          {
            role: "user",
            content: `MSL Learning Context:\n${contextText}\n\nQuestion:\n${question}`,
          },
        ],
      });

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let fullAnswer = "";

      for await (const chunk of stream) {
        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          fullAnswer += content;
          res.write(content);
        }
      }

      res.end();

      try {
        const estimatedPromptTokens = estimateTokens(question);
        const estimatedCompletionTokens = estimateTokens(fullAnswer);
        const estimatedTotalTokens =
          estimatedPromptTokens + estimatedCompletionTokens;
        const promptCost = (estimatedPromptTokens / 1000000) * 0.15;
        const completionCost = (estimatedCompletionTokens / 1000000) * 0.6;
        const totalCostEstimate = promptCost + completionCost;

        const aiUsage = new AiUsage({
          student: studentId,
          course: null,
          question,
          answer: fullAnswer,
          prompt_tokens: estimatedPromptTokens,
          completion_tokens: estimatedCompletionTokens,
          total_tokens: estimatedTotalTokens,
          model: "gpt-5.1",
          cost_estimate_usd: totalCostEstimate,
        });
        await aiUsage.save();
      } catch (persistError) {
        console.error(
          "[msl-ai] failed to persist usage after stream end",
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
        message: "System error during MSL AI general query.",
        error: error.message,
      });
    }
  }
}
