const mongoose = require("mongoose");
const Schema = mongoose.Schema;
import { SubscriptionInvoiceStatus } from "../enums/subscription.enum";

const subscriptionInvoiceSchema = new Schema(
  {
    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    email: { type: String, required: true },
    invoiceNumber: { type: String, required: true },
    amount: { type: Number, required: true },
    amountKobo: { type: Number, required: true },
    currency: { type: String, required: true, default: "NGN" },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    dueDate: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(SubscriptionInvoiceStatus),
      default: SubscriptionInvoiceStatus.OPEN,
      required: true,
    },
    paidAt: { type: Date, default: null },
    // Leave unset until Paystack returns a reference. A stored null is indexed
    // and collides on the unique index.
    paymentReference: { type: String },
    authorizationUrl: { type: String, default: null },
    accessCode: { type: String, default: null },
    paystackData: { type: Schema.Types.Mixed, required: false },
    lastReminderAt: { type: Date, default: null },
  },
  { timestamps: true }
);

subscriptionInvoiceSchema.index({ invoiceNumber: 1 }, { unique: true });
subscriptionInvoiceSchema.index(
  { paymentReference: 1 },
  {
    unique: true,
    partialFilterExpression: { paymentReference: { $type: "string" } },
  }
);
subscriptionInvoiceSchema.index({ userId: 1, createdAt: -1 });
subscriptionInvoiceSchema.index({ subscription: 1, createdAt: -1 });
subscriptionInvoiceSchema.index({ status: 1, dueDate: 1 });

const SubscriptionInvoice = mongoose.model(
  "SubscriptionInvoice",
  subscriptionInvoiceSchema
);

export default SubscriptionInvoice;
