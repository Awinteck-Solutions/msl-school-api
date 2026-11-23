import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import mongoose from "mongoose";
import AiVoice from "../schema/aiVoice.schema";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const PREBUILT_NAME = /^[A-Za-z][A-Za-z0-9 ._-]{1,40}$/;

export type VoiceRecord = {
  _id: string;
  name: string;
  geminiVoice: string;
  kind: "replicated" | "prebuilt";
  enabled: boolean;
  isDefault: boolean;
  createdAt?: Date;
  updatedAt?: Date;
};

function apiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");
  return key;
}

function publicVoice(voice: any) {
  return {
    _id: voice._id,
    name: voice.name,
    isDefault: Boolean(voice.isDefault),
  };
}

function adminVoice(voice: any): VoiceRecord {
  return {
    _id: String(voice._id),
    name: voice.name,
    geminiVoice: voice.geminiVoice,
    kind: voice.kind,
    enabled: Boolean(voice.enabled),
    isDefault: Boolean(voice.isDefault),
    createdAt: voice.createdAt,
    updatedAt: voice.updatedAt,
  };
}

async function clearOtherDefaults(exceptId?: string) {
  const filter: Record<string, unknown> = { isDefault: true };
  if (exceptId && mongoose.isValidObjectId(exceptId)) {
    filter._id = { $ne: exceptId };
  }
  await AiVoice.updateMany(filter, { $set: { isDefault: false } });
}

export async function listAdminVoices() {
  const voices = await AiVoice.find().sort({ isDefault: -1, name: 1 }).lean();
  return voices.map(adminVoice);
}

export async function listEnabledVoices() {
  const voices = await AiVoice.find({ enabled: true }).sort({ isDefault: -1, name: 1 }).lean();
  return voices.map(publicVoice);
}

export async function resolveTtsVoice(voiceId?: string, voiceName?: string) {
  const enabled = await AiVoice.find({ enabled: true }).lean();
  if (voiceId && mongoose.isValidObjectId(voiceId)) {
    const match = enabled.find((voice) => String(voice._id) === String(voiceId));
    if (match?.geminiVoice) return match.geminiVoice;
  }
  const requested = String(voiceName || "").trim();
  if (requested) {
    const match = enabled.find(
      (voice) =>
        String(voice.name).toLowerCase() === requested.toLowerCase() ||
        voice.geminiVoice === requested
    );
    if (match?.geminiVoice) return match.geminiVoice;
  }
  const fallback = enabled.find((voice) => voice.isDefault) || enabled[0];
  if (fallback?.geminiVoice) return fallback.geminiVoice;
  return process.env.GEMINI_TTS_VOICE || "Aoede";
}

export async function createPrebuiltVoice(input: { name?: string; geminiVoice?: string }) {
  const name = String(input.name || "").trim();
  const geminiVoice = String(input.geminiVoice || "").trim();
  if (!name) throw new Error("Enter a display name");
  if (!PREBUILT_NAME.test(geminiVoice) || geminiVoice.startsWith("voice_") || geminiVoice.startsWith("voicekey_")) {
    throw new Error("Enter a prebuilt Gemini voice name, such as Aoede");
  }
  const existingDefault = await AiVoice.exists({ isDefault: true });
  const voice = await AiVoice.create({
    name,
    geminiVoice,
    kind: "prebuilt",
    enabled: true,
    isDefault: !existingDefault,
  });
  return adminVoice(voice.toObject());
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error("ffmpeg is not installed on the server, so the recording cannot be converted"));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
    });
  });
}

async function toSpeechWav(input: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "msl-voice-"));
  const source = join(dir, "source");
  const dest = join(dir, "voice.wav");
  try {
    await writeFile(source, input);
    await runFfmpeg([
      "-y",
      "-i",
      source,
      "-ac",
      "1",
      "-ar",
      "24000",
      "-sample_fmt",
      "s16",
      "-c:a",
      "pcm_s16le",
      dest,
    ]);
    return await readFile(dest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function createGeminiVoice(name: string, sourceWav: Buffer, consentWav: Buffer) {
  const response = await fetch(`${GEMINI_API_BASE}/voices?key=${apiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      store: true,
      voice: {
        type: "replicated",
        display_name: name,
        replicated: {
          source_audio: { mime_type: "audio/wav", data: sourceWav.toString("base64") },
          consent_audio: { mime_type: "audio/wav", data: consentWav.toString("base64") },
        },
      },
    }),
  });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Gemini voice creation failed (${response.status})`;
    throw new Error(message);
  }
  const id = data?.id || data?.voice?.id || data?.name;
  if (!id || typeof id !== "string") {
    throw new Error("Gemini did not return a voice id");
  }
  return id.replace(/^voices\//, "");
}

async function deleteGeminiVoice(geminiVoice: string) {
  if (!geminiVoice.startsWith("voice_")) return;
  const response = await fetch(
    `${GEMINI_API_BASE}/voices/${encodeURIComponent(geminiVoice)}?key=${apiKey()}`,
    { method: "DELETE" }
  );
  if (response.ok || response.status === 404) return;
  const data: any = await response.json().catch(() => ({}));
  throw new Error(data?.error?.message || `Could not delete the Gemini voice (${response.status})`);
}

export async function createReplicatedVoice(input: {
  name?: string;
  source: Buffer;
  consent: Buffer;
}) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Enter a display name");
  if (!input.source?.length || !input.consent?.length) {
    throw new Error("Upload both the voice recording and the consent recording");
  }
  const [sourceWav, consentWav] = await Promise.all([
    toSpeechWav(input.source),
    toSpeechWav(input.consent),
  ]);
  const geminiVoice = await createGeminiVoice(name, sourceWav, consentWav);
  const existingDefault = await AiVoice.exists({ isDefault: true });
  try {
    const voice = await AiVoice.create({
      name,
      geminiVoice,
      kind: "replicated",
      enabled: true,
      isDefault: !existingDefault,
    });
    return adminVoice(voice.toObject());
  } catch (error) {
    await deleteGeminiVoice(geminiVoice).catch(() => {});
    throw error;
  }
}

export async function updateVoice(
  id: string,
  input: { name?: string; enabled?: boolean; isDefault?: boolean }
) {
  if (!mongoose.isValidObjectId(id)) throw new Error("Voice not found");
  const voice = await AiVoice.findById(id);
  if (!voice) throw new Error("Voice not found");
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new Error("Enter a display name");
    voice.name = name;
  }
  if (typeof input.enabled === "boolean") voice.enabled = input.enabled;
  if (input.isDefault) {
    await clearOtherDefaults(String(voice._id));
    voice.isDefault = true;
    voice.enabled = true;
  } else if (input.isDefault === false) {
    voice.isDefault = false;
  }
  await voice.save();
  return adminVoice(voice.toObject());
}

export async function deleteVoice(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new Error("Voice not found");
  const voice = await AiVoice.findById(id);
  if (!voice) throw new Error("Voice not found");
  if (voice.kind === "replicated") {
    await deleteGeminiVoice(voice.geminiVoice);
  }
  const wasDefault = voice.isDefault;
  await voice.deleteOne();
  if (wasDefault) {
    const next = await AiVoice.findOne({ enabled: true }).sort({ name: 1 });
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }
}
