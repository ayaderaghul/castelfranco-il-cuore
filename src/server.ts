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
        // Fonts are self-hosted: the browser never contacts a third party.
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
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

// "no-cache" = the browser keeps the files but asks the server (ETag) every time,
// so a new deploy shows up on the next reload instead of up to an hour later.
app.use(
  express.static(publicDir, {
    index: "index.html",
    // Font files never change: cache them for a year. Everything else revalidates.
    setHeaders: (res, filePath) =>
      res.setHeader("Cache-Control", /[\\/]fonts[\\/].+\.woff2$/.test(filePath) ? "public, max-age=31536000, immutable" : "no-cache"),
  }),
);
app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

// Last resort: bad JSON bodies and unexpected errors get a short JSON reply, never a stack trace.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof err?.status === "number" && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? "Errore del server." : "Richiesta non valida." });
});

const port = Number(process.env.PORT ?? 3000);
migrate()
  .then(() => {
    // No warm-up: outside services are only called when an open page asks for data.
    app.listen(port, () => console.log(`Castelfranco il cuore on :${port}`));
  })
  .catch((err) => {
    console.error("Migration failed", err);
    process.exit(1);
  });
