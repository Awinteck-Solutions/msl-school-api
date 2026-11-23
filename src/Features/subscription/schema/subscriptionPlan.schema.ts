const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const subscriptionPlanSchema = new Schema(
  {
    code: { type: String, trim: true, lowercase: true },
    name: { type: String, trim: true, default: "Monthly" },
    amount: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, required: true, default: "GHS" },
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
    isBuiltin: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    description: {
      type: String,
      default: "AI subscription for subscriber resources and AI usage limits",
    },
    updatedBy: { type: String, default: "system" },
  },
  { timestamps: true }
);

subscriptionPlanSchema.index(
  { code: 1 },
  { unique: true, partialFilterExpression: { code: { $type: "string" } } }
);

const SubscriptionPlan = mongoose.model(
  "SubscriptionPlan",
  subscriptionPlanSchema
);

export default SubscriptionPlan;
