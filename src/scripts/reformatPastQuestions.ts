/**
 * Re-read past-question PDFs and keep their tables, lists and formatting as HTML on the
 * existing questions (ids and order are unchanged). Safe to stop and run again: papers whose
 * questions are all formatted are skipped.
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/reformatPastQuestions.ts [--paper <id>] [--limit 20]
 *        [--concurrency 3] [--all] [--sync-plain]
 *
 *   --paper         only this paper id
 *   --limit         stop after this many papers
 *   --all           include papers that are already formatted
 *   --sync-plain    also rewrite the plain-text fields from the PDF and rebuild search vectors
 */
import "dotenv/config";
import mongoose from "mongoose";
import {
  findPapersNeedingFormat,
  reformatPaperFromPdf,
} from "../Features/pastQuestion/controllers/pastQuestion.service";
import PastQuestionPaper from "../Features/pastQuestion/schema/pastQuestionPaper.schema";

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const run = async () => {
  if (!process.env.DB_URL) throw new Error("DB_URL is not set.");
  await mongoose.connect(process.env.DB_URL);

  let ids: string[];
  if (arg("paper")) ids = [String(arg("paper"))];
  else if (flag("all")) ids = (await PastQuestionPaper.find({}).select("_id").lean()).map((p: any) => String(p._id));
  else ids = await findPapersNeedingFormat();

  const limit = Number(arg("limit")) || ids.length;
  ids = ids.slice(0, limit);
  const concurrency = Math.max(1, Math.min(5, Number(arg("concurrency")) || 3));
  console.log(`papers=${ids.length} concurrency=${concurrency} syncPlain=${flag("sync-plain")}`);

  const queue = [...ids];
  let done = 0;
  let updated = 0;
  let review = 0;
  let failed = 0;
  const started = Date.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const id = queue.shift() as string;
        try {
          const result = await reformatPaperFromPdf(id, { syncPlain: flag("sync-plain") });
          updated += result.updated;
          const issues = [
            result.missing.length && `missing ${result.missing.join(",")}`,
            result.mismatched.length && `mismatched ${result.mismatched.join(",")}`,
            result.partial.length && `partial ${result.partial.join(",")}`,
          ].filter(Boolean);
          if (issues.length) review += 1;
          console.log(`[${++done}/${ids.length}] ${id} updated ${result.updated}/${result.total}${issues.length ? ` — ${issues.join("; ")}` : ""}`);
        } catch (error: any) {
          failed += 1;
          console.log(`[${++done}/${ids.length}] ${id} FAILED: ${error?.message || error}`);
        }
      }
    })
  );

  console.log(
    `done in ${Math.round((Date.now() - started) / 1000)}s: questions updated=${updated}, papers needing review=${review}, failed=${failed}`
  );
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
