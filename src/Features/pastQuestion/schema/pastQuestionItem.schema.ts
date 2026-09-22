const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const pastQuestionItemSchema = new Schema(
  {
    paper: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PastQuestionPaper",
      required: true,
    },
    number: { type: String, default: "" },
    question: { type: String, required: true },
    answer: { type: String, default: "" },
    answerNotes: { type: String, default: "" },
    marks: { type: Number, default: null },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

pastQuestionItemSchema.index({ paper: 1, order: 1 });

const PastQuestionItem = mongoose.model(
  "PastQuestionItem",
  pastQuestionItemSchema
);

export default PastQuestionItem;
