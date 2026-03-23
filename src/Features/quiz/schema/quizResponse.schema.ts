const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const questionSchema = new Schema({
  question_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Quiz.quiz",
  },
  title: { type: String, required: true },
  thumbnail: { type: String },
  type: { type: String },
  description: { type: String },
  difficulty: {
    type: String,
    required: true,
    enum: ["EASY", "MEDIUM", "HARD", "NEUTRAL"],
    default: "NEUTRAL",
  },
  objectives: [{ type: String }],
  answer: { type: String },
  answer_notes: { type: String },
  student_response: { type: String },
});

const quizResponseSchema = new Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    quiz_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quiz",
      required: false,
    },
    quiz: [questionSchema],
    total_questions: { type: String },
    total_response: { type: String },
    total_corrects: { type: String },
    total_wrongs: { type: String },
    total_points: { type: String },
  },
  { timestamps: true }
);

const QuizResponse =
  mongoose.models.QuizResponse || mongoose.model("QuizResponse", quizResponseSchema);

export default QuizResponse;
