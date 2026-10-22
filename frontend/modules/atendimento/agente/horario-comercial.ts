// ============================================================================
// Expediente da clínica — o plantão da Maia fora do horário (22/10/2026)
//
// Conversa que um atendente assumiu fica com ele; mas quando a pessoa responde
// às 18:30, o atendente já saiu. Fora do expediente, num número com "Maia
// responde", a Maia assume essas conversas (sugestao-evolution.worker.ts) e às
// 08h elas voltam a ser só do atendente.
//
// O horário é o de `central.organizations` (business_hours_start/_end,
// business_days ISO, timezone), mais `public.feriados`: integral fecha o dia,
// parcial fecha só a janela dele (o mesmo sentido da Auditoria ASSIM:
// "expediente encerrado das X às Y").
//
// Pura: o relógio entra como parâmetro. Configuração que não dá para ler
// (dias vazios, início depois do fim, hora ilegível) vale como ABERTO — é o
// comportamento de antes do plantão; erro de cadastro não pode pôr a Maia
// para falar em conversa de atendente.
// ============================================================================

export interface HorarioComercial {
  timezone: string
  // 'HH:MM' ou 'HH:MM:SS', como o Postgres devolve `time`.
  inicio: string
  fim: string
  // ISO: 1 = segunda … 7 = domingo.
  dias: number[]
}

export interface FeriadoExpediente {
  data: string // 'AAAA-MM-DD'
  tipo: 'integral' | 'parcial'
  horario_inicio: string | null
  horario_fim: string | null
}

export interface SituacaoExpediente {
  aberto: boolean
  // Fechado: o instante (ISO) em que o expediente reabre. Identifica a janela
  // fora do horário — a noite, o fim de semana, o feriado. Null quando aberto,
  // ou quando nada reabre nos próximos DIAS_BUSCA dias.
  proximaAbertura: string | null
  // Fechado: quando o expediente fechou (ISO). Atendente que escreveu depois
  // disso ainda está na conversa — o plantão não entra. Null quando aberto, ou
  // quando nada abriu nos últimos DIAS_BUSCA dias.
  fechadoDesde: string | null
}

// O seed de 20260701010500 e o default das colunas.
export const HORARIO_PADRAO: HorarioComercial = {
  timezone: 'America/Sao_Paulo',
  inicio: '08:00',
  fim: '18:00',
  dias: [1, 2, 3, 4, 5],
}

const DIAS_BUSCA = 14

interface DataLocal { ano: number; mes: number; dia: number }

export function situacaoExpediente(
  agoraISO: string,
  horario: HorarioComercial,
  feriados: FeriadoExpediente[],
): SituacaoExpediente {
  const agora = new Date(agoraISO)
  const inicio = minutos(horario.inicio)
  const fim = minutos(horario.fim)
  const dias = new Set(horario.dias.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))
  const ABERTO: SituacaoExpediente = { aberto: true, proximaAbertura: null, fechadoDesde: null }
  if (Number.isNaN(agora.getTime()) || inicio === null || fim === null || inicio >= fim || dias.size === 0) {
    return ABERTO
  }
  const tz = horario.timezone || HORARIO_PADRAO.timezone
  const porData = new Map(feriados.map((f) => [f.data, f]))
  const janelas = (d: DataLocal) => janelasDoDia(d, inicio, fim, dias, porData.get(chave(d)))

  const hoje = partesLocais(agora, tz)
  const agoraMin = hoje.minutos

  let proximaAbertura: string | null = null
  busca: for (let k = 0; k <= DIAS_BUSCA; k++) {
    const d = somarDias(hoje, k)
    for (const [ini, fi] of janelas(d)) {
      if (k === 0 && ini <= agoraMin && agoraMin < fi) return ABERTO
      if (k > 0 || ini > agoraMin) {
        proximaAbertura = instanteLocal(d, ini, tz).toISOString()
        break busca
      }
    }
  }

  let fechadoDesde: string | null = null
  busca: for (let k = 0; k >= -DIAS_BUSCA; k--) {
    const d = somarDias(hoje, k)
    for (const [, fi] of janelas(d).reverse()) {
      if (k < 0 || fi <= agoraMin) {
        fechadoDesde = instanteLocal(d, fi, tz).toISOString()
        break busca
      }
    }
  }

  return { aberto: false, proximaAbertura, fechadoDesde }
}

