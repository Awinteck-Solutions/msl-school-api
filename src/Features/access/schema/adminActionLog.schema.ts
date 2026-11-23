import mongoose from "mongoose";

const adminActionLogSchema = new mongoose.Schema(
  {
    actorId: { type: String, default: "" },
    actorName: { type: String, default: "" },
    actorEmail: { type: String, default: "" },
    role: { type: String, required: true },
    method: { type: String, required: true },
    path: { type: String, required: true },
    summary: { type: String, required: true },
    statusCode: { type: Number, default: 0 },
  },
  { timestamps: true }
);

adminActionLogSchema.index({ createdAt: -1 });
adminActionLogSchema.index({ role: 1, createdAt: -1 });

const AdminActionLog = mongoose.model("AdminActionLog", adminActionLogSchema);

export default AdminActionLog;
