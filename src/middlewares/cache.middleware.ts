import { Request, Response, NextFunction } from "express";
import { redis } from "../helpers/redis";

type CacheOptions = {
  ttlSeconds?: number;
  keyPrefix?: string;
  keyBuilder?: (req: Request) => string;
};

const buildDefaultKey = (req: Request, keyPrefix: string) => {
  const query = new URLSearchParams(req.query as Record<string, string>);
  return `${keyPrefix}:${req.method}:${req.baseUrl}${req.path}?${query.toString()}`;
};

export const cacheMiddleware = (options: CacheOptions = {}) => {
  const {
    ttlSeconds = 60,
    keyPrefix = "cache",
    keyBuilder,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const key = keyBuilder
        ? keyBuilder(req)
        : buildDefaultKey(req, keyPrefix);

      const cached = await redis.get(key);
      if (cached) {
        const cachedValue =
          typeof cached === "string" ? cached : cached.toString();
        return res.status(200).json(JSON.parse(cachedValue));
      }

      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redis
            .setEx(key, ttlSeconds, JSON.stringify(body))
            .catch((cacheError) => {
              console.error("[cache] redis setEx failed", cacheError);
            });
        }
        return originalJson(body);
      };

      return next();
    } catch (error) {
      return next();
    }
  };
};
