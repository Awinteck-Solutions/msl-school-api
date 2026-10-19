import mongoose from "mongoose";
import * as dotenv from "dotenv";
import SubscriptionInvoice from "../Features/subscription/schema/subscriptionInvoice.schema";

dotenv.config();

const INDEX_NAME = "paymentReference_1";
const PARTIAL_FILTER = { paymentReference: { $type: "string" } };

/**
 * Replaces the sparse unique paymentReference index. That index treats null as
 * a value, so only one invoice can be saved before Paystack assigns a reference.
 * The partial index enforces uniqueness only for real reference strings.
 */
const ensureSubscriptionInvoicePaymentReferenceIndex = async () => {
  if (!process.env.DB_URL) {
    throw new Error("DB_URL is not set.");
  }

  await mongoose.connect(process.env.DB_URL, {
    sanitizeFilter: true,
    autoCreate: false,
  });

  try {
    const cleared = await SubscriptionInvoice.collection.updateMany(
      { paymentReference: null },
      { $unset: { paymentReference: "" } }
    );
    console.log(`Unset null paymentReference on ${cleared.modifiedCount} invoice(s).`);

    const indexes = await SubscriptionInvoice.collection.indexes();
    const current = indexes.find((index) => index.name === INDEX_NAME);
    const alreadyPartial =
      current?.unique === true &&
      JSON.stringify(current.partialFilterExpression) === JSON.stringify(PARTIAL_FILTER);

    if (alreadyPartial) {
      console.log(`${INDEX_NAME} is already a partial unique index.`);
    } else {
      if (current) {
        console.log(`Dropping ${INDEX_NAME} (${JSON.stringify(current)}).`);
        await SubscriptionInvoice.collection.dropIndex(INDEX_NAME);
      }
      await SubscriptionInvoice.collection.createIndex(
        { paymentReference: 1 },
        {
          name: INDEX_NAME,
          unique: true,
          partialFilterExpression: PARTIAL_FILTER,
        }
      );
      console.log(`Created partial unique index ${INDEX_NAME}.`);
    }
  } finally {
    await mongoose.disconnect();
  }
};

ensureSubscriptionInvoicePaymentReferenceIndex().catch((error) => {
  console.error("Failed to update subscription invoice paymentReference index:", error);
  process.exit(1);
});
