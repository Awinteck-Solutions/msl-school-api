const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const categorySchema = new Schema(
  {
    name: { type: String, required: true },
    position: { type: String, required: true },
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

const Category = mongoose.model("Category", categorySchema);

export default Category;