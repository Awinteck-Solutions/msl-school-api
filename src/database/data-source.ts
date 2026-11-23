import mongoose from "mongoose";
import * as dotenv from "dotenv";
import { migrateFlatFilesToLessonOne } from "../Features/subscription/subscriptionResourceLesson.service";
import AiUsage from "../Features/mslAi/schema/aiUsage.schema";

dotenv.config();
// Connect to MongoDB
const connectToDatabase = async () => {
  try {
    await mongoose.connect(process.env.DB_URL, {
      autoCreate: true,
    });
    console.log("Connected to MongoDB successfully!✅");
    await AiUsage.createIndexes();
    migrateFlatFilesToLessonOne()
      .then((result) => {
        if (result.resourcesMigrated > 0) {
          console.log(
            `[subscription] Migrated flat files for ${result.resourcesMigrated} resource(s)`
          );
        }
      })
      .catch((error) => {
        console.error("[subscription] Legacy lesson migration failed", error);
      });
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
    process.exit(1); // Exit process with failure
  }
};

export default connectToDatabase;
