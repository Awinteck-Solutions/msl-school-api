const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const QuizSchema = new Schema(
  {
    course: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Course",
        required: false,
      },
    ],
    title: { type: String, required: false },
    status: {
      type: String,
      enum: ["ACTIVE", "DEACTIVE"],
      default: "ACTIVE",
    },
  },
  { timestamps: true }
);

const Quiz = mongoose.model("Quiz", QuizSchema);

export default Quiz;
