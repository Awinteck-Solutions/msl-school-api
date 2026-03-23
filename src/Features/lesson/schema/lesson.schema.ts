const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const linkedCourses = {
  course: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Course",
    required: true,
  },
  position: {
    type: Number,
    default: 1,
  },
};

const lessonSchema = new Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    linkedCourses: [linkedCourses],
    title: {
      type: String,
      required: true,
    },
    description: { type: String, default: null },
    position: { type: Number, required: true },
    public: { type: Boolean, default: false, required: true },
    video: { type: String, default: null },
    video1: { type: String, default: null },
    video2: { type: String, default: null },
    video3: { type: String, default: null },
    video4: { type: String, default: null },
    video5: { type: String, default: null },
    video6: { type: String, default: null },
    video7: { type: String, default: null },
    video8: { type: String, default: null },
    video9: { type: String, default: null },
    video10: { type: String, default: null },
    pdf: { type: String, default: null },
    pdf1: { type: String, default: null },
    pdf2: { type: String, default: null },
    pdf3: { type: String, default: null },
    pdf4: { type: String, default: null },
    pdf5: { type: String, default: null },
    pdf6: { type: String, default: null },
    pdf7: { type: String, default: null },
    pdf8: { type: String, default: null },
    pdf9: { type: String, default: null },
    pdf10: { type: String, default: null },
    status: {
      type: String,
      enum: ["ACTIVE", "DEACTIVE"],
      default: "ACTIVE",
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  { timestamps: true }
);

const Lesson = mongoose.model("Lesson", lessonSchema);

export default Lesson;