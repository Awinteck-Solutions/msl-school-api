import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { Readable } from "stream";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { QdrantClient } from "@qdrant/js-client-rest";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
const { PDFParse } = require("pdf-parse");

import User from "../../user/schema/user.schema";
import GlobalAiLimit from "../../mslAi/schema/globalAiLimit.schema";
import AiUsage from "../../mslAi/schema/aiUsage.schema";
import Lesson from "../../lesson/schema/lesson.schema";
import mongoose from "mongoose";
import SubscriptionPlan from "../../subscription/schema/subscriptionPlan.schema";

export const COLLECTION_NAME = "gemini_ai";
export const SUBSCRIPTION_COLLECTION_NAME =
  process.env.GEMINI_SUBSCRIPTION_COLLECTION || "gemini_ai_subscription";
export const GEMINI_CHAT_MODEL =
  process.env.GEMINI_CHAT_MODEL || "gemini-2.5-flash";
export const GEMINI_EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
export const GEMINI_AUDIO_MODEL =
  process.env.GEMINI_AUDIO_MODEL ||
  "gemini-2.5-flash";
export const GEMINI_AUDIO_METHOD =
  process.env.GEMINI_AUDIO_METHOD || "generateContent";
export const GEMINI_TTS_MODEL =
  process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
export const GEMINI_TTS_VOICE =
  process.env.GEMINI_TTS_VOICE || "Aoede";
export const GEMINI_LIVE_MODEL =
  process.env.GEMINI_LIVE_MODEL || "gemini-2.5-flash-live";
export const GEMINI_LIVE_AUDIO_MIME =
  process.env.GEMINI_LIVE_AUDIO_MIME || "audio/pcm;rate=24000";
export const GEMINI_EMBEDDING_DIMENSIONS = 768;
export const QDRANT_VECTOR_NAME =
  process.env.GEMINI_QDRANT_VECTOR_NAME || "default";
const MAX_TTS_CHARS = Number(process.env.GEMINI_TTS_MAX_CHARS) || 4000;

export const bucketName = process.env.S3_BUCKET || "";
/** Base URL for lesson files (PDFs/videos) stored in S3. Used when processing course lessons for embedding. */
export const LESSON_FILES_BASE_URL =
  process.env.LESSON_FILES_BASE_URL ||
  "https://mslbucketmain.s3.us-east-1.amazonaws.com/";
export const s3 = new S3Client({});

export const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
export const geminiChatModel = genAI.getGenerativeModel({
  model: GEMINI_CHAT_MODEL,
});
export const geminiEmbeddingModel = genAI.getGenerativeModel({
  model: GEMINI_EMBEDDING_MODEL,
});
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export const callGeminiAudioTranscription = async (params: {
  prompt: string;
  mimeType: string;
  dataBase64: string;
}) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const modelName = GEMINI_AUDIO_MODEL.replace(/^models\//, "");
  const url = `${GEMINI_API_BASE}/${modelName}:${GEMINI_AUDIO_METHOD}?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: params.prompt },
          {
            inlineData: {
              mimeType: params.mimeType,
              data: params.dataBase64,
            },
          },
        ],
      },
    ],
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini audio request failed (${response.status}): ${errorText || "Unknown error"}`
    );
  }

  const data: any = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part: any) => part?.text)
    .filter(Boolean)
    .join("");

  return { text, raw: data };
};

export const callGeminiTts = async (params: {
  text: string;
  voiceName?: string;
}) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  let text = (params.text || "").trim();
  if (text.length > MAX_TTS_CHARS) {
    text = `${text.slice(0, MAX_TTS_CHARS).trim()}...`;
  }

  const modelName = GEMINI_TTS_MODEL.replace(/^models\//, "");
  const url = `${GEMINI_API_BASE}/${modelName}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text }],
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: params.voiceName || GEMINI_TTS_VOICE,
          },
        },
      },
    },
  };

  const maxAttempts = 3;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Gemini TTS request failed (${response.status}): ${
            errorText || "Unknown error"
          }`
        );
      }

      const data: any = await response.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const audioPart = parts.find((part: any) => part?.inlineData?.data);
      if (!audioPart) {
        throw new Error("Gemini TTS response did not include audio");
      }

      return {
        mimeType: audioPart.inlineData.mimeType,
        dataBase64: audioPart.inlineData.data,
        raw: data,
      };
    } catch (error: any) {
      lastError = error;
      if (attempt < maxAttempts) {
        const delayMs = 500 * attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
    }
  }

  throw lastError || new Error("Gemini TTS request failed");
};

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL_PROD || process.env.QDRANT_URL || "http://localhost:6333",
  apiKey: process.env.QDRANT_API_KEY_PROD || process.env.QDRANT_API_KEY,
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

