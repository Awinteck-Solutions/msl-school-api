const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const faqSchema = new Schema(
  {
    question: { type: String, required: true },
    answer: { type: String, required: true },
    status: {
      type: String,
      enum: ["ACTIVE", "DEACTIVE"],
      default: "ACTIVE",
    },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

faqSchema.index({ status: 1, order: 1, createdAt: -1 });
faqSchema.index({ question: "text", answer: "text" });

const Faq = mongoose.model("Faq", faqSchema);

export default Faq;
