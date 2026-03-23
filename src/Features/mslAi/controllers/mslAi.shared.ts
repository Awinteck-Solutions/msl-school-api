import { Readable } from "stream";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";
const { PDFParse } = require("pdf-parse");

import User from "../../user/schema/user.schema";
import GlobalAiLimit from "../schema/globalAiLimit.schema";
import AiUsage from "../schema/aiUsage.schema";

export const COLLECTION_NAME = "msl_ai";
export const bucketName = process.env.S3_BUCKET || "";
export const s3 = new S3Client({});

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL || "http://localhost:6333",
});

const streamToBuffer = async (stream: Readable | Uint8Array | Buffer) => {
  if (Buffer.isBuffer(stream)) return stream;
  if (stream instanceof Uint8Array) return Buffer.from(stream);

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
};

export const chunkText = (text: string, chunkSize = 500) => {
  const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = "";
  for (const sentence of sentences) {
    if ((currentChunk + " " + sentence).split(" ").length > chunkSize) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += " " + sentence;
    }
  }
  if (currentChunk.trim() !== "") chunks.push(currentChunk.trim());
  return chunks;
};

export const downloadPDFfromS3 = async (s3Key: string) => {
  const params = { Bucket: bucketName, Key: s3Key };
  const data = await s3.send(new GetObjectCommand(params));
  const body = data.Body as Readable;
  return streamToBuffer(body);
};

export const parsePdfText = async (pdfBuffer: Buffer) => {
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const result = await parser.getText();
    return (result.text ?? "").replace(/\s+/g, " ").trim();
  } finally {
    await parser.destroy();
  }
};

export const handleQdrantOperation = async (
  operation: () => Promise<unknown>,
  operationName: string
) => {
  try {
    return await operation();
  } catch (error: any) {
    if (
      error?.code === "UND_ERR_CONNECT_TIMEOUT" ||
      error?.message?.includes("fetch failed")
    ) {
      throw new Error(
        `Vector database service unavailable during ${operationName}. Please check Qdrant server connection at ${
          process.env.QDRANT_URL || "http://localhost:6333"
        }`
      );
    }
    throw error;
  }
};

export const estimateTokens = (text: string) => {
  return Math.ceil(text.length / 4);
};

export const calculateOptimalBatchSize = (
  chunks: { text: string }[],
  maxTokensPerBatch = 8000
) => {
  let batchSize = 10;
  let totalTokens = 0;

  for (let i = 0; i < Math.min(chunks.length, 20); i++) {
    totalTokens += estimateTokens(chunks[i].text);
  }

  if (totalTokens > 0) {
    const avgTokensPerChunk = totalTokens / Math.min(chunks.length, 20);
    batchSize = Math.floor(maxTokensPerBatch / avgTokensPerChunk);
    batchSize = Math.max(1, Math.min(batchSize, 20));
  }

  return batchSize;
};

export const checkAiLimits = async (studentId: string) => {
  try {
    const user = await User.findById(studentId);
    if (!user) {
      return {
        allowed: false,
        reason: "User not found",
      };
    }

    let globalLimits = await GlobalAiLimit.findOne({});
    if (!globalLimits) {
      globalLimits = await GlobalAiLimit.create({
        dailyLimit: 10,
        monthlyLimit: 100,
        description: "Default global AI limits",
      });
    }

    const dailyLimit = user.ai_limit?.dailyLimit || globalLimits.dailyLimit;
    const monthlyLimit =
      user.ai_limit?.monthlyLimit || globalLimits.monthlyLimit;

    if (user.ai_limit && user.ai_limit.isActive === false) {
      return {
        allowed: false,
        reason: "AI access is disabled for this user",
      };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const dailyUsage = await AiUsage.countDocuments({
      student: studentId,
      createdAt: {
        $gte: today,
        $lt: tomorrow,
      },
    });

    if (dailyUsage >= dailyLimit) {
      return {
        allowed: false,
        reason: `Daily limit of ${dailyLimit} queries exceeded`,
        dailyUsage,
        dailyLimit,
      };
    }

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

    const monthlyUsage = await AiUsage.countDocuments({
      student: studentId,
      createdAt: {
        $gte: startOfMonth,
        $lte: endOfMonth,
      },
    });

    if (monthlyUsage >= monthlyLimit) {
      return {
        allowed: false,
        reason: `Monthly limit of ${monthlyLimit} queries exceeded`,
        monthlyUsage,
        monthlyLimit,
      };
    }

    return {
      allowed: true,
      dailyUsage,
      dailyLimit,
      monthlyUsage,
      monthlyLimit,
      remainingDaily: dailyLimit - dailyUsage,
      remainingMonthly: monthlyLimit - monthlyUsage,
    };
  } catch (error) {
    return {
      allowed: false,
      reason: "Error checking limits",
    };
  }
};
