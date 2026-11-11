import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { isProd } from "./config/env.js";
import { carregarSessao } from "./middlewares/auth.js";
import { protecaoCsrf } from "./middlewares/csrf.js";
import { naoEncontradoApi, tratarErros } from "./middlewares/errorHandler.js";
import apiRoutes from "./routes/index.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function criarApp() {
  const app = express();
  app.disable("x-powered-by");
  if (isProd) app.set("trust proxy", 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"], // sem scripts inline: proteção extra contra XSS
          "script-src-attr": ["'none'"], // sem onclick="..." no HTML
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "https://fonts.gstatic.com"],
          "img-src": ["'self'", "data:", "https:"],
          "frame-src": ["https://www.google.com", "https://maps.google.com"],
          "connect-src": ["'self'"],
          "form-action": ["'self'"],
          "upgrade-insecure-requests": isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(cookieParser());

  // API: JSON pequeno, sessão, CSRF, rotas e erros padronizados.
  const api = express.Router();
  api.use(express.json({ limit: "100kb" }));
  api.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  api.use(carregarSessao);
  api.use(protecaoCsrf);
  api.use(apiRoutes);
  api.use(naoEncontradoApi);
  app.use("/api", api);

  // Frontend estático (somente a pasta public/ é exposta).
  app.use(express.static(path.join(raiz, "public"), { extensions: ["html"], index: "index.html" }));

  app.use(tratarErros);
  return app;
}
