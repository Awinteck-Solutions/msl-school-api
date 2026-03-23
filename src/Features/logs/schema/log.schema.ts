const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const logSchema = new Schema(
  {
    userId: { type: String, required: false },
    firstname: { type: String, required: false },
    lastname: { type: String, required: false },
    email: { type: String, required: false },
    role: { type: String, required: false },
    method: { type: String, required: true },
    endpoint: { type: String, required: true },
    purpose: { type: String, required: false },
    statusCode: { type: Number, required: true },
    success: { type: Boolean, required: true },
    durationMs: { type: Number, required: false },
    ip: { type: String, required: false },
    userAgent: { type: String, required: false },
    query: { type: Schema.Types.Mixed, required: false },
    params: { type: Schema.Types.Mixed, required: false },
  },
  { timestamps: true }
);

logSchema.index({ createdAt: -1 });
logSchema.index({ userId: 1, createdAt: -1 });
logSchema.index({ role: 1, createdAt: -1 });
logSchema.index({ endpoint: 1, createdAt: -1 });

const RequestLog = mongoose.model("RequestLog", logSchema);

export default RequestLog;
