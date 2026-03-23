const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const lessonProgressSchema = new Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lesson: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lesson",
      required: true,
    },
    completedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

lessonProgressSchema.index({ student: 1, lesson: 1 }, { unique: true });

const LessonProgress = mongoose.model("LessonProgress", lessonProgressSchema);

export default LessonProgress;
