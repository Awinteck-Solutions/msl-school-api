const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const objectiveSchema = new Schema({
  name: { type: String },
  image: { type: String },
});

const questionSchema = new Schema({
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
  objectivesWithImage: [objectiveSchema],
  answer: { type: String },
  answer_notes: { type: String },
  answer_notes_image: { type: String },
});

const quizSchema = new Schema(
  {
    course: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Course",
        required: false,
      },
    ],
    students: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: false,
      },
    ],
    thumbnail: { type: String },
    title: { type: String, required: true },
    description: { type: String, default: null },
    quiz: [questionSchema],
    status: {
      type: String,
      enum: ["ACTIVE", "DEACTIVE"],
      default: "ACTIVE",
    },
  },
  { timestamps: true }
);

const Quiz = mongoose.models.Quiz || mongoose.model("Quiz", quizSchema);

export default Quiz;