import mongoose from "mongoose";

const rolePermissionSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, unique: true },
    grants: { type: Object, default: {} },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

const RolePermission = mongoose.model("RolePermission", rolePermissionSchema);

export default RolePermission;
