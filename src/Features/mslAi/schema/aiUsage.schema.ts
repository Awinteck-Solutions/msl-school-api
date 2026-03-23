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
    question: { type: String },
    answer: { type: String },
    prompt_tokens: { type: Number },
    completion_tokens: { type: Number },
    total_tokens: { type: Number },
    model: { type: String },
    cost_estimate_usd: { type: Number },
  },
  { timestamps: true }
);

const AiUsage = mongoose.model("AiUsage", aiUsageSchema);

export default AiUsage;
