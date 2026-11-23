const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const aiVoiceSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    geminiVoice: {
      type: String,
      required: true,
      trim: true,
    },
    kind: {
      type: String,
      enum: ["replicated", "prebuilt"],
      required: true,
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

aiVoiceSchema.index({ enabled: 1, isDefault: 1 });

export default mongoose.model("AiVoice", aiVoiceSchema);
