// Painel de Entrada de Pacientes de Convênio (Leve, ASSIM, FUSEx).
//
// O Pulsar NÃO calcula as etapas. A tarefa agendada do claude.ai (conta da
// Carol) lê o ClickUp, roda o calc.py do pacote de implantação (fluxo v4,
// 09/10/2026) e grava o resultado num Doc do ClickUp; a Edge Function
// painel-entrada-convenio copia para public.painel_entrada_convenio_snapshots.
// Este módulo só tipa esse JSON e reproduz os filtros e ordenações do HTML
// original do pacote (Painel_Entrada_Pacientes_v1.html).
//
// Módulo puro, sem import de valor: roda igual na tela e no teste.

// ─── Forma do painel.json (chave "dados") ────────────────────────────────────

export type StatusPrazo = "atrasado" | "vence hoje" | "no prazo" | "sem dado" | "fora de ordem"
export type Situacao = "em andamento" | "concluído" | "encerrado"

export interface EtapaAtual {
  etapa: string
  nome: string
  setor: string
  prazo: number
  dias: number | null
  status: StatusPrazo
  /** Observação do calc (ex.: regra da Leve na etapa 6, entrevista marcada). */
  obs?: string
  /** Etapas cumpridas sem data registrada no ClickUp. */
  sem_registro?: string[]
  /** Pendência administrativa escrita pela tarefa (pode trocar o setor). */
  pendencia?: string
}

/**
 * Aviso de registro. Hoje a tarefa grava texto; aceita também o formato
 * estruturado ({ texto, resolvido }) caso o prompt passe a separar o que já foi
 * corrigido do que ainda está pendente.
 */
export type AlertaRegistro = string | { texto: string; resolvido?: boolean }

export interface EtapaHistorico {
  etapa: string
  nome: string
  setor: string
  prazo: number
  dias: number | null
  status: StatusPrazo
  fim: string
  /** Várias etapas fechadas de uma vez (as do meio sem data). */
  combinado: boolean
}

export interface PacienteEntrada {
  paciente: string
  convenio: string
  tipo: string
  rota: string
  entrada: string | null
  aberto: string | null
  links?: Record<string, string> | null
  alertas?: AlertaRegistro[] | null
  encerrado?: { data: string; motivo: string } | null
  inicio: string | null
  inicio_previsto: string | null
  apresentacao: string | null
  situacao: Situacao
  atual: EtapaAtual | null
  historico: EtapaHistorico[]
  total_uteis: number | null
  dias_desde_entrada: number | null
}

export interface ResumoEntrada {
  em_andamento: number
  atrasados: number
  vence_hoje: number
  no_prazo: number
  novas_5du: number
  para_apresentar: number
  para_iniciar: number
  iniciados: number
  avaliacoes_feitas: number
  encerrados: number
  sem_formulario: number
  meta_total_uteis: number
  mediana_total_uteis: number | null
}

export interface EtapaResumo {
  etapa: string
  nome: string
  setor: string
  prazo: number
  n: number
  mediana: number | null
  pct_no_prazo: number | null
  em_aberto: number
}

export interface DadosPainel {
  gerado_em: string
  versao_fluxo: number
  resumo: ResumoEntrada
  setores: Record<string, { total: number; atrasados: number }>
  etapas: EtapaResumo[]
  pacientes: PacienteEntrada[]
}

// ─── Resposta da rota /api/indicadores/entrada-convenio ──────────────────────

export type EstadoDisponibilidade =
  | "sem_cadastro"
  | "nome_ambiguo"
  | "sem_cpf"
  | "nao_preenchida"
  | "preenchida_familia"
  | "preenchida_equipe"

export interface DisponibilidadePainel {
  nome: string
  paciente_id: number | null
  estado: EstadoDisponibilidade
  /** 'inicio_do_nome': o cadastro foi achado porque o nome do ClickUp é só o começo do nome dele; vale conferir. */
  casamento?: "exato" | "inicio_do_nome" | null
  preenchida_em: string | null
}

export const AVISO_INICIO_DO_NOME =
  "Cadastro achado pelo começo do nome (o nome no ClickUp está incompleto). Confira se é a mesma criança e complete o nome no ClickUp."

export interface LeituraPainel {
  lido_em: string
  status: "novo" | "sem_mudanca" | "erro" | "ignorado"
  erro: string | null
}

export interface PainelEntradaResposta {
  snapshot: {
    id: number
    gerado_em: string
    publicado_em: string | null
    lido_em: string
    versao_fluxo: number
    dados: DadosPainel
  } | null
  dias_uteis_atras?: number
  desatualizado?: boolean
  ultima_leitura: LeituraPainel | null
  disponibilidade: DisponibilidadePainel[]
  /** Prazos do Pulsar já aplicados em `snapshot.dados`. Ausente/instalado=false: valem os do calc. */
  prazos?: { instalado: boolean; vigentes: PrazoVigente[] }
}

