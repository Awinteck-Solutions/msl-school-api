const mongoose = require("mongoose");
const Schema = mongoose.Schema;
import { SubscriptionStatus } from "../enums/subscription.enum";

const subscriptionSchema = new Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    email: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(SubscriptionStatus),
      default: SubscriptionStatus.PENDING,
      required: true,
    },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    gracePeriodEndsAt: { type: Date, default: null },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    cancelledAt: { type: Date, default: null },
    lastInvoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionInvoice",
      default: null,
    },
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1, createdAt: -1 });
subscriptionSchema.index({ email: 1, createdAt: -1 });
subscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });

const Subscription = mongoose.model("Subscription", subscriptionSchema);

export default Subscription;
