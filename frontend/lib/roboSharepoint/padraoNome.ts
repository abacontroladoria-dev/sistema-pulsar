// Padrão de nome dos arquivos do PEP — a MESMA regra de
// public.sp_pep_ler_nome_padrao e public.sp_pep_nomes_compativeis
// (migrations 20261002100000 e 20261014100000). Serve ao PDF por prestador
// quando o banco ainda não gravou sp_pep_itens.padrao, e ao lançamento manual
// da tela PEP (o caminho digitado não passa pelo robô).
//
//   Geral ........ SIGLA-NN-MMAAAA              STC-01-092026
//   Paciente ..... SIGLA-PACIENTE-MMAAAA        PIC-JOAO SILVA-092026
//   TAP .......... TAP-NN-PACIENTE-MMAAAA       TAP-01-JOAO SILVA-092026
//   Reprogramação  REP-SIGLA-PACIENTE-MMAAAA    REP-PIC-JOAO SILVA-092026

export type NomePadrao = {
  ok: boolean
  rep: boolean
  sigla?: string
  seq?: string | null
  paciente?: string | null
  competencia?: string
  erro?: string | null
}

const MES = '(0[1-9]|1[0-2])(20[0-9]{2})'
const SIGLAS = ['STC', 'ETC', 'TAP', 'TOP', 'PIC', 'RT', 'OE', 'REP']

export function lerNomePadrao(nome: string, siglaDaPasta: string | null | undefined, tipoRegistro: 'GERAL' | 'POR_PACIENTE' | null | undefined): NomePadrao {
  const s = (siglaDaPasta ?? '').toUpperCase()
  const b = nome.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/\s*[-–—]\s*/g, '-').trim()
  const comp = (m: RegExpMatchArray, i: number) => `${m[i + 1]}-${m[i]}`

  let m = b.match(new RegExp(`^REP-(PIC|RT|OE)-(.+)-${MES}$`, 'i'))
  if (m) {
    const sig = m[1].toUpperCase()
    return { ok: false, rep: sig === s, sigla: sig, seq: null, paciente: m[2].trim(), competencia: comp(m, 3), erro: sig === s ? null : 'sigla_diferente_da_pasta' }
  }
  if (tipoRegistro === 'GERAL') {
    m = b.match(new RegExp(`^(STC|ETC)-([0-9]{2})-${MES}$`, 'i'))
    if (m) {
      const sig = m[1].toUpperCase()
      return { ok: sig === s, rep: false, sigla: sig, seq: m[2], paciente: null, competencia: comp(m, 3), erro: sig === s ? null : 'sigla_diferente_da_pasta' }
    }
    if (new RegExp(`^(STC|ETC)-[0-9]-${MES}$`, 'i').test(b)) return { ok: false, rep: false, erro: 'sequencial_com_dois_digitos' }
    if (new RegExp(`^(STC|ETC)-${MES}$`, 'i').test(b)) return { ok: false, rep: false, erro: 'geral_sem_sequencial' }
  } else if (s === 'TAP') {
    m = b.match(new RegExp(`^TAP-([0-9]{2})-(.+)-${MES}$`, 'i'))
    if (m) return { ok: true, rep: false, sigla: 'TAP', seq: m[1], paciente: m[2].trim(), competencia: comp(m, 3), erro: null }
    if (new RegExp(`^TAP-[0-9]-(.+)-${MES}$`, 'i').test(b)) return { ok: false, rep: false, erro: 'sequencial_com_dois_digitos' }
    if (new RegExp(`^TAP-(.+)-${MES}$`, 'i').test(b)) return { ok: false, rep: false, erro: 'tap_sem_sequencial' }
  } else {
    // Só o TAP leva número: "TOP-01-JOAO-092026" casaria abaixo com o paciente "01-JOAO".
    m = b.match(new RegExp(`^(TOP|PIC|RT|OE)-[0-9]{1,2}-(.+)-${MES}$`, 'i'))
    if (m && m[1].toUpperCase() === s) return { ok: false, rep: false, erro: 'sequencial_nao_esperado' }
    m = b.match(new RegExp(`^(TAP|TOP|PIC|RT|OE)-(.+)-${MES}$`, 'i'))
    if (m) {
      const sig = m[1].toUpperCase()
      return { ok: sig === s, rep: false, sigla: sig, seq: null, paciente: m[2].trim(), competencia: comp(m, 3), erro: sig === s ? null : 'sigla_diferente_da_pasta' }
    }
  }
  const t1 = b.split('-')[0].toUpperCase()
  if (SIGLAS.includes(t1)) {
    if (t1 !== s && t1 !== 'REP') return { ok: false, rep: false, erro: 'sigla_diferente_da_pasta' }
    if (/(\s*\([0-9]+\)|-c[oó]pia(\s*\([0-9]+\))?)$/i.test(b)) return { ok: false, rep: false, erro: 'copia_com_sufixo' }
    if (/(0[1-9]|1[0-2])[-_. /](20[0-9]{2})$/.test(b)) return { ok: false, rep: false, erro: 'mes_com_separador' }
    if (!new RegExp(`${MES}$`).test(b)) return { ok: false, rep: false, erro: 'sem_competencia' }
  }
  return { ok: false, rep: false, erro: 'formato_desconhecido' }
}

