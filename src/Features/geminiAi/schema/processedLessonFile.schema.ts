const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const processedLessonFileSchema = new Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lesson",
      required: true,
    },
    fileKey: {
      type: String,
      required: true,
    },
    fileType: {
      type: String,
      enum: ["pdf", "video"],
      required: true,
    },
    fileSizeMB: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED", "PROCESSING"],
      default: "PROCESSING",
      required: true,
    },
    chunksCount: { type: Number, default: null },
    errorMessage: { type: String, default: null },
    processedAt: { type: Date, default: null },
    fileName: { type: String, default: null },
  },
  { timestamps: true }
);

processedLessonFileSchema.index({ lesson: 1, fileKey: 1 }, { unique: true });
processedLessonFileSchema.index({ course: 1, status: 1 });

const ProcessedLessonFile =
  mongoose.models.ProcessedLessonFile ||
  mongoose.model("ProcessedLessonFile", processedLessonFileSchema);

export default ProcessedLessonFile;
