// Valida body/query/params com zod e substitui pelos valores já convertidos.
// Uso: validar({ body: schemaX, query: schemaY, params: schemaZ })
export function validar(schemas) {
  return (req, _res, next) => {
    try {
      req.valid = {};
      for (const parte of ["params", "query", "body"]) {
        if (schemas[parte]) req.valid[parte] = schemas[parte].parse(req[parte] ?? {});
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
