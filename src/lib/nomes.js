// "Carlos Alberto Silva" → "Carlos S." (nome mostrado para outras pessoas)
export function nomePublico(nomeCompleto) {
  const partes = nomeCompleto.trim().split(/\s+/);
  return partes.length > 1 ? `${partes[0]} ${partes[partes.length - 1][0]}.` : partes[0];
}
