const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const flashCardCompletionSchema = new Schema(
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
    completedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const FlashCardCompletion = mongoose.model(
  "FlashCardComplete",
  flashCardCompletionSchema
);

export default FlashCardCompletion;
