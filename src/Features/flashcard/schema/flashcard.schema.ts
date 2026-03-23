const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const flashCardItemSchema = new Schema(
  {
    term: { type: String, required: true },
    termImage: { type: String },
    definition: { type: String, required: true },
    definitionImage: { type: String },
  },
  { timestamps: true }
);

const flashCardSchema = new Schema(
  {
    title: { type: String, required: true },
    thumbnail: { type: String },
    description: { type: String },
    instructions: { type: String },
    course: [{ type: mongoose.Schema.Types.ObjectId, ref: "Course" }],
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    flashcardItems: [flashCardItemSchema],
    status: {
      type: String,
      enum: ["ACTIVE", "DEACTIVE", "DELETED", "ARCHIVED"],
      default: "ACTIVE",
    },
  },
  { timestamps: true }
);

const FlashCard = mongoose.model("FlashCard", flashCardSchema);

export default FlashCard;