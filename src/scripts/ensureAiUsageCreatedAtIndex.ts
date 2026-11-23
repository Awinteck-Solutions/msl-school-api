import mongoose from "mongoose";
import * as dotenv from "dotenv";
import AiUsage from "../Features/mslAi/schema/aiUsage.schema";

dotenv.config();

const INDEX_NAMES = ["createdAt_1_student_1", "source_1_createdAt_1_student_1"];

/**
 * Builds the AiUsage { createdAt: 1, student: 1 } index used by admin
 * all-students-usage. Safe to run more than once.
 *
 * MongoDB 4.2+ builds indexes without blocking reads or writes, but the build
 * still uses I/O and CPU. Run this during a low-traffic window before deploy
 * so application startup does not start the build under live traffic.
 */
const ensureAiUsageCreatedAtIndex = async () => {
  if (!process.env.DB_URL) {
    throw new Error("DB_URL is not set.");
  }

  await mongoose.connect(process.env.DB_URL, {
    sanitizeFilter: true,
    autoCreate: false,
  });

  try {
    const before = await AiUsage.collection.indexes();
    const missing = INDEX_NAMES.filter(
      (name) => !before.some((index) => index.name === name)
    );

    if (!missing.length) {
      console.log(`${INDEX_NAMES.join(", ")} already exist. No build started.`);
    } else {
      console.log(`Building ${missing.join(", ")}. This can take a while on a large AiUsage collection.`);
      await AiUsage.createIndexes();
      console.log(`${missing.join(", ")} build finished.`);
    }

    const after = await AiUsage.collection.indexes();
    console.log(
      "AiUsage indexes:",
      after.map((index) => index.name).join(", ")
    );
  } finally {
    await mongoose.disconnect();
  }
};

ensureAiUsageCreatedAtIndex().catch((error) => {
  console.error("Failed to ensure AiUsage createdAt index:", error);
  process.exit(1);
});
