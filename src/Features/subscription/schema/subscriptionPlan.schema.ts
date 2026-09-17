const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const subscriptionPlanSchema = new Schema(
  {
    amount: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, required: true, default: "NGN" },
    intervalDays: { type: Number, required: true, default: 30, min: 1 },
    gracePeriodDays: { type: Number, required: true, default: 7, min: 0 },
    reminderDaysBeforeExpiry: {
      type: Number,
      required: true,
      default: 3,
      min: 0,
    },
    dailyAiLimit: { type: Number, required: true, default: 10, min: 1 },
    monthlyAiLimit: { type: Number, required: true, default: 100, min: 1 },
    isActive: { type: Boolean, required: true, default: false },
    description: {
      type: String,
      default: "Monthly AI subscription for users without course enrollment",
    },
    updatedBy: { type: String, default: "system" },
  },
  { timestamps: true }
);

subscriptionPlanSchema.index({}, { unique: true });

const SubscriptionPlan = mongoose.model(
  "SubscriptionPlan",
  subscriptionPlanSchema
);

export default SubscriptionPlan;
