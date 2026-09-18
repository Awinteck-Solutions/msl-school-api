const mongoose = require("mongoose");
const Schema = mongoose.Schema;
import { SubscriptionContentStatus } from "../enums/subscription.enum";

const subscriptionResourceSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: null },
    thumbnail: { type: String, default: null },   
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: false,
    },
    status: {
      type: String,
      enum: Object.values(SubscriptionContentStatus),
      default: SubscriptionContentStatus.ACTIVE,
      required: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true }
);

subscriptionResourceSchema.index({ status: 1, createdAt: -1 });
subscriptionResourceSchema.index({ categoryId: 1, status: 1 });

const SubscriptionResource = mongoose.model(
  "SubscriptionResource",
  subscriptionResourceSchema
);

export default SubscriptionResource;
