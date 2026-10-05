/**
 * Map Principles of Taxation insight topics onto official syllabus sections (A–I).
 */
import * as dotenv from "dotenv";
import mongoose from "mongoose";
import PastQuestionInsight from "../Features/pastQuestion/schema/pastQuestionInsight.schema";
import { normalizeInsightDocument } from "../Features/pastQuestion/controllers/pastQuestion.service";

dotenv.config();

const SECTION = {
  A: "(A) Ghanaian tax system and fiscal policy",
  B: "(B) Tax administration",
  C: "(C) Income tax liabilities",
  D: "(D) Corporate tax liabilities",
  E: "(E) Taxation of capital gains",
  F: "(F) Value-added tax, customs and excise duties",
  G: "(G) Withholding tax administration",
  H: "(H) Application of information technology in taxation",
  I: "(I) Ethical issues in tax practice",
} as const;

const forceSection = (topic: string) => {
  if (/^\([A-I]\)\s/.test(topic)) return topic;
  const l = topic.toLowerCase();
  if (/\bvat\b|value[ -]?added|customs|excise|nhil|getf|duty drawback|bonded/.test(l)) return SECTION.F;
  if (/withholding/.test(l)) return SECTION.G;
  if (/capital gain|gift tax|realisation|realization/.test(l)) return SECTION.E;
  if (/digital|e-audit|e-invoic|tax technology|blockchain|mobile money|data analytics/.test(l)) {
    return SECTION.H;
  }
  if (/ethic|money laundering|professional sceptic|professional skeptic/.test(l)) return SECTION.I;
  if (
    /capital allowance|company tax|corporate tax|chargeable income \(corporate|deemed dividend|branch profit|business deduction/.test(
      l
    )
  ) {
    return SECTION.D;
  }
  if (
    /employment|personal income|individual income|partnership|pension|overtime|bonus payment|relief|basis period|year of assessment/.test(
      l
    )
  ) {
    return SECTION.C;
  }
  if (
    /tax administration|tax clearance|objection|commissioner|tin\b|penalt|assessment notice|tax credit certificate|practice note|private ruling/.test(
      l
    )
  ) {
    return SECTION.B;
  }
  if (
    /fiscal|monetary policy|canons|classification of tax|public debt|budget deficit|purposes of taxation|ghanaian tax system/.test(
      l
    )
  ) {
    return SECTION.A;
  }
  return topic;
};

const isPotDoc = (doc: any) => {
  const code = String(doc.paperCode || "");
  const title = String(doc.title || "");
  return code === "2.6" || /principles of tax/i.test(code) || /principles of tax/i.test(title);
};

const run = async () => {
  if (!process.env.DB_URL) throw new Error("DB_URL is not set.");
  await mongoose.connect(process.env.DB_URL);

  const docs = await PastQuestionInsight.find({});
  let updated = 0;
  const leftover = new Map<string, number>();

  for (const doc of docs) {
    if (!isPotDoc(doc)) continue;
    const normalized = normalizeInsightDocument(doc);
    const forced = (normalized.topics || []).map((row: any) => {
      const topic = forceSection(String(row.topic || ""));
      return { ...row, topic };
    });

    for (const row of forced) {
      if (!/^\([A-I]\)\s/.test(row.topic)) {
        leftover.set(row.topic, (leftover.get(row.topic) || 0) + 1);
      }
    }

    const before = (doc.topics || []).map((row: any) => row.topic);
    const after = forced.map((row: any) => row.topic);
    const same = before.length === after.length && before.every((value, index) => value === after[index]);
    if (same) continue;

    doc.topics = forced;
    await doc.save();
    updated += 1;
  }

  console.log(`updated=${updated}`);
  console.log(`leftover non-section topics=${leftover.size}`);
  [...leftover.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .forEach(([topic, count]) => console.log(String(count).padStart(4), topic));

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
