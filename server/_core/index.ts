import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { createContext } from "./context";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ limit: "5mb", extended: true }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, timestamp: Date.now() }));
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));

  const staticDir = path.resolve(__dirname, "../../web-dist");
  app.use(express.static(staticDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(staticDir, "index.html"));
  });

  const port = Number(process.env.PORT || 3000);
  server.listen(port, "0.0.0.0", () => console.log(`[MT Assistant] http://localhost:${port}`));
}

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