// ─── Prazos (tabela painel_entrada_convenio_prazos) ──────────────────────────

export interface PrazoVigente {
  etapa: string
  nome: string
  prazo: number
  prazo_padrao: number
  atualizado_em: string | null
}

export type MapaPrazos = Record<string, number>

export interface ContagemAgora { atrasados: number; vence_hoje: number; no_prazo: number }

export interface MudancaStatus {
  paciente: string
  onde: "atual" | "histórico"
  etapa: string
  de: StatusPrazo
  para: StatusPrazo
}

/** Efeito de uma alteração de prazo sobre a última rodada (vai para o histórico). */
export interface ImpactoPrazo {
  snapshot_gerado_em: string | null
  etapa: string
  mediana: number | null
  n: number
  pct_no_prazo_antes: number | null
  pct_no_prazo_depois: number | null
  meta_antes: number
  meta_depois: number
  agora_antes: ContagemAgora
  agora_depois: ContagemAgora
  mudancas: MudancaStatus[]
}

export interface AlteracaoPrazo {
  id: number
  etapa: string
  etapa_nome: string
  prazo_anterior: number
  prazo_novo: number
  prazo_padrao: number
  meta_anterior: number
  meta_nova: number
  motivo: string
  usuario_id: string
  usuario_nome: string | null
  usuario_email: string | null
  usuario_role: string
  alterado_em: string
  alterado_em_brasilia: string
  resumo: string
  impacto: Partial<ImpactoPrazo> | null
  prazos_vigentes: MapaPrazos
}

export interface PrazosResposta {
  instalado: boolean
  vigentes: PrazoVigente[]
  historico: AlteracaoPrazo[]
  podeAlterar: boolean
  motivoBloqueio: string | null
  /** Localhost sem login (DISABLE_AUTH): mostra o editor, mas não salva. */
  semLogin: boolean
}

/** Prazos do calc.py (fluxo v4, 09/10/2026). Meta ponta a ponta = soma = 19. */
export const PRAZOS_PADRAO: MapaPrazos = { E0: 0, E1: 1, E2: 1, E3: 5, E4: 5, E5: 1, E6: 1, E7: 5 }

export const PRAZO_MAXIMO = 60
export const MOTIVO_MINIMO = 10

export const ROTULO_ROLE: Record<string, string> = { admin: "Admin", diretoria: "Direção" }

// ─── Textos fixos ────────────────────────────────────────────────────────────

export const SETOR_FAMILIA = "Família"

export interface Responsavel {
  /** Quem cobrar, em fonte normal no cabeçalho do bloco. Vazio = ninguém da equipe. */
  pessoas: string
  /** O que o setor faz neste fluxo, numa frase. */
  faz: string
}

/** Quem responde por cada setor (Handoff, seção 3). */
export const RESPONSAVEIS: Record<string, Responsavel> = {
  "Autorização": { pessoas: "Victoria F.", faz: "Elegibilidade e autorização da operadora" },
  "Comercial": { pessoas: "Jennifer G. e Aída R.", faz: "Agenda a entrevista com a família" },
  "Terapêutico": {
    pessoas: "Júlia S. (Realengo), Marcelle V. (Fazendinha) e Nathália M. (Padre Miguel)",
    faz: "Entrevista, avaliação e 1ª sessão",
  },
  "Cronograma": { pessoas: "Victoria F.", faz: "Monta e apresenta o cronograma à família" },
  [SETOR_FAMILIA]: { pessoas: "", faz: "Não depende da equipe: acompanhar o retorno do responsável" },
}

export function responsavelDo(setor: string): Responsavel {
  return RESPONSAVEIS[setor] ?? { pessoas: "", faz: "" }
}

export const ROTULO_LINK: Record<string, string> = { aut: "Autorização", crm: "CRM", crono: "Cronograma", chat: "Chat" }

/** Canal do Chat de autorização no ClickUp (workspace 9011600909), de onde vêm os pedidos sem formulário. */
export const CANAL_CHAT_AUTORIZACAO = {
  chave: "chat",
  rotulo: "Chat",
  id: "8cj47gd-16071",
  url: "https://app.clickup.com/9011600909/chat/r/8cj47gd-16071",
} as const

/** O que fazer em cada etapa (verbo) e qual tarefa do ClickUp abrir para isso. */
export const ACAO_POR_ETAPA: Record<string, { acao: string; link: string }> = {
  E0: { acao: "Abrir o formulário em Solicitações Autorização", link: "aut" },
  E1: { acao: "Checar a elegibilidade na operadora", link: "aut" },
  E2: { acao: "Agendar a entrevista com a família", link: "crm" },
  E3: { acao: "Fazer a entrevista", link: "crm" },
  E4: { acao: "Montar o cronograma", link: "crono" },
  E5: { acao: "Apresentar o cronograma e obter o aceite da família", link: "crono" },
  E6: { acao: "Pedir a autorização à operadora", link: "aut" },
  E7: { acao: "Confirmar a 1ª sessão e marcar \"Cronograma iniciado\"", link: "crono" },
}

