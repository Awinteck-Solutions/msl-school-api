import * as http from "http";
import * as WebSocket from "ws";
import * as jwt from "jsonwebtoken";

const LIVE_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const getBearerToken = (header?: string | string[]) => {
  if (!header || Array.isArray(header)) return null;
  const [type, token] = header.split(" ");
  if (type?.toLowerCase() !== "bearer") return null;
  return token || null;
};

const verifyToken = (token: string | null) => {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET || "");
  } catch {
    return null;
  }
};

export const attachGeminiLiveProxy = (server: http.Server) => {
  const wss = new WebSocket.Server({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    try {
      const url = new URL(req.url || "", `http://${req.headers.host}`);
      if (url.pathname !== "/v2/gemini-ai/live") {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", (client, req) => {
    const url = new URL(req.url || "", `http://${req.headers.host}`);
    const token =
      url.searchParams.get("token") ||
      getBearerToken(req.headers.authorization);

    const decoded = verifyToken(token);
    if (!decoded) {
      client.close(1008, "Unauthorized");
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      client.close(1011, "Missing GEMINI_API_KEY");
      return;
    }

    const upstream = new WebSocket(`${LIVE_ENDPOINT}?key=${apiKey}`);

    const closeBoth = (code?: number, reason?: string) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(code, reason);
      }
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.close(code, reason);
      }
    };

    upstream.on("open", () => {
      client.send(
        JSON.stringify({
          event: "ready",
          message: "Gemini Live proxy connected",
        })
      );
    });

    upstream.on("message", (data) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });

    upstream.on("error", (err) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            event: "error",
            message: "Upstream error",
            error: err.message,
          })
        );
      }
      closeBoth();
    });

    upstream.on("close", () => {
      closeBoth();
    });

    client.on("message", (data) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data);
      }
    });

    client.on("close", () => {
      closeBoth();
    });

    client.on("error", () => {
      closeBoth();
    });
  });
};
