/**
 * Conferência de Guias — a regra da tela, sem React e sem banco.
 *
 * A pergunta que a Silvana responde, sessão a sessão: esta sessão ASSIM tem
 * (1) evolução escrita, (2) assinatura do responsável na folha da recepção e
 * (3) autorização liberada? As pernas (1) e (3) chegam prontas da RPC; a (2) é
 * a marcação dela.
 *
 * A FOLHA é a unidade da tela porque é a unidade do papel: uma por paciente por
 * semana, todas as terapias em ordem cronológica, 10 assinaturas por folha. Com
 * 12 sessões na semana o paciente tem a folha 1 (sessões 1–10) e a folha 2
 * (11–12) — e a tela mostra exatamente essa divisão, para ela bater a pilha
 * sem se perder.
 */

import { segundaDe } from '@/components/auditoria-assim/reconciliacao/datas'
import { dispositivoIndisponivel, temPapelParaConferir } from '@/components/auditoria-assim/situacoes'

export const ASSINATURAS_POR_FOLHA = 10

export type StatusConferencia = 'assinada' | 'sem_assinatura'
export type RiscoEvolucao = 'sem_risco' | 'risco_especifico' | 'risco_relevante'

/** Uma linha de `get_conferencia_guias_dia` — um bloco da Conferência ASSIM. */
export type SessaoConferencia = {
  bloco_id: string | null
  paciente_id: string
  paciente_nome: string | null
  carteirinha: string | null
  data_atendimento: string
  hora_inicial: string
  codigo_tuss: string | null
  terapias: string | null
  profissionais: string | null
  quantidade_sessoes: number | null
  guia: string | null
  status_assim: string | null
  situacao: string | null
  observacao: string | null
  data_atendimento_real: string | null
  grade_total: number
  grade_com_evolucao: number
  risco_evolucao: RiscoEvolucao | null
  status_conferencia: StatusConferencia | null
  conferido_por_nome: string | null
  conferido_em: string | null
  recepcao_avisada_em: string | null
  recepcao_avisada_por_nome: string | null
  observacao_conferencia: string | null
  /**
   * A guia que cobriu a sessão pela Reconciliação (vínculo ou substituição).
   * Existe porque `guia` é só o pareamento posicional: vazia na substituição e
   * a RECUSADA na glosa resolvida (20260924210000).
   */
  guia_vinculo: string | null
  tipo_vinculo: 'vinculo' | 'substituicao' | null
  /*
    Filipeta (20260924220000). Opcionais: antes de a migration rodar a RPC não
    os devolve, e a tela segue sem a indicação em vez de quebrar.
  */
  teve_token?: boolean | null
  token?: string | null
  biofacial?: string | null
  forma_autorizacao?: string | null
  /** O que a Conferência de Filipetas (Auditoria ASSIM) registrou. */
  filipeta_conferida?: boolean | null
  filipeta_conferida_por_nome?: string | null
  filipeta_conferida_em?: string | null
  /**
   * Falta lançada no controle (get_faltas_auditoria_assim). A recepção escreve
   * "falta" na linha do papel, então ela OCUPA uma linha da folha — sem ela a
   * numeração da tela descolaria da do papel —, mas não pede conferência.
   */
  falta?: TipoFalta | null
  motivo_falta?: string | null
  justificativa_falta?: string | null
}

export type TipoFalta = 'paciente' | 'terapeuta'

export type Filipeta = {
  /** O número do token; nulo quando o papel não tem número. */
  numero: string | null
  /** Por que saiu papel sem número. */
  motivo: 'token' | 'erro_facial' | 'dispositivo_indisponivel'
  conferida: boolean
}

/**
 * A sessão deixou filipeta? Pela MESMA régua da Conferência de Filipetas
 * (`temPapelParaConferir`), para as duas telas nunca discordarem sobre o
 * mesmo papel. Nulo = não há papel.
 */
