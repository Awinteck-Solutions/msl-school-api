const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const resourceSchema = new Schema(
  {
    lesson_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lesson",
      required: true,
    },
    type: {
      type: String,
      enum: ["VIDEO", "PDF"],
      default: "VIDEO",
    },
    file: { type: String, default: null },
  },
  { timestamps: true }
);

const Resource = mongoose.model("Resource", resourceSchema);

export default Resource;
