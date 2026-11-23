import mongoose from "mongoose";

const aiGenerationJobSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    source: { type: String, enum: ["course", "subscription"], required: true },
    queryType: {
      type: String,
      enum: ["summarize", "generate-flashcards", "generate-quiz"],
      required: true,
    },
    status: {
      type: String,
      enum: ["processing", "ready", "failed"],
      default: "processing",
    },
    message: { type: String, default: "" },
    error: { type: String, default: "" },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

aiGenerationJobSchema.index({ student: 1, source: 1, createdAt: -1 });
aiGenerationJobSchema.index({ student: 1, status: 1, createdAt: -1 });

const AiGenerationJob = mongoose.model("AiGenerationJob", aiGenerationJobSchema);

export default AiGenerationJob;