export function filipetaDaSessao(s: SessaoConferencia): Filipeta | null {
  if (!temPapelParaConferir(s)) return null
  const numero = s.teve_token && s.token?.trim() ? s.token.trim() : null
  const motivo: Filipeta['motivo'] = s.teve_token
    ? 'token'
    : dispositivoIndisponivel(s.biofacial)
      ? 'dispositivo_indisponivel'
      : 'erro_facial'
  return { numero, motivo, conferida: Boolean(s.filipeta_conferida) }
}

/** A guia a bater contra o papel: a da cobertura, senão a da própria sessão. */
export function guiaDaSessao(s: Pick<SessaoConferencia, 'guia' | 'guia_vinculo' | 'situacao'>): string | null {
  if (s.guia_vinculo) return s.guia_vinculo
  // Sem vínculo lido, a `guia` da glosa resolvida é a recusada — melhor nada.
  if (s.situacao === 'GLOSA_RESOLVIDA') return null
  return estadoAutorizacao(s.situacao) === 'ok' ? s.guia : null
}

/** A identidade da sessão na tabela de conferência — nunca agenda_id. */
export type ChaveSessao = {
  paciente_id: number
  data_atendimento: string
  hora_inicial: string
  codigo_tuss: string
}

export function chaveDaSessao(s: SessaoConferencia): ChaveSessao {
  return {
    paciente_id: Number(s.paciente_id),
    data_atendimento: s.data_atendimento,
    hora_inicial: s.hora_inicial,
    codigo_tuss: s.codigo_tuss ?? '',
  }
}

/** Chave em texto, para Map/Set e `key` do React. */
export function idDaSessao(s: SessaoConferencia): string {
  const c = chaveDaSessao(s)
  return `${c.paciente_id}|${c.data_atendimento}|${c.hora_inicial}|${c.codigo_tuss}`
}

// ── As pernas automáticas ─────────────────────────────────────────────────────

export type EstadoAutorizacao = 'ok' | 'recusada' | 'pendente'

/**
 * A autorização pela MESMA `situacao` da Conferência ASSIM — que já chega com
 * o vínculo da Reconciliação aplicado (get_auditoria_assim_periodo). Ler o
 * status cru da ASSIM aqui faria esta tela mandar avisar a recepção de uma glosa
 * que a Reconciliação já cobriu.
 *
 * `CANCELADA` é `Liberado *`, a liberação que a ASSIM desfez: pede autorização
 * nova, então não é "ok". Tudo o que não é resposta (não solicitada, retorno não
 * confirmado, sincronizando) é pendente.
 */
export function estadoAutorizacao(situacao: string | null): EstadoAutorizacao {
  if (situacao === 'LIBERADA' || situacao === 'GLOSA_RESOLVIDA') return 'ok'
  if (situacao === 'GLOSA' || situacao === 'CANCELADA') return 'recusada'
  return 'pendente'
}

export type EstadoEvolucao = 'ok' | 'parcial' | 'ausente' | 'sem_grade'

/**
 * Evolução pela grade do TiTa no mesmo paciente + data + hora. `parcial` é a
 * sessão com dois profissionais em que só um escreveu. `sem_grade` é a sessão
 * que a grade não tem — não é "falta evolução", é "não há onde procurar".
 */
export function estadoEvolucao(s: Pick<SessaoConferencia, 'grade_total' | 'grade_com_evolucao'>): EstadoEvolucao {
  if (s.grade_total === 0) return 'sem_grade'
  if (s.grade_com_evolucao === 0) return 'ausente'
  if (s.grade_com_evolucao < s.grade_total) return 'parcial'
  return 'ok'
}

// ── Tempo ────────────────────────────────────────────────────────────────────

/**
 * Sessão que ainda não aconteceu. Ela aparece na folha (a folha é da semana),
 * mas não conta como pendência nem como divergência: não há assinatura a
 * conferir antes de o paciente vir.
 */