/** Download any file from S3 to a buffer (used for video/audio). */
export const downloadFileFromS3 = async (s3Key: string): Promise<Buffer> => {
  const params = { Bucket: bucketName, Key: s3Key };
  const data = await s3.send(new GetObjectCommand(params));
  const body = data.Body as Readable;
  return streamToBuffer(body);
};

const VIDEO_AUDIO_EXT_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".webm_audio": "audio/webm",
};

export const getMimeTypeForS3Key = (s3Key: string): string => {
  const ext = s3Key.toLowerCase().replace(/.*\./, ".");
  return VIDEO_AUDIO_EXT_MIME[ext] || "video/mp4";
};

const MAX_URL_DOWNLOAD_BYTES = 1000 * 1024 * 1024; // 100MB
const URL_DOWNLOAD_TIMEOUT_MS = 120000; // 2 min

/** Download a file from a public URL to a buffer. Throws on failure or if size exceeds limit. */
export const downloadFileFromUrl = async (
  url: string,
  options?: { maxBytes?: number; timeoutMs?: number }
): Promise<Buffer> => {
  const maxBytes = options?.maxBytes ?? MAX_URL_DOWNLOAD_BYTES;
  const timeoutMs = options?.timeoutMs ?? URL_DOWNLOAD_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "MSL-School-AI/1.0" },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      throw new Error(
        `File too large (${contentLength} bytes, max ${maxBytes})`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length > maxBytes) {
      throw new Error(
        `File too large (${buffer.length} bytes, max ${maxBytes})`
      );
    }
    return buffer;
  } finally {
    clearTimeout(timeoutId);
  }
};

const PDF_EXT = ".pdf";
const VIDEO_AUDIO_EXT = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".mp3", ".m4a", ".wav", ".ogg"];

/** Infer source type from URL path (pdf vs video/audio). */
export const inferSourceTypeFromUrl = (url: string): "pdf" | "video" => {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname.endsWith(PDF_EXT)) return "pdf";
    if (VIDEO_AUDIO_EXT.some((ext) => pathname.endsWith(ext))) return "video";
  } catch {
    // invalid URL
  }
  return "video"; // default to video for unknown
};

/** Get mime type for a URL (for video/audio). Uses path extension. */
export const getMimeTypeForUrl = (url: string): string => {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const ext = pathname.replace(/.*\./, ".") || "";
    if (ext === PDF_EXT) return "application/pdf";
    return VIDEO_AUDIO_EXT_MIME[ext] || "video/mp4";
  } catch {
    return "video/mp4";
  }
};

/** Extract a short filename from URL for display. */
export const getFileNameFromUrl = (url: string): string => {
  try {
    const pathname = new URL(url).pathname;
    const name = path.basename(pathname) || "document";
    return decodeURIComponent(name);
  } catch {
    return "document";
  }
};

const TRANSCRIPT_PROMPT =
  "Provide a full transcript of the speech in this audio or video. Output only the transcript text, no timestamps or speaker labels. If there is no speech, output a brief description of any sounds or silence.";

/** When video buffer exceeds this size (bytes), we split into time segments to stay under Gemini context. */
export const VIDEO_SEGMENT_THRESHOLD_BYTES =
  Number(process.env.VIDEO_SEGMENT_THRESHOLD_BYTES) || 80 * 1024 * 1024; // 80MB
/** Duration in seconds of each segment when splitting long videos (keeps each under ~1M tokens). */
export const VIDEO_SEGMENT_DURATION_SEC =
  Number(process.env.VIDEO_SEGMENT_DURATION_SEC) || 600; // 10 min

const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
};

