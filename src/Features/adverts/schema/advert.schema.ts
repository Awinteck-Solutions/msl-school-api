const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const advertSchema = new Schema(
  {
    name: { type: String, required: true },
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE"],
      default: "INACTIVE",
    },
    image: { type: String, required: true },
  },
  { timestamps: true }
);

advertSchema.index({ status: 1, createdAt: -1 });
advertSchema.index({ name: "text" });

const Advert = mongoose.model("Advert", advertSchema);

export default Advert;