export function ehFutura(s: Pick<SessaoConferencia, 'data_atendimento' | 'hora_inicial'>, agora: Date): boolean {
  const [ano, mes, dia] = s.data_atendimento.split('-').map(Number)
  const [h, m] = s.hora_inicial.split(':').map(Number)
  const inicio = new Date(ano, (mes ?? 1) - 1, dia ?? 1, h ?? 0, m ?? 0)
  return inicio.getTime() > agora.getTime()
}

// ── Divergências ─────────────────────────────────────────────────────────────

export type Divergencia = 'sem_assinatura' | 'sem_autorizacao' | 'sem_evolucao'

/**
 * O que está errado na sessão. As duas primeiras são da RECEPÇÃO (ela avisa
 * presencialmente); a terceira é do terapeuta e só se mostra.
 */
export function divergenciasDa(s: SessaoConferencia, agora: Date): Divergencia[] {
  // Falta não tem autorização, evolução nem assinatura a cobrar.
  if (s.falta || ehFutura(s, agora)) return []
  const lista: Divergencia[] = []
  if (s.status_conferencia === 'sem_assinatura') lista.push('sem_assinatura')
  if (estadoAutorizacao(s.situacao) !== 'ok') lista.push('sem_autorizacao')
  const evo = estadoEvolucao(s)
  if (evo === 'ausente' || evo === 'parcial') lista.push('sem_evolucao')
  return lista
}

export function pedeAvisoARecepcao(divergencias: Divergencia[]): boolean {
  return divergencias.includes('sem_assinatura') || divergencias.includes('sem_autorizacao')
}

/**
 * O que ainda pede a Silvana. Avisada a recepção, assinatura e autorização
 * saem da conta dela (a linha passa a estar "com a recepção"); a evolução não
 * sai, porque o aviso não a resolve.
 */
export function divergenciasEmAberto(l: Pick<LinhaFolha, 'divergencias' | 'sessao'>): Divergencia[] {
  if (!l.sessao.recepcao_avisada_em) return l.divergencias
  return l.divergencias.filter((d) => d === 'sem_evolucao')
}

/** Avisada e ainda com problema da recepção: a bola está com ela. */
export function estaComARecepcao(l: Pick<LinhaFolha, 'divergencias' | 'sessao'>): boolean {
  return Boolean(l.sessao.recepcao_avisada_em) && pedeAvisoARecepcao(l.divergencias)
}

/** Já passou e ainda não foi marcada (nem assinada, nem sem assinatura). */
export function ehPendente(s: SessaoConferencia, agora: Date): boolean {
  return !s.falta && !ehFutura(s, agora) && s.status_conferencia === null
}

/** A linha que pede a conferência dela: já aconteceu e não é falta. */
export function pedeConferencia(l: Pick<LinhaFolha, 'futura' | 'falta'>): boolean {
  return !l.futura && !l.falta
}

// ── Folhas ───────────────────────────────────────────────────────────────────

export type SituacaoFolha = 'pendente' | 'divergente' | 'recepcao' | 'conferida' | 'futura'

export type LinhaFolha = {
  /** 1–10: a linha da assinatura no papel. */
  linha: number
  sessao: SessaoConferencia
  futura: boolean
  /** Linha em que a recepção escreveu "falta": numerada, mas sem ação. */
  falta: TipoFalta | null
  divergencias: Divergencia[]
}

export type Folha = {
  id: string
  paciente_id: string
  paciente_nome: string
  carteirinha: string | null
  /** Segunda-feira da semana da folha. Semana nova é sempre folha nova. */
  semana: string
  numero: number
  totalFolhas: number
  linhas: LinhaFolha[]
  pendentes: number
  /** Linhas com problema que ainda pede a Silvana (ver `divergenciasEmAberto`). */
  divergentes: number
  /** Linhas avisadas à recepção e ainda sem solução. */
  comRecepcao: number
  /** Divergências da recepção ainda sem aviso registrado. */
  semAviso: number
  conferidas: number
  /** Sessões que já aconteceram (as futuras e as faltas não entram na conta). */
  realizadas: number
  faltas: number
  situacao: SituacaoFolha
}

