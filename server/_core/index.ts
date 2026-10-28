import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { publicPlatformScript } from "./publicConfig";
import { serveStatic, setupVite } from "./vite";
import { pharmacyErrorHandler, pharmacyRouter } from "../pharmacy/routes";
import { ensureInitialAdmin } from "../pharmacy/bootstrap";

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.disable("x-powered-by");
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, private");
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "64kb", extended: false }));
  app.get("/api/health", (_req, res) => res.status(200).json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  app.use("/api", pharmacyRouter);
  app.use("/api", (_req, res) => res.status(404).json({ ok: false, error: "المسار غير موجود.", code: "NOT_FOUND" }));
  app.use(pharmacyErrorHandler);

  // The database already has its checked-in migration applied before startup.
  // This idempotent transaction creates an admin only once, from a protected secret.
  await ensureInitialAdmin();

  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => {
    console.error("Server failed:", error.message);
    process.exit(1);
  });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => {
  console.error("M Pharmacy startup failed:", error instanceof Error ? error.message : "unknown error");
  process.exit(1);
});
