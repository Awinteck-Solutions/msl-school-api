const mongoose = require("mongoose");
const Schema = mongoose.Schema;
import {
  SubscriptionResourceFileStatus,
  SubscriptionResourceType,
} from "../enums/subscription.enum";

const subscriptionResourceFileSchema = new Schema(
  {
    resource: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionResource",
      required: true,
    },
    fileKey: { type: String, required: true },
    fileName: { type: String, required: true },
    fileType: {
      type: String,
      enum: Object.values(SubscriptionResourceType),
      required: true,
    },
    fileSizeMB: { type: Number, default: 0 },
    url: { type: String, default: null },
    status: {
      type: String,
      enum: Object.values(SubscriptionResourceFileStatus),
      default: SubscriptionResourceFileStatus.PENDING,
      required: true,
    },
    chunksCount: { type: Number, default: null },
    errorMessage: { type: String, default: null },
    processedAt: { type: Date, default: null },
    uploadedBy: { type: String, default: "admin" },
  },
  { timestamps: true }
);

subscriptionResourceFileSchema.index({ resource: 1, createdAt: -1 });
subscriptionResourceFileSchema.index({ fileKey: 1 }, { unique: true });
subscriptionResourceFileSchema.index({ status: 1, createdAt: -1 });

const SubscriptionResourceFile = mongoose.model(
  "SubscriptionResourceFile",
  subscriptionResourceFileSchema
);

export default SubscriptionResourceFile;
