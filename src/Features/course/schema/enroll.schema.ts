const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const EnrollSchema = new Schema(
  {
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    email: {
      type: mongoose.Schema.Types.String,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "DEACTIVE", "INACTIVE"],
      default: "ACTIVE",
    },
  },
  { timestamps: true }
);

const Enroll = mongoose.model("Enroll", EnrollSchema);

export default Enroll;
