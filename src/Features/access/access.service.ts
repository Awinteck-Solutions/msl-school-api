import RolePermission from "./schema/rolePermission.schema";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, PermissionKey } from "./permissions";

let cacheAt = 0;
let stored = new Map<string, Record<string, boolean>>();

const loadStored = async () => {
  if (Date.now() - cacheAt < 15000 && stored.size >= 0 && cacheAt) return stored;
  const rows = await RolePermission.find().select("role grants").lean();
  stored = new Map(rows.map((row: any) => [row.role, row.grants || {}]));
  cacheAt = Date.now();
  return stored;
};

export const clearPermissionCache = () => {
  cacheAt = 0;
};

export const permissionsForRole = async (role: string) => {
  if (role === "ADMIN") return { ...DEFAULT_ROLE_PERMISSIONS.ADMIN };
  const defaults = DEFAULT_ROLE_PERMISSIONS[role];
  if (!defaults) return {};
  const overrides = (await loadStored()).get(role) || {};
  const merged = { ...defaults };
  for (const item of PERMISSIONS) {
    if (typeof overrides[item.key] === "boolean") merged[item.key] = overrides[item.key];
  }
  return merged;
};

export const roleHasPermission = async (role: string, key: PermissionKey | null) => {
  if (!key) return true;
  if (role === "ADMIN") return true;
  const grants = await permissionsForRole(role);
  return grants[key] === true;
};
