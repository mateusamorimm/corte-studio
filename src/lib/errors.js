// Erro de aplicação com status HTTP e código legível pelo frontend.
export class AppError extends Error {
  constructor(status, message, code = "ERRO", details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(400, msg, "DADOS_INVALIDOS", details);
export const unauthorized = (msg = "Faça login para continuar.") => new AppError(401, msg, "NAO_AUTENTICADO");
export const forbidden = (msg = "Você não tem permissão para esta ação.") => new AppError(403, msg, "SEM_PERMISSAO");
export const notFound = (msg = "Registro não encontrado.") => new AppError(404, msg, "NAO_ENCONTRADO");
export const conflict = (msg, details) => new AppError(409, msg, "CONFLITO", details);
