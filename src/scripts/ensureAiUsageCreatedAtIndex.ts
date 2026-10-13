import mongoose from "mongoose";
import * as dotenv from "dotenv";
import AiUsage from "../Features/mslAi/schema/aiUsage.schema";

dotenv.config();

const INDEX_NAME = "createdAt_1_student_1";

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
    const alreadyPresent = before.some((index) => index.name === INDEX_NAME);

    if (alreadyPresent) {
      console.log(`${INDEX_NAME} already exists. No build started.`);
    } else {
      console.log(`Building ${INDEX_NAME}. This can take a while on a large AiUsage collection.`);
      await AiUsage.createIndexes();
      console.log(`${INDEX_NAME} build finished.`);
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
