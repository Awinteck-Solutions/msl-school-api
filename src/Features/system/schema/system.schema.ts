const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SystemSchema = new Schema(
  {
    status: { type: Boolean, default: false },
    enforce: { type: Boolean, default: false },
    version: { type: String, default: null },
    mainLink: { type: String, default: null },
    subLink: { type: String, default: null },
    message: { type: String, default: null },
    isAvailable: { type: Boolean, default: false },
    previousVersion: { type: String, default: null },
    osVersion: {
      type: String,
      enum: ["android", "ios", "windows"],
      default: "android",
    },
  },
  { timestamps: true }
);

const System = mongoose.model("System", SystemSchema);

export default System;