const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const requestsSchema = new Schema(
  {
    email: { type: String, default: null },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "DEACTIVE"],
      default: "ACTIVE",
    },
  },
  { timestamps: true }
);

const Requests = mongoose.model("Requests", requestsSchema);

export default Requests;