const mongoose = require("mongoose");
const Schema = mongoose.Schema;
import {
  PastQuestionProcessStatus,
  PastQuestionStatus,
} from "../enums/pastQuestion.enum";

const pastQuestionPaperSchema = new Schema(
  {
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    year: { type: Number, required: true },
    sitting: { type: String, default: "" },
    level: { type: String, required: true },
    title: { type: String, required: true },
    paperCode: { type: String, default: "" },
    fileKey: { type: String, required: true },
    fileName: { type: String, required: true },
    fileUrl: { type: String, default: null },
    fileSizeMB: { type: Number, default: 0 },
    extractedText: { type: String, default: "" },
    status: {
      type: String,
      enum: Object.values(PastQuestionStatus),
      default: PastQuestionStatus.ACTIVE,
    },
    processStatus: {
      type: String,
      enum: Object.values(PastQuestionProcessStatus),
      default: PastQuestionProcessStatus.PENDING,
    },
    questionCount: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    processedAt: { type: Date, default: null },
    uploadedBy: { type: String, default: "admin" },
  },
  { timestamps: true }
);

pastQuestionPaperSchema.index({ categoryId: 1, year: -1, level: 1, paperCode: 1 });
pastQuestionPaperSchema.index({ status: 1, processStatus: 1, year: -1 });
pastQuestionPaperSchema.index({
  categoryId: 1,
  level: 1,
  paperCode: 1,
  year: -1,
});

const PastQuestionPaper = mongoose.model(
  "PastQuestionPaper",
  pastQuestionPaperSchema
);

export default PastQuestionPaper;