// "hoje, às 08h", "amanhã (sexta-feira, 23/10), às 08h",
// "segunda-feira, 26/10, às 08h30". Vai para o prompt: é o que a Maia diz
// quando o assunto fica para a equipe.
export function formatarRetornoEquipe(proximaAberturaISO: string, agoraISO: string, timezone: string): string {
  const tz = timezone || HORARIO_PADRAO.timezone
  const abre = new Date(proximaAberturaISO)
  const p = partesLocais(abre, tz)
  const h = Math.floor(p.minutos / 60)
  const m = p.minutos % 60
  const hora = `às ${String(h).padStart(2, '0')}h${m ? String(m).padStart(2, '0') : ''}`

  const hoje = partesLocais(new Date(agoraISO), tz)
  if (chave(p) === chave(hoje)) return `hoje, ${hora}`

  const semana = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: tz }).format(abre)
  const data = `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}`
  if (chave(p) === chave(somarDias(hoje, 1))) return `amanhã (${semana}, ${data}), ${hora}`
  return `${semana}, ${data}, ${hora}`
}

// Janelas abertas do dia, em minutos locais, já descontado o feriado.
function janelasDoDia(
  d: DataLocal,
  inicio: number,
  fim: number,
  dias: Set<number>,
  feriado: FeriadoExpediente | undefined,
): [number, number][] {
  if (!dias.has(diaSemanaISO(d))) return []
  if (!feriado) return [[inicio, fim]]
  const fIni = feriado.tipo === 'parcial' ? minutos(feriado.horario_inicio) : null
  const fFim = feriado.tipo === 'parcial' ? minutos(feriado.horario_fim) : null
  // Integral, ou parcial sem horário legível: o dia todo fechado.
  if (fIni === null || fFim === null || fIni >= fFim) return []
  const janelas: [number, number][] = []
  if (inicio < Math.min(fIni, fim)) janelas.push([inicio, Math.min(fIni, fim)])
  if (Math.max(fFim, inicio) < fim) janelas.push([Math.max(fFim, inicio), fim])
  return janelas
}

function minutos(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '')
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 24 || mi > 59) return null
  return h * 60 + mi
}

function partesLocais(data: Date, tz: string): DataLocal & { minutos: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(data).map((x) => [x.type, x.value]),
  )
  return {
    ano: Number(p.year), mes: Number(p.month), dia: Number(p.day),
    minutos: Number(p.hour) * 60 + Number(p.minute),
  }
}

// Data local + minutos → instante. O deslocamento do fuso é medido no próprio
// instante (duas passadas cobrem a virada de horário de verão).
function instanteLocal(d: DataLocal, min: number, tz: string): Date {
  const alvo = Date.UTC(d.ano, d.mes - 1, d.dia, Math.floor(min / 60), min % 60)
  let t = alvo
  for (let i = 0; i < 2; i++) {
    const p = partesLocais(new Date(t), tz)
    const visto = Date.UTC(p.ano, p.mes - 1, p.dia, Math.floor(p.minutos / 60), p.minutos % 60)
    t += alvo - visto
  }
  return new Date(t)
}

function somarDias(d: DataLocal, n: number): DataLocal {
  const x = new Date(Date.UTC(d.ano, d.mes - 1, d.dia + n))
  return { ano: x.getUTCFullYear(), mes: x.getUTCMonth() + 1, dia: x.getUTCDate() }
}

function diaSemanaISO(d: DataLocal): number {
  const w = new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay()
  return w === 0 ? 7 : w
}

function chave(d: DataLocal): string {
  return `${d.ano}-${String(d.mes).padStart(2, '0')}-${String(d.dia).padStart(2, '0')}`
}