function compararSessao(a: SessaoConferencia, b: SessaoConferencia): number {
  return (
    a.data_atendimento.localeCompare(b.data_atendimento) ||
    a.hora_inicial.localeCompare(b.hora_inicial) ||
    (a.codigo_tuss ?? '').localeCompare(b.codigo_tuss ?? '')
  )
}

function compararNome(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
}

/**
 * Agrupa por paciente E semana, ordena cronologicamente e corta em folhas de 10.
 *
 * Por `paciente_id`, não por nome: dois pacientes podem ter o mesmo nome e o
 * nome da ASSIM chega truncado. Por semana porque o papel é semanal — na
 * quinzena o paciente tem as folhas das duas semanas, nunca uma folha que
 * atravessa a virada. A ordem final é alfabética (a ordem da pilha de papel na
 * recepção) e, dentro do paciente, cronológica.
 */
export function montarFolhas(sessoes: SessaoConferencia[], agora: Date): Folha[] {
  const grupos = new Map<string, { pacienteId: string; semana: string; lista: SessaoConferencia[] }>()
  for (const s of sessoes) {
    const semana = segundaDe(s.data_atendimento)
    const k = `${s.paciente_id}|${semana}`
    const g = grupos.get(k)
    if (g) g.lista.push(s)
    else grupos.set(k, { pacienteId: s.paciente_id, semana, lista: [s] })
  }

  const folhas: Folha[] = []
  for (const { pacienteId, semana, lista } of grupos.values()) {
    const ordenadas = [...lista].sort(compararSessao)
    const totalFolhas = Math.ceil(ordenadas.length / ASSINATURAS_POR_FOLHA)
    const nome = ordenadas.find((s) => s.paciente_nome)?.paciente_nome ?? `Paciente ${pacienteId}`
    const carteirinha = ordenadas.find((s) => s.carteirinha)?.carteirinha ?? null

    for (let f = 0; f < totalFolhas; f++) {
      const fatia = ordenadas.slice(f * ASSINATURAS_POR_FOLHA, (f + 1) * ASSINATURAS_POR_FOLHA)
      const linhas: LinhaFolha[] = fatia.map((sessao, i) => ({
        linha: i + 1,
        sessao,
        futura: ehFutura(sessao, agora),
        falta: sessao.falta ?? null,
        divergencias: divergenciasDa(sessao, agora),
      }))
      const realizadas = linhas.filter(pedeConferencia)
      const faltas = linhas.filter((l) => l.falta).length
      const pendentes = realizadas.filter((l) => l.sessao.status_conferencia === null).length
      const divergentes = realizadas.filter((l) => divergenciasEmAberto(l).length > 0).length
      const comRecepcao = realizadas.filter(estaComARecepcao).length
      const semAviso = realizadas.filter(
        (l) => pedeAvisoARecepcao(l.divergencias) && !l.sessao.recepcao_avisada_em
      ).length
      const conferidas = realizadas.length - pendentes

      let situacao: SituacaoFolha
      // Só faltas (e nada por vir) não deixa nada a conferir.
      if (realizadas.length === 0) situacao = linhas.some((l) => l.futura && !l.falta) ? 'futura' : 'conferida'
      else if (pendentes > 0) situacao = 'pendente'
      else if (divergentes > 0) situacao = 'divergente'
      else if (comRecepcao > 0) situacao = 'recepcao'
      else situacao = 'conferida'

      folhas.push({
        id: `${pacienteId}#${semana}#${f + 1}`,
        paciente_id: pacienteId,
        paciente_nome: nome,
        carteirinha,
        semana,
        numero: f + 1,
        totalFolhas,
        linhas,
        pendentes,
        divergentes,
        comRecepcao,
        semAviso,
        conferidas,
        realizadas: realizadas.length,
        faltas,
        situacao,
      })
    }
  }

  return folhas.sort(
    (a, b) =>
      compararNome(a.paciente_nome, b.paciente_nome) ||
      a.paciente_id.localeCompare(b.paciente_id) ||
      a.semana.localeCompare(b.semana) ||
      a.numero - b.numero
  )
}

