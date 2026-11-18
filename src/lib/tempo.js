// Conversões entre o horário local do salão (fuso configurável) e UTC.
// O banco guarda instantes em TIMESTAMPTZ; disponibilidades são horários locais (TIME).

const formatadores = new Map();
function formatador(tz) {
  if (!formatadores.has(tz)) {
    formatadores.set(
      tz,
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "short",
      })
    );
  }
  return formatadores.get(tz);
}

const DIAS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Partes da data/hora de um instante no fuso informado.
export function partesLocais(instante, tz) {
  const p = Object.fromEntries(formatador(tz).formatToParts(instante).map((x) => [x.type, x.value]));
  return {
    ano: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour),
    minuto: Number(p.minute),
    segundo: Number(p.second),
    diaSemana: DIAS[p.weekday],
  };
}

// Diferença (ms) entre o horário local e UTC naquele instante.
function deslocamento(instante, tz) {
  const p = partesLocais(instante, tz);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

// "AAAA-MM-DD" + minutos desde 00:00 (horário local) → Date (UTC).
export function localParaUtc(dataIso, minutos, tz) {
  const [a, m, d] = dataIso.split("-").map(Number);
  const palpite = Date.UTC(a, m - 1, d, 0, minutos);
  let utc = palpite - deslocamento(new Date(palpite), tz);
  // Segunda passada corrige a virada de horário de verão, se houver.
  utc = palpite - deslocamento(new Date(utc), tz);
  return new Date(utc);
}

// Data local ("AAAA-MM-DD") de um instante.
export function dataLocal(instante, tz) {
  const p = partesLocais(instante, tz);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

// Soma dias a uma data "AAAA-MM-DD" (calendário puro, sem fuso).
export function somarDias(dataIso, dias) {
  const [a, m, d] = dataIso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

// Dia da semana (0 = domingo) de uma data "AAAA-MM-DD".
export function diaDaSemana(dataIso) {
  const [a, m, d] = dataIso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

// Coluna TIME do Prisma (Date em 1970-01-01 UTC) ↔ minutos desde 00:00.
export const timeParaMinutos = (t) => t.getUTCHours() * 60 + t.getUTCMinutes();
export const minutosParaTime = (min) => new Date(Date.UTC(1970, 0, 1, Math.floor(min / 60), min % 60));
export const minutosParaTexto = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const textoParaMinutos = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

// Início do mês local (1º dia, 00:00) de um instante, em UTC.
export function inicioDoMes(instante, tz, deslocMeses = 0) {
  const p = partesLocais(instante, tz);
  const alvo = new Date(Date.UTC(p.ano, p.mes - 1 + deslocMeses, 1));
  return localParaUtc(alvo.toISOString().slice(0, 10), 0, tz);
}
