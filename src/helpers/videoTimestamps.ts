const mongoose = require("mongoose");

const VIDEO_SLOT = /^video(\d+)?$/;

export const videoTimestampSchema = new mongoose.Schema(
  {
    slot: { type: String, required: true },
    seconds: { type: Number, required: true, min: 0 },
    text: { type: String, required: true, trim: true, maxlength: 240 },
  },
  { _id: false }
);

export type VideoTimestamp = {
  slot: string;
  seconds: number;
  text: string;
};

/** Keep well-formed markers and drop the rest. An array (including empty) is valid. */
export const sanitizeVideoTimestamps = (
  input: unknown
): VideoTimestamp[] | null => {
  if (!Array.isArray(input)) return null;
  const rows: VideoTimestamp[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const slot = String((raw as { slot?: unknown }).slot || "").trim();
    const text = String(
      (raw as { text?: unknown; label?: unknown }).text ||
        (raw as { label?: unknown }).label ||
        ""
    ).trim();
    const seconds = Number((raw as { seconds?: unknown }).seconds);
    if (!VIDEO_SLOT.test(slot)) continue;
    if (!text || !Number.isFinite(seconds) || seconds < 0 || seconds > 60 * 60 * 24) {
      continue;
    }
    rows.push({
      slot,
      seconds: Math.floor(seconds),
      text: text.slice(0, 240),
    });
  }
  rows.sort((a, b) => a.seconds - b.seconds || a.text.localeCompare(b.text));
  return rows;
};