// ── Abas ─────────────────────────────────────────────────────────────────────

export type Aba = 'pendentes' | 'divergencias' | 'recepcao' | 'conferidas' | 'todas'

/**
 * Uma folha pode estar em "Pendentes" e em "Divergências" ao mesmo tempo (tem
 * linha por marcar E linha com problema) — as abas são perguntas, não partição.
 */
export function folhaNaAba(folha: Folha, aba: Aba): boolean {
  switch (aba) {
    case 'pendentes':
      return folha.pendentes > 0
    case 'divergencias':
      return folha.divergentes > 0
    case 'recepcao':
      return folha.comRecepcao > 0
    case 'conferidas':
      return folha.realizadas > 0 && folha.pendentes === 0
    case 'todas':
      return true
  }
}

// ── O paciente na fila ───────────────────────────────────────────────────────

/**
 * As folhas de um paciente numa semana. A fila mostra o paciente UMA vez — com
 * 12 sessões ele tem duas folhas, mas continua sendo um nome na pilha — e a
 * troca entre folha 1 e 2 fica no próprio papel.
 */
export type GrupoFolhas = {
  id: string
  paciente_nome: string
  semana: string
  folhas: Folha[]
}

export function grupoDaFolha(f: Pick<Folha, 'paciente_id' | 'semana'>): string {
  return `${f.paciente_id}#${f.semana}`
}

/** Mantém a ordem de `montarFolhas` (as folhas do mesmo grupo já vêm juntas). */
export function agruparFolhas(folhas: Folha[]): GrupoFolhas[] {
  const grupos = new Map<string, GrupoFolhas>()
  for (const f of folhas) {
    const id = grupoDaFolha(f)
    const g = grupos.get(id)
    if (g) g.folhas.push(f)
    else grupos.set(id, { id, paciente_nome: f.paciente_nome, semana: f.semana, folhas: [f] })
  }
  return [...grupos.values()]
}

/**
 * O paciente está na aba se alguma folha dele está — menos em "Prontas", que
 * só vale quando TODAS as folhas estão: folha 1 pronta com a 2 por marcar não
 * é paciente pronto.
 */
export function grupoNaAba(g: GrupoFolhas, aba: Aba): boolean {
  if (aba === 'conferidas') return g.folhas.some((f) => f.realizadas > 0) && g.folhas.every((f) => f.pendentes === 0)
  return g.folhas.some((f) => folhaNaAba(f, aba))
}

/** A contagem das abas em PACIENTES (o que a fila mostra), não em folhas. */
export function contarAbas(folhas: Folha[]): Record<Aba, number> {
  const grupos = agruparFolhas(folhas)
  const contar = (aba: Aba) => grupos.filter((g) => grupoNaAba(g, aba)).length
  return {
    pendentes: contar('pendentes'),
    divergencias: contar('divergencias'),
    recepcao: contar('recepcao'),
    conferidas: contar('conferidas'),
    todas: grupos.length,
  }
}

/** Progresso da semana em SESSÕES já realizadas — o que falta marcar. */
export function progresso(folhas: Folha[]): { conferidas: number; realizadas: number } {
  let conferidas = 0
  let realizadas = 0
  for (const f of folhas) {
    conferidas += f.conferidas
    realizadas += f.realizadas
  }
  return { conferidas, realizadas }
}

