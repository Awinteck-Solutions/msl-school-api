const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const flashCardProgressSchema = new Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    flashcard: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FlashCard",
      required: true,
    },
    progress: { type: Number, default: 0 },
  },
  { timestamps: true }
);

flashCardProgressSchema.index({ student: 1, flashcard: 1 }, { unique: true });

const FlashCardProgress = mongoose.model(
  "FlashCardProgress",
  flashCardProgressSchema
);

export default FlashCardProgress;