/** public.normalizar_nome_paciente: sem acento, sem pontuação, minúsculo, espaço único. */
export function normalizarNome(n: string | null | undefined): string {
  return (n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').toLowerCase().replace(/\s+/g, ' ').trim()
}

const LIGA = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

/** public.sp_pep_nomes_compativeis: 1º nome igual e 2/3 das palavras do menor no maior. */
export function nomesCompativeis(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizarNome(a), nb = normalizarNome(b)
  if (!na || !nb) return false
  const ta = new Set(na.split(' ').filter(t => t.length >= 2 && !LIGA.has(t)))
  const tb = new Set(nb.split(' ').filter(t => t.length >= 2 && !LIGA.has(t)))
  if (ta.size === 0 || tb.size === 0) return false
  if (na.split(' ')[0] !== nb.split(' ')[0]) return false
  const comuns = [...ta].filter(t => tb.has(t)).length
  return comuns >= Math.ceil((Math.min(ta.size, tb.size) * 2) / 3)
}

/** "https://…/Pacientes/Joao/PIC-JOAO-092026.pdf" → "PIC-JOAO-092026.pdf" (sem %20). */
export function nomeDoArquivo(caminho: string | null | undefined): string {
  const ultimo = (caminho ?? '').split(/[?#]/)[0].split(/[\\/]/).filter(Boolean).pop() ?? ''
  try { return decodeURIComponent(ultimo).trim() } catch { return ultimo.trim() }
}

export type ConferenciaNome =
  | { situacao: 'ok' }
  | { situacao: 'rep' }
  | { situacao: 'fora'; motivo: string }

/**
 * O nome inteiro, como o banco confere em sp_pep_aplicar_padrao: o formato
 * (lerNomePadrao) e, nos itens por paciente, o paciente do nome contra o do
 * registro. Não vê repetidos — isso depende das outras evidências da pasta.
 */
export function conferirNome(
  nome: string,
  sigla: string | null | undefined,
  tipoRegistro: 'GERAL' | 'POR_PACIENTE' | null | undefined,
  pacienteNome: string | null | undefined,
): ConferenciaNome {
  const lido = lerNomePadrao(nome, sigla, tipoRegistro)
  if (lido.rep) return { situacao: 'rep' }
  if (!lido.ok) return { situacao: 'fora', motivo: lido.erro ?? 'formato_desconhecido' }
  if (tipoRegistro === 'POR_PACIENTE' && pacienteNome && !nomesCompativeis(lido.paciente, pacienteNome)) {
    return { situacao: 'fora', motivo: 'paciente_diferente_da_pasta' }
  }
  return { situacao: 'ok' }
}
