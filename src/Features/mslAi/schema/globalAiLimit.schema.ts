const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const globalAiLimitSchema = new Schema(
  {
    dailyLimit: {
      type: Number,
      default: 10,
      min: 1,
      required: true,
    },
    monthlyLimit: {
      type: Number,
      default: 100,
      min: 1,
      required: true,
    },
    description: {
      type: String,
      default: "Global AI query limits for all users",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    updatedBy: {
      type: String,
      default: "system",
    },
  },
  { timestamps: true }
);

globalAiLimitSchema.index({}, { unique: true });

const GlobalAiLimit = mongoose.model("GlobalAiLimit", globalAiLimitSchema);

export default GlobalAiLimit;