/** Etapas em que a disponibilidade da família importa (agendar → montar cronograma). */
export const ETAPAS_DISPONIBILIDADE = new Set(["E2", "E3", "E4"])

export const ROTULO_DISPONIBILIDADE: Record<EstadoDisponibilidade, { rotulo: string; dica: string }> = {
  preenchida_familia: { rotulo: "Disponibilidade enviada", dica: "A família preencheu o formulário do Pulsar." },
  preenchida_equipe: { rotulo: "Disponibilidade lançada", dica: "A equipe lançou a disponibilidade no cadastro." },
  nao_preenchida: { rotulo: "Disponibilidade pendente", dica: "Cadastro com CPF: a família já pode usar o link." },
  sem_cpf: { rotulo: "Cadastro sem CPF", dica: "O formulário acha a criança pelo CPF. Complete o CPF no cadastro antes de mandar o link." },
  sem_cadastro: { rotulo: "Sem cadastro no Pulsar", dica: "Nenhum paciente ativo com esse nome completo. O link só funciona depois do cadastro (com CPF)." },
  nome_ambiguo: { rotulo: "Nome repetido no cadastro", dica: "Mais de um paciente ativo com esse nome. Confira no cadastro." },
}

// ─── Formatação ──────────────────────────────────────────────────────────────

/** "2026-10-08" → "08/10". "?" e vazio = "sem data" (etapa cumprida sem registro). */
export function fmtDiaMes(iso: string | null | undefined): string {
  return iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "sem data"
}

/** Instante ISO → "09/10 às 07:52" no horário de Brasília. */
export function fmtDataHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "sem data"
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d)
  const get = (tipo: string) => partes.find(x => x.type === tipo)?.value ?? ""
  return `${get("day")}/${get("month")} às ${get("hour")}:${get("minute")}`
}

export function linkClickUp(taskId: string): string {
  return `https://app.clickup.com/t/${encodeURIComponent(taskId)}`
}

export function linkCanalClickUp(channelId: string): string {
  return `https://app.clickup.com/9011600909/chat/r/${encodeURIComponent(channelId)}`
}

const ehIdValido = (id: unknown): id is string => typeof id === "string" && !!id.trim() && id !== "TASK_ID"

/** Links reais do paciente (o exemplo do pacote traz "TASK_ID" no lugar do id). */
export function linksDoPaciente(p: PacienteEntrada): { chave: string; rotulo: string; id: string; url: string }[] {
  return Object.entries(p.links ?? {})
    .filter((par): par is [string, string] => ehIdValido(par[1]))
    .map(([chave, raw]) => {
      const id = raw.trim()
      const url = /^https?:\/\//i.test(id) ? id : chave === "chat" ? linkCanalClickUp(id) : linkClickUp(id)
      return { chave, rotulo: ROTULO_LINK[chave] ?? chave, id, url }
    })
}

/** Id da tarefa do formulário em Solicitações Autorização (links.aut), ou null. */
export function idFormulario(p: PacienteEntrada): string | null {
  const id = p.links?.aut
  return ehIdValido(id) ? id.trim() : null
}

/**
 * Link do ClickUp onde a etapa atual se resolve: tarefa da etapa, primeira
 * tarefa válida ou, quando ainda não há nenhuma task (pedido só no chat, sem
 * formulário aberto), o canal do Chat de autorização.
 */
export function linkDaEtapa(p: PacienteEntrada): { chave: string; rotulo: string; id: string; url: string } {
  const links = linksDoPaciente(p)
  const chave = p.atual ? ACAO_POR_ETAPA[p.atual.etapa]?.link : undefined
  return links.find(l => l.chave === chave) ?? links[0] ?? CANAL_CHAT_AUTORIZACAO
}

/** Data de hoje (AAAA-MM-DD) no horário de Brasília. */
export function hojeBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(agora)
}

/**
 * Selo do topo em uma linha: de quando são os dados. O dia vem da rodada
 * (gerado_em do calc.py); a hora, de quando o Doc foi gravado, só se for do
 * mesmo dia (o Doc pode ter sido regravado com uma rodada antiga, como no teste
 * com o exemplo do pacote). Rodada x Doc fica no `detalhe`, para o tooltip.
 */
export function frescor(
  s: { gerado_em: string; publicado_em: string | null },
  hoje: string,
): { texto: string; detalhe: string } {
  const dia = s.gerado_em.slice(0, 10)
  const gravado = s.publicado_em ? fmtDataHora(s.publicado_em) : null
  const hora = gravado && gravado.startsWith(`${fmtDiaMes(dia)} `) ? gravado.slice(-5) : null
  const quando = dia === hoje ? "hoje" : fmtDiaMes(dia)
  return {
    texto: `Dados de ${quando}${hora ? `, ${hora}` : ""}`,
    detalhe: `Rodada de ${fmtDiaMes(dia)}${gravado ? ` · Doc gravado em ${gravado}` : ""}`,
  }
}

