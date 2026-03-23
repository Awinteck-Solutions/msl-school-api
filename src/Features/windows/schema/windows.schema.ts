const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const generateSchema = new Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.String,
      ref: "User",
      required: false,
    },
    device_id: { type: String, required: false },
    device_name: { type: String, required: false },
    device_meta: { type: String, required: false },
    code: { type: String, required: true },
    status: {
      type: String,
      enum: ["ACTIVE", "DEACTIVE"],
      default: "DEACTIVE",
    },
  },
  { timestamps: true }
);

const Generate = mongoose.model("Generate", generateSchema);

export default Generate;