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
    // Formatted copies (tables, lists, bold) read from the original PDF. The plain fields above
    // stay in step with these and are what search and the AI use.
    questionHtml: { type: String, default: "" },
    answerHtml: { type: String, default: "" },
    answerNotesHtml: { type: String, default: "" },
    // 0 = plain text only, 1 = HTML read from the PDF.
    formatVersion: { type: Number, default: 0 },
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
