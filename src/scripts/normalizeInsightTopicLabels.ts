/**
 * Rewrite stored PastQuestionInsight topic labels to syllabus leaf form:
 * - strip "Parent > Child" breadcrumbs
 * - expand bare IAS/IFRS/IPSAS codes via standardTitles / catalog
 * - map aliases (e.g. "Tax digitalisation") to canonical syllabus labels
 *
 * Usage from API-MONGODB:
 *   npx ts-node src/scripts/normalizeInsightTopicLabels.ts
 */
import * as dotenv from "dotenv";
import mongoose from "mongoose";
import PastQuestionInsight from "../Features/pastQuestion/schema/pastQuestionInsight.schema";
import {
  leafTopicLabel,
  normalizeInsightDocument,
} from "../Features/pastQuestion/controllers/pastQuestion.service";

dotenv.config();

const topicKey = (row: any) => {
  if (row == null) return "";
  if (typeof row === "string") return leafTopicLabel(row);
  return leafTopicLabel(row.topic || row.label || "");
};

const topicsChanged = (before: unknown[], after: unknown[]) => {
  const a = (before || []).map(topicKey);
  const b = (after || []).map(topicKey);
  if (a.length !== b.length) return true;
  return a.some((value, index) => value !== b[index]);
};

const run = async () => {
  if (!process.env.DB_URL) throw new Error("DB_URL is not set.");
  await mongoose.connect(process.env.DB_URL);

  const cursor = PastQuestionInsight.find({}).cursor();
  let scanned = 0;
  let updated = 0;
  const samples: string[] = [];

  for await (const doc of cursor) {
    scanned += 1;
    const before = (doc.topics || []).map(topicKey);
    const normalized = normalizeInsightDocument(doc);
    if (!topicsChanged(doc.topics || [], normalized.topics || [])) continue;

    doc.topics = normalized.topics;
    await doc.save();
    updated += 1;

    const after = (normalized.topics || []).map(topicKey);
    const diffs = before
      .map((value, index) => (value !== after[index] ? `${value} → ${after[index]}` : null))
      .filter(Boolean) as string[];
    console.log(
      `updated ${doc._id} scope=${doc.scope} paper=${doc.paperCode || "-"} changes=${diffs.length}`
    );
    for (const diff of diffs.slice(0, 6)) {
      if (samples.length < 24) samples.push(diff);
      console.log(`  ${diff}`);
    }
  }

  console.log(`done. scanned=${scanned} updated=${updated}`);
  if (samples.length) {
    console.log("sample rewrites:");
    for (const sample of samples) console.log(`  ${sample}`);
  }
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
