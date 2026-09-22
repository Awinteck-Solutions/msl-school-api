const mongoose = require("mongoose");
const Schema = mongoose.Schema;
import { PastQuestionInsightScope } from "../enums/pastQuestion.enum";

const pastQuestionInsightSchema = new Schema(
  {
    scope: {
      type: String,
      enum: Object.values(PastQuestionInsightScope),
      required: true,
    },
    paper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PastQuestionPaper",
      required: false,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    level: { type: String, required: true },
    paperCode: { type: String, default: "" },
    title: { type: String, default: "" },
    summary: { type: String, default: "" },
    repeatedQuestions: { type: Array, default: [] },
    topics: { type: Array, default: [] },
    trends: { type: [String], default: [] },
    facts: { type: [String], default: [] },
    sourcePaperIds: [
      { type: mongoose.Schema.Types.ObjectId, ref: "PastQuestionPaper" },
    ],
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

pastQuestionInsightSchema.index(
  { scope: 1, paper: 1 },
  { unique: true, sparse: true }
);
pastQuestionInsightSchema.index({
  scope: 1,
  categoryId: 1,
  level: 1,
  paperCode: 1,
});

const PastQuestionInsight = mongoose.model(
  "PastQuestionInsight",
  pastQuestionInsightSchema
);

export default PastQuestionInsight;
