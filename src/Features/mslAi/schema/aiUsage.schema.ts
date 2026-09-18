const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const aiUsageSchema = new Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: false,
    },
    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lesson",
      required: false,
    },
    s3Keys: {
      type: [String],
      required: false,
    },
    queryType: {
      type: String,
      enum: ["chat", "generate-quiz", "summarize", "generate-flashcards"],
      required: false,
    },
    source: {
      type: String,
      enum: ["course", "subscription"],
      default: "course",
    },
    question: { type: String },
    answer: { type: String },
    prompt_tokens: { type: Number },
    completion_tokens: { type: Number },
    total_tokens: { type: Number },
    model: { type: String },
    cost_estimate_usd: { type: Number },
    metadata: { type: Object },
  },
  { timestamps: true }
);

aiUsageSchema.index({ student: 1, source: 1, createdAt: -1 });
aiUsageSchema.index({ source: 1, createdAt: -1 });

const AiUsage = mongoose.model("AiUsage", aiUsageSchema);

export default AiUsage;
