import { createClient } from "redis";

const redis = createClient({
  username: process.env.REDIS_USERNAME || "default",
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
  },
});

redis.on("error", (err) => console.log("Redis Client Error", err));
redis.on("connect", () => console.log("Redis connected ✅"));

const connectRedis = async () => {
  try {
    if (!redis.isOpen) {
      await redis.connect();
    }
  } catch (error) {
    console.log("Redis connect failed ❌", error);
  }
};

connectRedis();

export { redis, connectRedis };

