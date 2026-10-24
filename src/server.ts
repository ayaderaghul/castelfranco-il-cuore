import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import { migrate } from "./db.js";
import { authRouter, loadSession, requireAppHeader, requireAuth } from "./auth.js";
import { apiRouter } from "./api.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

const app = express();
app.set("trust proxy", 1); // Render sits behind a proxy; needed for secure cookies and client IPs
app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);

app.use(express.json({ limit: "1mb" }));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.use("/api", requireAppHeader, loadSession);
app.use("/api/auth", authRouter());
app.use("/api", requireAuth, apiRouter());
app.use("/api", (_req, res) => res.status(404).json({ error: "Non trovato." }));

app.use(express.static(publicDir, { index: "index.html", maxAge: "1h" }));
app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

const port = Number(process.env.PORT ?? 3000);
migrate()
  .then(() => {
    app.listen(port, () => console.log(`Castelfranco il cuore on :${port}`));
  })
  .catch((err) => {
    console.error("Migration failed", err);
    process.exit(1);
  });
