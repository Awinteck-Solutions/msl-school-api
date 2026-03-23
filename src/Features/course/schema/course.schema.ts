const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const CourseSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: null },
    thumbnail: { type: String, default: null },
    link: { type: String, default: null },
    price: { type: String, default: null },
    category: { type: String, required: false },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "DEACTIVE", "AI-USE"],
      default: "ACTIVE",
    },
    archived: {
      type: Boolean,
      enum: [true, false],
      default: false,
    },
    students: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: false,
      },
    ],
    studentsDeactiveAccess: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: false,
      },
    ],
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    linkedCourses: [
      {
        course: { type: mongoose.Schema.Types.ObjectId, ref: "Course" },
      },
    ],
  },
  { timestamps: true }
);

const Course = mongoose.model("Course", CourseSchema);

export default Course;