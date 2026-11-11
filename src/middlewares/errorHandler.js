import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors.js";

// Traduz erros do PostgreSQL (códigos SQLSTATE) que chegam via Prisma.
function erroPostgres(err) {
  const texto = String(err?.message ?? "");
  const codigo = err?.meta?.code ?? texto.match(/\b(23P01|23514|23505|23503|40001|40P01)\b/)?.[1];
  switch (codigo) {
    case "23P01":
      return new AppError(409, "Conflito de horário: o período já está ocupado.", "CONFLITO_HORARIO");
    case "23514":
      return new AppError(400, "Os dados violam uma regra de validação do sistema.", "REGRA_VIOLADA");
    case "40001":
    case "40P01":
      return new AppError(409, "Operação concorrente detectada. Tente novamente.", "CONCORRENCIA");
    default:
      return null;
  }
}

export function naoEncontradoApi(req, _res, next) {
  next(new AppError(404, `Rota não encontrada: ${req.method} ${req.originalUrl}`, "ROTA_INEXISTENTE"));
}

// eslint-disable-next-line no-unused-vars
export function tratarErros(err, req, res, _next) {
  let erro = err;

  if (err instanceof ZodError) {
    erro = new AppError(
      400,
      err.issues[0]?.message || "Dados inválidos.",
      "DADOS_INVALIDOS",
      err.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message }))
    );
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      const campos = [].concat(err.meta?.target ?? []).join(", ");
      erro = new AppError(409, `Já existe um registro com este valor (${campos}).`, "DUPLICADO", { campos });
    } else if (err.code === "P2025") {
      erro = new AppError(404, "Registro não encontrado.", "NAO_ENCONTRADO");
    } else if (err.code === "P2003") {
      erro = new AppError(409, "Este registro está vinculado a outros dados e não pode ser removido.", "VINCULADO");
    } else if (err.code === "P2034") {
      erro = new AppError(409, "Operação concorrente detectada. Tente novamente.", "CONCORRENCIA");
    } else {
      erro = erroPostgres(err) ?? err;
    }
  } else if (err?.type === "entity.parse.failed") {
    erro = new AppError(400, "JSON inválido.", "JSON_INVALIDO");
  } else if (err?.type === "entity.too.large") {
    erro = new AppError(413, "Requisição muito grande.", "MUITO_GRANDE");
  } else if (!(err instanceof AppError)) {
    erro = erroPostgres(err) ?? err;
  }

  if (erro instanceof AppError) {
    return res.status(erro.status).json({
      erro: { codigo: erro.code, mensagem: erro.message, detalhes: erro.details },
    });
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    console.error("[db] Falha de conexão com o banco:", err.message);
    return res.status(503).json({
      erro: { codigo: "BANCO_INDISPONIVEL", mensagem: "Banco de dados indisponível no momento." },
    });
  }

  console.error(`[erro] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ erro: { codigo: "ERRO_INTERNO", mensagem: "Erro interno. Tente novamente." } });
}