/** Dias corridos/úteis acima do prazo (negativo = folga). */
export function excesso(a: EtapaAtual): number {
  return (a.dias ?? 0) - a.prazo
}

// ─── Prazo e ação em linguagem de gente ──────────────────────────────────────

/** Mesmos nomes de `Tone` (components/cronograma/ui/tones), sem importar valor. */
export type TomPrazo = "red" | "amber" | "green" | "slate" | "purple"

export const TOM_STATUS: Record<StatusPrazo, TomPrazo> = {
  "atrasado": "red",
  "vence hoje": "amber",
  "no prazo": "green",
  "sem dado": "slate",
  "fora de ordem": "purple",
}

const dias = (n: number) => (n === 1 ? "1 dia" : `${n} dias`)

/**
 * "5 dias além do prazo", "Vence hoje", "Faltam 2 dias"... em vez de "6 / 1" e
 * "atrasado". O calc marca atrasado também quem ainda está dentro do prazo mas
 * já tem data marcada depois dele (entrevista marcada para daqui a 6 dias úteis
 * com prazo de 5): isso vira "Vai passar do prazo", e a `obs` explica a data.
 */
export function textoPrazo(a: Pick<EtapaAtual, "status" | "dias" | "prazo">): { texto: string; tom: TomPrazo; dica: string } {
  const tom = TOM_STATUS[a.status] ?? "slate"
  const prazo = a.prazo === 0 ? "prazo: mesmo dia" : `prazo: ${dias(a.prazo)} úteis`
  const dica = a.dias == null ? prazo : `${dias(a.dias)} úteis nesta etapa · ${prazo}`
  switch (a.status) {
    case "atrasado": {
      if (a.dias == null) return { texto: "Fora do prazo", tom, dica }
      const alem = a.dias - a.prazo
      if (alem > 0) return { texto: `${dias(alem)} além do prazo`, tom, dica }
      return { texto: "Vai passar do prazo", tom, dica: `A data já marcada passa do prazo · ${dica}` }
    }
    case "vence hoje":
      return { texto: "Vence hoje", tom, dica }
    case "no prazo": {
      const falta = a.dias == null ? 0 : a.prazo - a.dias
      return { texto: falta > 0 ? `${falta === 1 ? "Falta" : "Faltam"} ${dias(falta)}` : "No prazo", tom, dica }
    }
    case "sem dado":
      return { texto: "Sem data no ClickUp", tom, dica: "A etapa não tem data registrada no ClickUp" }
    case "fora de ordem":
      return { texto: "Etapas fora de ordem", tom, dica: "As datas do ClickUp estão em ordem trocada entre etapas" }
    default:
      return { texto: String(a.status), tom: "slate", dica }
  }
}

/** O que falta fazer, com verbo. Pendência administrativa vira "travado". */
export function proximaAcao(p: PacienteEmAndamento): { texto: string; travado: boolean } {
  const pend = p.atual.pendencia?.trim()
  if (pend) return { texto: pend, travado: true }
  if (p.atual.etapa === "E3" && p.tipo === "Neuro") return { texto: "Fazer a avaliação", travado: false }
  return { texto: ACAO_POR_ETAPA[p.atual.etapa]?.acao ?? p.atual.nome, travado: false }
}

/** Avisos de registro ainda abertos, em texto. */
export function textosDosAlertas(p: PacienteEntrada): string[] {
  return (p.alertas ?? []).flatMap(a => {
    if (typeof a === "string") return a.trim() ? [a.trim()] : []
    return a && typeof a.texto === "string" && a.texto.trim() && !a.resolvido ? [a.texto.trim()] : []
  })
}

/**
 * Dá para mandar o link da disponibilidade agora? O formulário público acha a
 * criança pelo CPF num cadastro ATIVO; sem isso a família não consegue entrar e
 * o link só gera retrabalho. Por isso só libera com cadastro único e CPF válido
 * (nao_preenchida). Já preenchida não precisa de link.
 */
