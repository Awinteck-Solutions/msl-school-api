import { Request, Response, NextFunction } from "express";
import { redis } from "../helpers/redis";

type CacheNamespace = string;

const buildPatterns = (namespaces: CacheNamespace[]) => {
  const patterns: string[] = [];
  namespaces.forEach((name) => {
    patterns.push(`${name}:*`);
    patterns.push(`admin:${name}:*`);
  });
  return patterns;
};

const invalidateFeatureCache = async (namespaces: CacheNamespace[]) => {
  try {
    const patterns = buildPatterns(namespaces);
    const keyGroups = await Promise.all(
      patterns.map((pattern) => redis.keys(pattern))
    );
    const allKeys = keyGroups.flat();
    if (allKeys.length) {
      await redis.del(allKeys);
    }
  } catch (error) {
    console.log("Cache invalidation failed", error);
  }
};

export const cacheInvalidation =
  (namespaces: CacheNamespace[]) =>
  (req: Request, res: Response, next: NextFunction) => {
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        invalidateFeatureCache(namespaces);
      }
    });

    return next();
  };
