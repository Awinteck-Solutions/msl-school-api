/**
 * Reclassify every past-question paper from question text onto syllabus topics,
 * then rebuild course-scope topic aggregates.
 *
 * Usage:
 *   npx ts-node src/scripts/rematchAllQuestionTopics.ts
 */
import * as dotenv from "dotenv";
import mongoose from "mongoose";
import {
  classifyQuestionTopics,
  leafTopicLabel,
  rebuildPaperInsightTopics,
} from "../Features/pastQuestion/controllers/pastQuestion.service";
import { PastQuestionInsightScope } from "../Features/pastQuestion/enums/pastQuestion.enum";
import PastQuestionInsight from "../Features/pastQuestion/schema/pastQuestionInsight.schema";
import PastQuestionItem from "../Features/pastQuestion/schema/pastQuestionItem.schema";
import PastQuestionPaper from "../Features/pastQuestion/schema/pastQuestionPaper.schema";

dotenv.config();

const courseKey = (paper: any) => ({
  level: paper.level,
  paperCode: paper.paperCode,
  title: paper.title,
});

const run = async () => {
  if (!process.env.DB_URL) throw new Error("DB_URL is not set.");
  await mongoose.connect(process.env.DB_URL);

  const papers = await PastQuestionPaper.find({}).sort({ year: -1, sitting: 1 }).lean();
  console.log(`papers=${papers.length}`);

  let updated = 0;
  let classifiedQuestions = 0;
  let unmatchedQuestions = 0;
  const samples: string[] = [];

  for (const paper of papers) {
    const items = await PastQuestionItem.find({ paper: paper._id }).sort({ order: 1 }).lean();
    const topics = classifyQuestionTopics(items, paper);
    const matchedNums = new Set(topics.flatMap((row: any) => row.questionNumbers || []));
    classifiedQuestions += matchedNums.size;
    unmatchedQuestions += Math.max(0, items.length - matchedNums.size);

    await PastQuestionInsight.findOneAndUpdate(
      { scope: PastQuestionInsightScope.PAPER, paper: paper._id },
      {
        $set: {
          scope: PastQuestionInsightScope.PAPER,
          paper: paper._id,
          ...courseKey(paper),
          title: paper.title,
          topics,
          sourcePaperIds: [paper._id],
          generatedAt: new Date(),
        },
        $setOnInsert: {
          summary: "",
          repeatedQuestions: [],
          trends: [],
          facts: [],
        },
      },
      { upsert: true, new: true }
    );
    updated += 1;

    if (/^2\.6$/i.test(String(paper.paperCode)) || /principles of tax/i.test(String(paper.title))) {
      const q3 = items.find((item) => String(item.number) === "3(a)");
      if (q3 && Number(paper.year) === 2026 && /july/i.test(String(paper.sitting))) {
        const allTopics = classifyQuestionTopics([q3], paper);
        samples.push(
          `July 2026 2.6 Q3(a) -> ${allTopics.map((row) => row.topic).join(" | ") || "(unmatched)"}`
        );
      }
      if (topics.length) {
        samples.push(
          `${paper.sitting} ${paper.year} 2.6 topics: ${topics
            .map((row: any) => `${row.topic} [${(row.questionNumbers || []).join(",")}]`)
            .join("; ")}`
        );
      }
    }

    if (updated % 25 === 0) console.log(`progress ${updated}/${papers.length}`);
  }

  // Rebuild course insights' topics from paper insights
  const courseDocs = await PastQuestionInsight.find({ scope: PastQuestionInsightScope.COURSE }).lean();
  let coursesUpdated = 0;
  for (const course of courseDocs) {
    const relatedPapers = await PastQuestionPaper.find({
      level: course.level,
      paperCode: course.paperCode,
      title: course.title,
    })
      .select("_id year sitting")
      .lean();
    const paperIds = relatedPapers.map((paper) => paper._id);
    const paperInsights = await PastQuestionInsight.find({
      scope: PastQuestionInsightScope.PAPER,
      paper: { $in: paperIds },
    }).lean();

    const buckets = new Map<string, { topic: string; count: number; years: Set<number> }>();
    paperInsights.forEach((insight: any) => {
      const paper = relatedPapers.find((row) => String(row._id) === String(insight.paper));
      (insight.topics || []).forEach((row: any) => {
        const topic = String(row.topic || "").trim();
        if (!topic) return;
        const key = leafTopicLabel(topic).toLowerCase();
        const next = buckets.get(key) || { topic, count: 0, years: new Set<number>() };
        if (topic.length >= next.topic.length) next.topic = topic;
        next.count += Math.max(1, Number(row.count) || 1);
        if (paper?.year) next.years.add(Number(paper.year));
        (row.years || []).forEach((year: number) => next.years.add(Number(year)));
        buckets.set(key, next);
      });
    });

    const topics = Array.from(buckets.values())
      .map((item) => ({
        topic: item.topic,
        count: item.count,
        years: Array.from(item.years).filter(Boolean).sort((a, b) => a - b),
      }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));

    await PastQuestionInsight.updateOne(
      { _id: course._id },
      { $set: { topics, generatedAt: new Date() } }
    );
    coursesUpdated += 1;
  }

  console.log(`done. papersUpdated=${updated} coursesUpdated=${coursesUpdated}`);
  console.log(`classifiedQuestions=${classifiedQuestions} unmatchedQuestions=${unmatchedQuestions}`);
  for (const sample of samples.slice(0, 40)) console.log(sample);

  // Explicit July 2026 verification via rebuild helper
  const july = papers.find(
    (paper) =>
      Number(paper.year) === 2026 &&
      /july/i.test(String(paper.sitting)) &&
      (paper.paperCode === "2.6" || /principles of tax/i.test(String(paper.title)))
  );
  if (july) {
    const insight = await rebuildPaperInsightTopics(String(july._id));
    console.log(
      "verify July 2026 topics:",
      (insight?.topics || []).map((row: any) => `${row.topic}: ${(row.questionNumbers || []).join(",")}`)
    );
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