export function envioDoLinkDisponibilidade(
  disp: DisponibilidadePainel | undefined,
): { pode: boolean; motivo: string | null; bloqueio: boolean } {
  if (!disp) return { pode: false, bloqueio: true, motivo: "Não foi possível conferir o cadastro deste paciente: confira no cadastro antes de mandar o link." }
  switch (disp.estado) {
    case "nao_preenchida":
      return { pode: true, bloqueio: false, motivo: null }
    case "sem_cadastro":
      return { pode: false, bloqueio: true, motivo: "Ainda não há cadastro ativo deste paciente no Pulsar. Cadastre com o CPF da criança antes de mandar o link: é pelo CPF que a família entra." }
    case "sem_cpf":
      return { pode: false, bloqueio: true, motivo: "O cadastro está sem CPF válido. Complete o CPF da criança antes de mandar o link: é por ele que a família entra." }
    case "nome_ambiguo":
      return { pode: false, bloqueio: true, motivo: "Há mais de um paciente ativo com esse nome. Confira qual é no cadastro (e se tem CPF) antes de mandar o link." }
    case "preenchida_familia":
      return { pode: false, bloqueio: false, motivo: "A família já enviou a disponibilidade: não precisa mandar o link." }
    case "preenchida_equipe":
      return { pode: false, bloqueio: false, motivo: "A equipe já lançou a disponibilidade no cadastro: não precisa mandar o link." }
    default:
      return { pode: false, bloqueio: true, motivo: "Confira o cadastro antes de mandar o link." }
  }
}

/** Selo de disponibilidade só aparece na linha quando pede ação de alguém. */
export function dispPedeAcao(disp: DisponibilidadePainel | undefined, etapa: string): boolean {
  if (!disp || !ETAPAS_DISPONIBILIDADE.has(etapa)) return false
  if (disp.casamento === "inicio_do_nome") return true
  return disp.estado !== "preenchida_familia" && disp.estado !== "preenchida_equipe"
}

// ─── Recortes ────────────────────────────────────────────────────────────────

export type PacienteEmAndamento = PacienteEntrada & { atual: EtapaAtual }

export function emAndamento(pacs: PacienteEntrada[]): PacienteEmAndamento[] {
  return pacs.filter((p): p is PacienteEmAndamento => p.situacao === "em andamento" && !!p.atual)
}

/** Atrasados primeiro; dentro de cada grupo, quem mais passou do prazo. */
export function ordenarPorUrgencia<T extends PacienteEmAndamento>(lista: T[]): T[] {
  return [...lista].sort(
    (a, b) =>
      Number(b.atual.status === "atrasado") - Number(a.atual.status === "atrasado") ||
      excesso(b.atual) - excesso(a.atual),
  )
}

export type StatusFiltro = "atrasado" | "vence hoje" | "no prazo"
export type FiltroPainel = { status: StatusFiltro | null; convenio: string }
export const TODOS = "Todos"
export const FILTRO_INICIAL: FiltroPainel = { status: null, convenio: TODOS }

export function conveniosEmAndamento(pacs: PacienteEntrada[]): string[] {
  return [...new Set(emAndamento(pacs).map(p => p.convenio))].sort()
}

export interface BlocoSetor {
  setor: string
  /** Âncora do bloco (#setor-<slug>). */
  slug: string
  responsavel: Responsavel
  /** Bloco "Aguardando a família": não é setor a cobrar. */
  familia: boolean
  atrasados: PacienteEmAndamento[]
  venceHoje: PacienteEmAndamento[]
  /** No prazo, sem dado e fora de ordem (estes dois primeiro). */
  demais: PacienteEmAndamento[]
  total: number
}