/** Busca sem acento e sem caixa ("maite" acha "Maitê"). */
export function normalizarBusca(v: string): string {
  return v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

// ── O que a folha diz em palavras ────────────────────────────────────────────

const ROTULO_AUTORIZACAO: Record<string, string> = {
  GLOSA: 'Glosa da ASSIM',
  CANCELADA: 'Autorização cancelada pela ASSIM',
  NAO_SOLICITADA: 'Autorização não solicitada',
  SOLICITACAO_CANCELADA: 'Solicitação cancelada',
  RETORNO_NAO_CONFIRMADO: 'ASSIM ainda não confirmou',
  AGUARDANDO_RETORNO: 'ASSIM ainda não confirmou',
  SINCRONIZANDO: 'Autorização sincronizando',
}

export type AvisoLinha = { texto: string; tom: 'problema' | 'atencao' | 'neutro' }

/**
 * O texto curto sob a terapia: só a autorização, e só quando ela não está em
 * ordem. A evolução tem indicador próprio em toda linha (`EvolucaoDaLinha`) e
 * a assinatura está desenhada na própria linha.
 */
export function avisosDaLinha(s: SessaoConferencia, futura: boolean): AvisoLinha[] {
  if (futura || estadoAutorizacao(s.situacao) === 'ok') return []
  return [{ texto: ROTULO_AUTORIZACAO[s.situacao ?? ''] ?? 'Sem autorização liberada', tom: 'problema' }]
}

export type Ponto = 'assinada' | 'sem_assinatura' | 'pendente' | 'futura' | 'falta'

/** A tirinha de 10 tracinhos: a folha em miniatura, linha por linha. */
export function pontosDaFolha(folha: Folha): Ponto[] {
  return folha.linhas.map((l) =>
    l.falta ? 'falta' : l.futura ? 'futura' : l.sessao.status_conferencia ?? 'pendente'
  )
}

export type TomResumo = 'pendente' | 'problema' | 'recepcao' | 'pronta' | 'futura'

/**
 * "3 a conferir", "1 problema", "1 com a recepção", "Pronta" — o resumo que a
 * fila mostra. Por padrão o que falta marcar vem primeiro; na aba de problemas
 * (ou da recepção) o resumo responde à pergunta da aba, senão a folha estaria
 * lá dizendo outra coisa.
 */
export function resumoDaFolha(
  folha: Pick<Folha, 'situacao' | 'pendentes' | 'divergentes' | 'comRecepcao'>,
  foco: Aba = 'pendentes'
): { texto: string; tom: TomResumo } {
  if (folha.situacao === 'futura') return { texto: 'Ainda vai acontecer', tom: 'futura' }
  const pendente = folha.pendentes > 0 ? { texto: `${folha.pendentes} a conferir`, tom: 'pendente' as const } : null
  const problema =
    folha.divergentes > 0
      ? { texto: folha.divergentes === 1 ? '1 problema' : `${folha.divergentes} problemas`, tom: 'problema' as const }
      : null
  const recepcao = folha.comRecepcao > 0 ? { texto: `${folha.comRecepcao} com a recepção`, tom: 'recepcao' as const } : null
  const ordem =
    foco === 'divergencias'
      ? [problema, pendente, recepcao]
      : foco === 'recepcao'
        ? [recepcao, problema, pendente]
        : [pendente, problema, recepcao]
  return ordem.find(Boolean) ?? { texto: 'Pronta', tom: 'pronta' }
}

/** O resumo do paciente na fila: as folhas dele somadas. */
export function resumoDoGrupo(g: GrupoFolhas, foco: Aba = 'pendentes'): { texto: string; tom: TomResumo } {
  const soma = (k: 'pendentes' | 'divergentes' | 'comRecepcao' | 'realizadas' | 'faltas') =>
    g.folhas.reduce((n, f) => n + f[k], 0)
  // Faltou a semana toda: "Pronta" diria que ela conferiu algo.
  if (soma('realizadas') === 0 && soma('faltas') > 0 && g.folhas.every((f) => f.situacao !== 'futura')) {
    return { texto: 'Só faltas', tom: 'futura' }
  }
  return resumoDaFolha(
    {
      situacao: g.folhas.every((f) => f.situacao === 'futura') ? 'futura' : 'pendente',
      pendentes: soma('pendentes'),
      divergentes: soma('divergentes'),
      comRecepcao: soma('comRecepcao'),
    },
    foco
  )
}