/** Split a video buffer into time-based segments using FFmpeg. Returns array of segment buffers. Requires ffmpeg on PATH. */
export function splitVideoIntoTimeSegments(
  buffer: Buffer,
  mimeType: string,
  segmentDurationSec: number = VIDEO_SEGMENT_DURATION_SEC
): Buffer[] {
  const ext = MIME_TO_EXT[mimeType] || ".mp4";
  const tmpDir = path.join(os.tmpdir(), `gemini-segments-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
  const inputPath = path.join(tmpDir, `input${ext}`);
  const segmentPattern = path.join(tmpDir, "seg_%03d" + ext);

  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(inputPath, buffer);

    execSync(
      `ffmpeg -i "${inputPath}" -f segment -segment_time ${segmentDurationSec} -c copy -reset_timestamps 1 -map 0 "${segmentPattern}"`,
      { stdio: "pipe", timeout: 600000 }
    );

    const names = fs.readdirSync(tmpDir).filter((n) => n.startsWith("seg_") && n.endsWith(ext));
    names.sort();
    const segments = names.map((n) => fs.readFileSync(path.join(tmpDir, n)));
    return segments;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

/** Transcribe a single video/audio buffer (one segment). Used internally. */
async function transcribeOneSegmentWithGemini(
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  const fileManager = new GoogleAIFileManager(apiKey);
  const uploadResponse = await fileManager.uploadFile(buffer, {
    mimeType,
    displayName: `transcript_${Date.now()}`,
  });
  const file = uploadResponse.file;
  if (!file?.uri) {
    throw new Error("Gemini file upload did not return a URI");
  }
  const maxWaitMs = 120000;
  const pollIntervalMs = 2000;
  let elapsed = 0;
  while (elapsed < maxWaitMs) {
    const meta = await fileManager.getFile(file.name);
    const state = (meta as { state?: string })?.state;
    if (state === "ACTIVE") break;
    if (state === "FAILED") {
      throw new Error(
        "Gemini file processing failed: " +
          (meta as { error?: { message?: string } })?.error?.message
      );
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    elapsed += pollIntervalMs;
  }
  if (elapsed >= maxWaitMs) {
    throw new Error("Gemini file processing timed out");
  }
  const completion = await geminiChatModel.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { fileData: { fileUri: file.uri, mimeType: file.mimeType } },
          { text: TRANSCRIPT_PROMPT },
        ],
      },
    ],
  });
  const response = completion.response;
  const text = response.text();
  return text.replace(/\s+/g, " ").trim();
}

/** Transcribe video/audio using Gemini File API + generateContent. For long videos, splits by time and transcribes each segment. Returns plain text transcript. */
export const transcribeVideoWithGemini = async (
  buffer: Buffer,
  mimeType: string
): Promise<string> => {
  if (buffer.length <= VIDEO_SEGMENT_THRESHOLD_BYTES) {
    return transcribeOneSegmentWithGemini(buffer, mimeType);
  }

  let segments: Buffer[];
  try {
    segments = splitVideoIntoTimeSegments(buffer, mimeType);
  } catch (err: any) {
    throw new Error(
      `Long video requires FFmpeg to split into segments. Install ffmpeg and ensure it is on PATH. Original error: ${err?.message ?? err}`
    );
  }

  if (segments.length === 0) {
    throw new Error("FFmpeg produced no segments");
  }

  const parts: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) {
      await new Promise((r) => setTimeout(r, 2000));
    }
    const text = await transcribeOneSegmentWithGemini(segments[i], mimeType);
    if (text && text.trim()) parts.push(text.trim());
  }
  return parts.join("\n\n").replace(/\s+/g, " ").trim();
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

type VectorFormat =
  | { type: "unnamed" }
  | { type: "named"; name: string };

let cachedVectorFormatByCollection = new Map<string, VectorFormat>();

const resolveVectorFormatFromConfig = (vectors: any): VectorFormat | null => {
  if (!vectors) return null;

  if (
    typeof vectors.size === "number" &&
    typeof vectors.distance === "string"
  ) {
    return { type: "unnamed" };
  }

  if (typeof vectors === "object") {
    const vectorNames = Object.keys(vectors);
    if (vectorNames.length > 0) {
      if (vectorNames.includes(QDRANT_VECTOR_NAME)) {
        return { type: "named", name: QDRANT_VECTOR_NAME };
      }
      return { type: "named", name: vectorNames[0] };
    }
  }

  return null;
};

export const resolveVectorFormat = async (
  collectionName: string = COLLECTION_NAME
): Promise<VectorFormat> => {
  const cached = cachedVectorFormatByCollection.get(collectionName);
  if (cached) return cached;

  try {
    const collectionInfo = (await qdrant.getCollection(collectionName)) as any;
    const vectors = collectionInfo?.config?.params?.vectors;
    const sparseVectors = collectionInfo?.config?.params?.sparse_vectors;

    const resolved = resolveVectorFormatFromConfig(vectors);
    if (resolved) {
      cachedVectorFormatByCollection.set(collectionName, resolved);
      return resolved;
    }

    if (!vectors && sparseVectors) {
      throw new Error(
        "Gemini collection has only sparse vectors. Recreate collection with dense vectors."
      );
    }
  } catch (error: any) {
    if (
      error?.status === 404 ||
      error?.statusText === "Not Found" ||
      error?.message?.includes("Not found")
    ) {
      // Collection doesn't exist yet; use default named vector for creation.
    } else if (error?.message) {
      throw error;
    }
  }

  const fallback: VectorFormat = { type: "named", name: QDRANT_VECTOR_NAME };
  cachedVectorFormatByCollection.set(collectionName, fallback);
  return fallback;
};

export const buildSearchVector = (
  vector: number[],
  format: VectorFormat
) => {
  if (format.type === "unnamed") return vector;
  return { name: format.name, vector };
};

export const buildPointVector = (
  vector: number[],
  format: VectorFormat
) => {
  if (format.type === "unnamed") return vector;
  return { [format.name]: vector };
};

export const buildCollectionVectorConfig = (): any => ({
  [QDRANT_VECTOR_NAME]: {
    size: GEMINI_EMBEDDING_DIMENSIONS,
    distance: "Cosine",
  },
});

/** Payload keys used in filters; must have keyword indexes in Qdrant. */
const PAYLOAD_INDEX_KEYS = [
  "sourceType",
  "courseId",
  "courseIds",
  "lessonId",
  "s3Key",
  "pdfKey",
  "resourceId",
] as const;

/**
 * Ensure keyword payload indexes exist for the Gemini collection so filter queries (courseId, lessonId, s3Key, pdfKey) work.
 * Idempotent: safe to call multiple times; ignores "already exists" errors.
 */
export const ensureQdrantCollection = async (
  collectionName: string = COLLECTION_NAME
): Promise<void> => {
  try {
    await qdrant.createCollection(collectionName, {
      vectors: buildCollectionVectorConfig(),
    });
  } catch (error: any) {
    if (
      error.status === 409 ||
      error.message?.includes("already exists") ||
      error.data?.status?.error?.includes("already exists")
    ) {
      return;
    }
    throw error;
  }
};

export const ensurePayloadIndexesForGeminiCollection = async (
  collectionName: string = COLLECTION_NAME
): Promise<void> => {
  for (const fieldName of PAYLOAD_INDEX_KEYS) {
    try {
      await qdrant.createPayloadIndex(collectionName, {
        field_name: fieldName,
        field_schema: "keyword",
        wait: true,
      });
    } catch (err: any) {
      const msg = err?.data?.status?.error ?? err?.message ?? "";
      if (
        msg.includes("already exists") ||
        msg.includes("AlreadyExists") ||
        err?.status === 409
      ) {
        continue;
      }
      throw err;
    }
  }
};

export const embedText = async (text: string) => {
  const request = {
    content: { role: "user", parts: [{ text }] },
    ...(GEMINI_EMBEDDING_MODEL === "gemini-embedding-001" && {
      outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS,
    }),
  };
  const result = await geminiEmbeddingModel.embedContent(
    request as Parameters<typeof geminiEmbeddingModel.embedContent>[0]
  );
  return result.embedding.values;
};

/** Align client/API paths with keys stored during lesson processing. */
export function normalizeStorageKey(key: string): string {
  let k = (key || "").trim().replace(/\\/g, "/").replace(/^\//, "");
  k = k.replace(/^public\/res\/lesson\/?/i, "");
  k = k.replace(/^public\/res\//i, "");
  return k;
}

function normalizeScrollOffset(next: unknown): string | number | null {
  if (next === undefined || next === null) return null;
  if (typeof next === "string" || typeof next === "number") return next;
  if (typeof next === "object") {
    const record = next as Record<string, unknown>;
    if (typeof record.uuid === "string") return record.uuid;
    if (typeof record.num === "number") return record.num;
  }
  return null;
}

async function scrollFilteredPoints(
  filter: Record<string, unknown> | undefined,
  collectionName: string = COLLECTION_NAME
): Promise<{ payload?: { text?: string; s3Key?: string; pdfKey?: string; chunkIndex?: number } }[]> {
  const points: { payload?: { text?: string; s3Key?: string; pdfKey?: string; chunkIndex?: number } }[] = [];
  let offset: string | number | null | undefined = undefined;
  const limit = 100;
  while (true) {
    const scrollRes = await qdrant.scroll(collectionName, {
      limit,
      offset,
      with_payload: true,
      with_vector: false,
      ...(filter && { filter: filter as any }),
    });
    points.push(...(scrollRes.points || []));
    offset = normalizeScrollOffset(scrollRes.next_page_offset);
    if (offset == null) break;
  }
  return points;
}

async function lessonIdsForCourse(courseId: string): Promise<string[]> {
  if (!mongoose.Types.ObjectId.isValid(courseId)) return [];
  const oid = new mongoose.Types.ObjectId(courseId);
  const lessons = await Lesson.find({
    $or: [{ course: oid }, { "linkedCourses.course": oid }],
  })
    .select("_id")
    .lean();
  return lessons.map((l) => String((l as { _id: mongoose.Types.ObjectId })._id));
}

/** Build Qdrant filter for scoped content (s3Keys, courseId, lessonId). PDF points use pdfKey; video points use s3Key. */
export const buildContentFilter = (options: {
  s3Keys?: string[];
  courseId?: string;
  lessonId?: string;
  resourceId?: string;
}): Record<string, unknown> | undefined => {
  const must: Record<string, unknown>[] = [];
  const courseId = options.courseId ? String(options.courseId).trim() : undefined;
  const lessonId = options.lessonId ? String(options.lessonId).trim() : undefined;
  const resourceId = options.resourceId
    ? String(options.resourceId).trim()
    : undefined;
  const s3Keys = options.s3Keys?.length
    ? options.s3Keys.map((k) => normalizeStorageKey(k)).filter(Boolean)
    : undefined;

  // Only narrow by file when a lesson (or file-only scope) is explicitly targeted.
  const useS3Keys = Boolean(s3Keys?.length && (lessonId || resourceId || !courseId));

  if (useS3Keys && s3Keys) {
    must.push({
      should: [
        { key: "s3Key", match: { any: s3Keys } },
        { key: "pdfKey", match: { any: s3Keys } },
      ],
    });
  }
  if (courseId) {
    must.push({
      should: [
        { key: "courseId", match: { value: courseId } },
        { key: "courseIds", match: { any: [courseId] } },
      ],
    });
  }
  if (lessonId) {
    must.push({ key: "lessonId", match: { value: lessonId } });
  }
  if (resourceId) {
    must.push({ key: "resourceId", match: { value: resourceId } });
  }
  if (must.length === 0) return undefined;
  return { must };
};

// const MAX_CONTEXT_TOKENS = 30000;
const MAX_CONTEXT_TOKENS = 10000;

/** Retrieve concatenated text from Qdrant for the given filter (e.g. by s3Keys). Ordered by (s3Key/pdfKey, chunkIndex). */
export type AiCollectionSearchTarget = {
  name: string;
  filter?: Record<string, unknown>;
};

export const searchAiCollections = async (options: {
  collections: AiCollectionSearchTarget[];
  embeddingVector: number[];
  limit?: number;
}): Promise<Array<{ payload?: any; score?: number }>> => {
  const limit = options.limit ?? 5;
  const perCollection = Math.max(limit, 5);

  const results = await Promise.all(
    options.collections.map(async (collection) => {
      await ensureQdrantCollection(collection.name);
      await ensurePayloadIndexesForGeminiCollection(collection.name);
      const vectorFormat = await resolveVectorFormat(collection.name);
      const vector = buildSearchVector(options.embeddingVector, vectorFormat);
      return qdrant.search(collection.name, {
        vector,
        limit: perCollection,
        ...(collection.filter && { filter: collection.filter as any }),
      });
    })
  );

  return results
    .flat()
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, limit);
};

export const getContextFromQdrant = async (options: {
  s3Keys?: string[];
  courseId?: string;
  lessonId?: string;
  resourceId?: string;
  maxTokens?: number;
  collections?: string[];
}): Promise<string> => {
  const scoped = {
    s3Keys: options.s3Keys,
    courseId: options.courseId ? String(options.courseId).trim() : undefined,
    lessonId: options.lessonId ? String(options.lessonId).trim() : undefined,
    resourceId: options.resourceId ? String(options.resourceId).trim() : undefined,
  };
  const collections =
    options.collections && options.collections.length > 0
      ? options.collections
      : [COLLECTION_NAME];

  let filter = buildContentFilter(scoped);
  const points: {
    payload?: { text?: string; s3Key?: string; pdfKey?: string; chunkIndex?: number };
  }[] = [];

  for (const collectionName of collections) {
    if (filter) await ensurePayloadIndexesForGeminiCollection(collectionName);
    let collectionPoints = await scrollFilteredPoints(filter, collectionName);

    if (
      collectionPoints.length === 0 &&
      scoped.lessonId &&
      scoped.s3Keys?.length
    ) {
      const lessonFilter = buildContentFilter({
        courseId: scoped.courseId,
        lessonId: scoped.lessonId,
      });
      collectionPoints = await scrollFilteredPoints(lessonFilter, collectionName);
    }

    if (
      collectionPoints.length === 0 &&
      scoped.courseId &&
      !scoped.lessonId &&
      collectionName === COLLECTION_NAME
    ) {
      const lessonIds = await lessonIdsForCourse(scoped.courseId);
      if (lessonIds.length > 0) {
        const lessonIdFilter = {
          must: [{ key: "lessonId", match: { any: lessonIds } }],
        };
        collectionPoints = await scrollFilteredPoints(
          lessonIdFilter,
          collectionName
        );
      }
    }

    points.push(...collectionPoints);
  }

  const maxTokens = options.maxTokens ?? MAX_CONTEXT_TOKENS;
  const byKey = (p: (typeof points)[0]) =>
    (p.payload?.s3Key ?? p.payload?.pdfKey ?? "") + "_" + (p.payload?.chunkIndex ?? 0);
  points.sort((a, b) => byKey(a).localeCompare(byKey(b)));
  let totalTokens = 0;
  const parts: string[] = [];
  for (const p of points) {
    const text = p.payload?.text;
    if (!text) continue;
    const tokens = estimateTokens(text);
    if (totalTokens + tokens > maxTokens) break;
    parts.push(text);
    totalTokens += tokens;
  }
  return parts.join("\n\n");
};

// export const checkAiLimits = async (studentId: string) => {
//   try {
//     const user = await User.findById(studentId);
//     if (!user) {
//       return {
//         allowed: false,
//         reason: "User not found",
//       };
//     }

//     let globalLimits = await GlobalAiLimit.findOne({});
//     if (!globalLimits) {
//       globalLimits = await GlobalAiLimit.create({
//         dailyLimit: 10,
//         monthlyLimit: 100,
//         description: "Default global AI limits",
//       });
//     }

//     const dailyLimit = user.ai_limit?.dailyLimit || globalLimits.dailyLimit;
//     const monthlyLimit =
//       user.ai_limit?.monthlyLimit || globalLimits.monthlyLimit;

//     if (user.ai_limit && user.ai_limit.isActive === false) {
//       return {
//         allowed: false,
//         reason: "AI access is disabled for this user",
//       };
//     }

//     const today = new Date();
//     today.setHours(0, 0, 0, 0);
//     const tomorrow = new Date(today);
//     tomorrow.setDate(tomorrow.getDate() + 1);

//     const dailyUsage = await AiUsage.countDocuments({
//       student: studentId,
//       createdAt: {
//         $gte: today,
//         $lt: tomorrow,
//       },
//     });

//     if (dailyUsage >= dailyLimit) {
//       return {
//         allowed: false,
//         reason: `Daily limit of ${dailyLimit} queries exceeded`,
//         dailyUsage,
//         dailyLimit,
//       };
//     }

//     const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
//     const endOfMonth = new Date(
//       today.getFullYear(),
//       today.getMonth() + 1,
//       0,
//       23,
//       59,
//       59,
//       999
//     );

//     const monthlyUsage = await AiUsage.countDocuments({
//       student: studentId,
//       createdAt: {
//         $gte: startOfMonth,
//         $lte: endOfMonth,
//       },
//     });

//     if (monthlyUsage >= monthlyLimit) {
//       return {
//         allowed: false,
//         reason: `Monthly limit of ${monthlyLimit} queries exceeded`,
//         monthlyUsage,
//         monthlyLimit,
//       };
//     }

//     return {
//       allowed: true,
//       dailyUsage,
//       dailyLimit,
//       monthlyUsage,
//       monthlyLimit,
//       remainingDaily: dailyLimit - dailyUsage,
//       remainingMonthly: monthlyLimit - monthlyUsage,
//     };
//   } catch (error) {
//     return {
//       allowed: false,
//       reason: "Error checking limits",
//     };
//   }
// };



export const checkAiLimits = async (studentId: string) => {
  try {
    const user = await User.findById(studentId);
    if (!user) {
      return {
        allowed: false,
        reason: "User not found",
      };
    }

    if (user.ai_limit && user.ai_limit.isActive === false) {
      return {
        allowed: false,
        reason: "AI access is disabled for this user",
      };
    }

    // Use findOneAndUpdate with upsert to avoid race conditions
    // if checkAiLimits is ever called concurrently before a doc exists
    const globalLimits = await GlobalAiLimit.findOneAndUpdate(
      {},
      {
        $setOnInsert: {
          dailyLimit: 10,
          monthlyLimit: 100,
          description: "Default global AI limits",
        },
      },
      { upsert: true, new: true }
    );

    const dailyLimit = user.ai_limit?.dailyLimit || globalLimits.dailyLimit;
    const monthlyLimit =
      user.ai_limit?.monthlyLimit || globalLimits.monthlyLimit;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfNextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    // Run both counts in parallel instead of sequentially
    const [dailyUsage, monthlyUsage] = await Promise.all([
      AiUsage.countDocuments({
        student: studentId,
        createdAt: { $gte: today, $lt: tomorrow },
      }),
      AiUsage.countDocuments({
        student: studentId,
        createdAt: { $gte: startOfMonth, $lt: startOfNextMonth },
      }),
    ]);

    if (dailyUsage >= dailyLimit) {
      return {
        allowed: false,
        reason: `Daily limit of ${dailyLimit} queries exceeded`,
        dailyUsage,
        dailyLimit,
      };
    }

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

export const checkSubscriptionAiLimits = async (studentId: string) => {
  try {
    const user = await User.findById(studentId);
    if (!user) {
      return {
        allowed: false,
        reason: "User not found",
      };
    }

    if (user.ai_limit && user.ai_limit.isActive === false) {
      return {
        allowed: false,
        reason: "AI access is disabled for this user",
      };
    }

    const plan = await SubscriptionPlan.findOneAndUpdate(
      {},
      {
        $setOnInsert: {
          amount: 0,
          currency: "NGN",
          intervalDays: 30,
          gracePeriodDays: 7,
          reminderDaysBeforeExpiry: 3,
          dailyAiLimit: 10,
          monthlyAiLimit: 100,
          isActive: false,
          description:
            "Monthly AI subscription for users without course enrollment",
        },
      },
      { upsert: true, new: true }
    );

    const dailyLimit = plan.dailyAiLimit;
    const monthlyLimit = plan.monthlyAiLimit;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfNextMonth = new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      1
    );

    const usageFilter = {
      student: studentId,
      source: "subscription",
    };

    const [dailyUsage, monthlyUsage] = await Promise.all([
      AiUsage.countDocuments({
        ...usageFilter,
        createdAt: { $gte: today, $lt: tomorrow },
      }),
      AiUsage.countDocuments({
        ...usageFilter,
        createdAt: { $gte: startOfMonth, $lt: startOfNextMonth },
      }),
    ]);

    if (dailyUsage >= dailyLimit) {
      return {
        allowed: false,
        reason: `Subscription daily limit of ${dailyLimit} queries exceeded`,
        dailyUsage,
        dailyLimit,
        monthlyUsage,
        monthlyLimit,
      };
    }

    if (monthlyUsage >= monthlyLimit) {
      return {
        allowed: false,
        reason: `Subscription monthly limit of ${monthlyLimit} queries exceeded`,
        dailyUsage,
        dailyLimit,
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
      reason: "Error checking subscription AI limits",
    };
  }
};