export function slugSetor(setor: string): string {
  return setor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

const ORDEM_DEMAIS: Record<string, number> = { "fora de ordem": 0, "sem dado": 1 }

/**
 * "Quem precisa agir": um bloco por setor da etapa atual, com mais atrasados
 * primeiro (depois mais vencendo hoje). Família vai sempre por último.
 */
export function blocosPorSetor(pacs: PacienteEntrada[], filtro: FiltroPainel = FILTRO_INICIAL): BlocoSetor[] {
  let lista = emAndamento(pacs)
  if (filtro.convenio !== TODOS) lista = lista.filter(p => p.convenio === filtro.convenio)
  if (filtro.status) lista = lista.filter(p => p.atual.status === filtro.status)

  const mapa = new Map<string, PacienteEmAndamento[]>()
  for (const p of lista) mapa.set(p.atual.setor, [...(mapa.get(p.atual.setor) ?? []), p])

  const porExcesso = (a: PacienteEmAndamento, b: PacienteEmAndamento) => excesso(b.atual) - excesso(a.atual)
  return [...mapa.entries()]
    .map(([setor, ps]): BlocoSetor => ({
      setor,
      slug: slugSetor(setor),
      responsavel: responsavelDo(setor),
      familia: setor === SETOR_FAMILIA,
      atrasados: ps.filter(p => p.atual.status === "atrasado").sort(porExcesso),
      venceHoje: ps.filter(p => p.atual.status === "vence hoje").sort(porExcesso),
      demais: ps
        .filter(p => p.atual.status !== "atrasado" && p.atual.status !== "vence hoje")
        .sort((a, b) => (ORDEM_DEMAIS[a.atual.status] ?? 9) - (ORDEM_DEMAIS[b.atual.status] ?? 9) || porExcesso(a, b)),
      total: ps.length,
    }))
    .sort(
      (a, b) =>
        Number(a.familia) - Number(b.familia) ||
        b.atrasados.length - a.atrasados.length ||
        b.venceHoje.length - a.venceHoje.length ||
        b.total - a.total ||
        a.setor.localeCompare(b.setor),
    )
}

export interface Manchete {
  total: number
  atrasados: number
  venceHoje: number
  noPrazo: number
  /** Aguardando a família (fora da cobrança). */
  familia: number
  titulo: string
  apoio: string
}

const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`)

/** A frase do topo: quantos estão fora do prazo e em quais setores (no máximo 2). */
export function manchete(pacs: PacienteEntrada[]): Manchete {
  const ab = emAndamento(pacs)
  const blocos = blocosPorSetor(pacs).filter(b => !b.familia)
  const contar = (s: StatusPrazo) => ab.filter(p => p.atual.status === s).length
  const total = ab.length
  const atrasados = contar("atrasado")
  const venceHoje = contar("vence hoje")
  const familia = ab.filter(p => p.atual.setor === SETOR_FAMILIA).length

  const citar = (n: (b: BlocoSetor) => number) =>
    blocos.filter(b => n(b) > 0).sort((a, b) => n(b) - n(a)).slice(0, 2).map(b => `${b.setor} (${n(b)})`)

  let titulo: string
  const apoio: string[] = []
  if (total === 0) {
    titulo = "Nenhum paciente em andamento."
  } else if (atrasados > 0) {
    titulo = `${atrasados} de ${total} pacientes ${atrasados === 1 ? "está" : "estão"} fora do prazo.`
    const c = citar(b => b.atrasados.length)
    if (c.length) apoio.push(`${c.length > 1 ? "Mais atrasos em" : "Atrasos em"} ${juntar(c)}.`)
  } else {
    titulo = "Nenhum paciente fora do prazo."
    const c = citar(b => b.venceHoje.length)
    if (c.length) apoio.push(`${venceHoje} ${venceHoje === 1 ? "vence" : "vencem"} hoje: ${juntar(c)}.`)
  }
  if (familia > 0) apoio.push(`${familia} ${familia === 1 ? "aguarda" : "aguardam"} retorno da família.`)

  return { total, atrasados, venceHoje, noPrazo: contar("no prazo"), familia, titulo, apoio: apoio.join(" ") }
}

/** "Registros a corrigir": agrupado por paciente, quem está atrasado primeiro. Encerrados ficam de fora. */
export function avisosPorPaciente(pacs: PacienteEntrada[]): { paciente: PacienteEntrada; avisos: string[] }[] {
  const peso = (p: PacienteEntrada) =>
    p.situacao !== "em andamento" || !p.atual ? 0 : p.atual.status === "atrasado" ? 2 : 1
  const alem = (p: PacienteEntrada) => (p.atual ? excesso(p.atual) : 0)
  return pacs
    .filter(p => p.situacao !== "encerrado")
    .map(p => ({ paciente: p, avisos: textosDosAlertas(p) }))
    .filter(x => x.avisos.length > 0)
    .sort((a, b) => peso(b.paciente) - peso(a.paciente) || alem(b.paciente) - alem(a.paciente))
}

/** Quem já começou o tratamento (Neuro conclui com a avaliação), do início mais recente. */
export function jaIniciaram(pacs: PacienteEntrada[]): PacienteEntrada[] {
  return pacs
    .filter(p => p.situacao === "concluído" && p.tipo !== "Neuro")
    .sort((a, b) => (b.inicio ?? "").localeCompare(a.inicio ?? ""))
}

export function concluidosEEncerrados(pacs: PacienteEntrada[]): PacienteEntrada[] {
  return pacs
    .filter(p => p.situacao !== "em andamento")
    .sort((a, b) => (b.entrada ?? "").localeCompare(a.entrada ?? ""))
}

export function mapaDisponibilidade(lista: DisponibilidadePainel[]): Map<string, DisponibilidadePainel> {
  return new Map(lista.map(d => [d.nome, d]))
}

// ─── Caminho do paciente (E0 → E7) ───────────────────────────────────────────

export type EstadoPasso = "feito" | "feito_atrasado" | "feito_fora_de_ordem" | "feito_sem_data" | "atual" | "a_fazer"

export interface PassoCaminho {
  etapa: string
  nome: string
  estado: EstadoPasso
  fim: string | null
  dias: number | null
  prazo: number
  nota: string | null
}

/** "E3" → [3, 3]; "E4–E5" → [4, 5]. */
function faixaEtapas(etapa: string): [number, number] | null {
  const m = /^E(\d+)\s*(?:[–—-]\s*E(\d+))?$/.exec(etapa.trim())
  if (!m) return null
  const a = Number(m[1])
  const b = m[2] != null ? Number(m[2]) : a
  return [Math.min(a, b), Math.max(a, b)]
}

/**
 * Um passo por etapa do fluxo, a partir do histórico e da etapa atual. Etapas
 * fechadas juntas ("E4–E5") marcam todas como feitas; etapa anterior à atual
 * que não aparece no histórico foi cumprida sem data no ClickUp.
 */
export function caminhoDoPaciente(
  p: PacienteEntrada,
  etapas: Pick<EtapaResumo, "etapa" | "nome" | "prazo">[],
): PassoCaminho[] {
  const atual = p.atual ? faixaEtapas(p.atual.etapa)?.[0] ?? null : null
  const feitos = new Map<number, { h: EtapaHistorico; ultimo: boolean; junto: boolean }>()
  for (const h of p.historico) {
    const f = faixaEtapas(h.etapa)
    if (!f) continue
    for (let i = f[0]; i <= f[1]; i++) feitos.set(i, { h, ultimo: i === f[1], junto: f[0] !== f[1] })
  }
  const ultimoFeito = Math.max(-1, ...feitos.keys())

  return etapas.map((e, i): PassoCaminho => {
    const n = faixaEtapas(e.etapa)?.[0] ?? i
    const base = { etapa: e.etapa, nome: e.nome, fim: null, dias: null, prazo: e.prazo, nota: null }
    if (atual != null && n === atual && p.atual) {
      return { ...base, estado: "atual", dias: p.atual.dias, prazo: p.atual.prazo }
    }
    const f = feitos.get(n)
    if (f) {
      const estado: EstadoPasso =
        f.h.status === "atrasado" ? "feito_atrasado" : f.h.status === "fora de ordem" ? "feito_fora_de_ordem" : "feito"
      return {
        ...base,
        estado,
        fim: f.h.fim,
        dias: f.ultimo ? f.h.dias : null,
        prazo: f.ultimo ? f.h.prazo : e.prazo,
        nota: !f.junto ? null : f.ultimo ? "Prazo somado com a etapa anterior, fechada junto" : "Sem data própria: fechada junto com a seguinte",
      }
    }
    const cumprida = (atual != null && n < atual) || p.situacao === "concluído" || n < ultimoFeito
    return cumprida
      ? { ...base, estado: "feito_sem_data", nota: "Cumprida sem data registrada no ClickUp" }
      : { ...base, estado: "a_fazer" }
  })
}

// ─── Prazos do Pulsar sobre a rodada do calc ─────────────────────────────────
//
// O calc.py grava `dias` (dias úteis) de cada etapa; o status sai de comparar
// com o prazo (status_de). Com os prazos editáveis do Pulsar, a rota reaplica a
// mesma regra sobre esses dias — sem refazer conta de calendário. Fica fora do
// prazo editável o que o calc decide por outra régua:
//   • "fora de ordem" (dias < 0): não depende do prazo;
//   • E6 da Leve com início previsto: vence 1 dia útil antes do início (fixo);
//   • E3 com entrevista futura: usa os dias PROJETADOS que o calc escreve na obs
//     ("(6 d.u. após agendar)"); sem esse número, fica o status do calc.
// Etapas fechadas juntas ("E4–E5") somam os prazos do grupo, como no calc.
// A função é idempotente: aplicar A e depois B dá o mesmo que aplicar só B.

/** status_de do calc.py. */
export function statusPorPrazo(dias: number | null, prazo: number): StatusPrazo {
  if (dias == null) return "sem dado"
  if (dias > prazo) return "atrasado"
  if (dias === prazo) return "vence hoje"
  return "no prazo"
}

/** "Entrevista marcada para 19/10 (6 d.u. após agendar)" → 6. */
export function diasProjetadosE3(obs: string | undefined): number | null {
  const m = obs ? /\((-?\d+) d\.u\. após agendar\)/.exec(obs) : null
  return m ? Number(m[1]) : null
}

/** round() do Python 3 (metade vai para o par), para o % bater com o do calc. */
function arredondarComoPython(x: number): number {
  const piso = Math.floor(x)
  const resto = x - piso
  if (Math.abs(resto - 0.5) < 1e-9) return piso % 2 === 0 ? piso : piso + 1
  return Math.round(x)
}

const leveComInicioPrevisto = (p: PacienteEntrada) => p.convenio === "Leve" && !!p.inicio_previsto

export function mapaDePrazos(vigentes: Pick<PrazoVigente, "etapa" | "prazo">[]): MapaPrazos {
  return Object.fromEntries(vigentes.map(v => [v.etapa, v.prazo]))
}

export function aplicarPrazos(d: DadosPainel, prazos: MapaPrazos): DadosPainel {
  const prazoDe = (etapa: string): number =>
    prazos[etapa] ?? d.etapas.find(e => e.etapa === etapa)?.prazo ?? PRAZOS_PADRAO[etapa] ?? 0

  const pacientes = d.pacientes.map((p): PacienteEntrada => {
    const historico = p.historico.map((h): EtapaHistorico => {
      const f = faixaEtapas(h.etapa)
      if (!f) return h
      let prazo = 0
      for (let i = f[0]; i <= f[1]; i++) prazo += prazoDe(`E${i}`)
      if (h.status === "fora de ordem") return { ...h, prazo }
      if (!h.combinado && h.etapa === "E6" && leveComInicioPrevisto(p)) return { ...h, prazo }
      return { ...h, prazo, status: statusPorPrazo(h.dias, prazo) }
    })

    let atual = p.atual
    if (atual) {
      const prazo = prazoDe(atual.etapa)
      if (atual.etapa === "E6" && leveComInicioPrevisto(p)) {
        atual = { ...atual, prazo }
      } else if (atual.etapa === "E3" && diasProjetadosE3(atual.obs) != null) {
        atual = { ...atual, prazo, status: (diasProjetadosE3(atual.obs) as number) > prazo ? "atrasado" : "no prazo" }
      } else if (atual.etapa === "E3" && atual.obs) {
        // Entrevista futura cuja obs mudou de formato: mantém o status do calc.
        atual = { ...atual, prazo }
      } else {
        atual = { ...atual, prazo, status: statusPorPrazo(atual.dias, prazo) }
      }
    }
    return { ...p, atual, historico }
  })

  const etapas = d.etapas.map((e): EtapaResumo => {
    const prazo = prazoDe(e.etapa)
    const vals = pacientes.flatMap(p =>
      p.historico.filter(h => h.etapa === e.etapa && Number.isInteger(h.dias) && (h.dias as number) >= 0).map(h => h.dias as number))
    const dentro = vals.filter(v => v <= prazo).length
    return {
      ...e,
      prazo,
      n: vals.length,
      pct_no_prazo: vals.length ? arredondarComoPython((100 * dentro) / vals.length) : null,
    }
  })

  const abertos = emAndamento(pacientes)
  const contar = (s: StatusPrazo) => abertos.filter(p => p.atual.status === s).length
  const setores: DadosPainel["setores"] = {}
  for (const p of abertos) {
    const s = (setores[p.atual.setor] ??= { total: 0, atrasados: 0 })
    s.total += 1
    if (p.atual.status === "atrasado") s.atrasados += 1
  }

  return {
    ...d,
    pacientes,
    etapas,
    setores,
    resumo: {
      ...d.resumo,
      atrasados: contar("atrasado"),
      vence_hoje: contar("vence hoje"),
      no_prazo: contar("no prazo"),
      meta_total_uteis: d.etapas.reduce((s, e) => s + prazoDe(e.etapa), 0),
    },
  }
}

/** Antes x depois de mudar o prazo de uma etapa (prévia da tela e registro do histórico). */
export function impactoDaAlteracao(d: DadosPainel, prazosAntes: MapaPrazos, etapa: string, prazoNovo: number): ImpactoPrazo {
  const antes = aplicarPrazos(d, prazosAntes)
  const depois = aplicarPrazos(d, { ...prazosAntes, [etapa]: prazoNovo })
  const agora = (x: DadosPainel): ContagemAgora => ({
    atrasados: x.resumo.atrasados, vence_hoje: x.resumo.vence_hoje, no_prazo: x.resumo.no_prazo,
  })
  const etapaAntes = antes.etapas.find(e => e.etapa === etapa)
  const etapaDepois = depois.etapas.find(e => e.etapa === etapa)

  const mudancas: MudancaStatus[] = []
  antes.pacientes.forEach((pa, i) => {
    const pd = depois.pacientes[i]
    if (pa.situacao === "em andamento" && pa.atual && pd.atual && pa.atual.status !== pd.atual.status) {
      mudancas.push({ paciente: pa.paciente, onde: "atual", etapa: pa.atual.etapa, de: pa.atual.status, para: pd.atual.status })
    }
    pa.historico.forEach((h, j) => {
      const hd = pd.historico[j]
      if (hd && h.status !== hd.status) {
        mudancas.push({ paciente: pa.paciente, onde: "histórico", etapa: h.etapa, de: h.status, para: hd.status })
      }
    })
  })

  return {
    snapshot_gerado_em: d.gerado_em ?? null,
    etapa,
    mediana: etapaAntes?.mediana ?? null,
    n: etapaAntes?.n ?? 0,
    pct_no_prazo_antes: etapaAntes?.pct_no_prazo ?? null,
    pct_no_prazo_depois: etapaDepois?.pct_no_prazo ?? null,
    meta_antes: antes.resumo.meta_total_uteis,
    meta_depois: depois.resumo.meta_total_uteis,
    agora_antes: agora(antes),
    agora_depois: agora(depois),
    mudancas,
  }
}

/** 0 → "mesmo dia"; 1 → "1 dia útil"; 8.5 (mediana) → "8,5 dias úteis". */
export function textoDiasUteis(n: number): string {
  return n === 0 ? "mesmo dia" : n === 1 ? "1 dia útil" : `${String(n).replace(".", ",")} dias úteis`
}
