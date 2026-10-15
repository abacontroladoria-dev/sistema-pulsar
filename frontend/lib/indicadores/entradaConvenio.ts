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
  alertas?: string[] | null
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
}

// ─── Textos fixos ────────────────────────────────────────────────────────────

/** Quem responde por cada setor (Handoff, seção 3). */
export const SETOR_DESCRICAO: Record<string, string> = {
  "Autorização": "Vitória: elegibilidade e autorização da operadora",
  "Comercial": "Jennifer e Aída: agendamento da entrevista",
  "Terapêutico": "Operações clínicas: Júlia (Realengo), Marcelle (Fazendinha), Nathália (Padre Miguel)",
  "Cronograma": "Vitória: montagem e apresentação à família",
  "Família": "Aguardando retorno do responsável",
}

export const ROTULO_LINK: Record<string, string> = { aut: "Autorização", crm: "CRM", crono: "Cronograma" }

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

export function nomeCurto(nome: string, palavras = 3): string {
  return nome.trim().split(/\s+/).slice(0, palavras).join(" ")
}

export function linkClickUp(taskId: string): string {
  return `https://app.clickup.com/t/${encodeURIComponent(taskId)}`
}

/** Links reais do paciente (o exemplo do pacote traz "TASK_ID" no lugar do id). */
export function linksDoPaciente(p: PacienteEntrada): { chave: string; rotulo: string; url: string }[] {
  return Object.entries(p.links ?? {})
    .filter(([, id]) => typeof id === "string" && id.trim() && id !== "TASK_ID")
    .map(([chave, id]) => ({ chave, rotulo: ROTULO_LINK[chave] ?? chave, url: linkClickUp(id) }))
}

/** Dias corridos/úteis acima do prazo (negativo = folga). */
export function excesso(a: EtapaAtual): number {
  return (a.dias ?? 0) - a.prazo
}

// ─── Recortes (portados do HTML do pacote) ───────────────────────────────────

export type FiltroPacientes = { setor: string; status: string; convenio: string }
export const TODOS = "Todos"
export const FILTRO_INICIAL: FiltroPacientes = { setor: TODOS, status: TODOS, convenio: TODOS }
export const STATUS_FILTRAVEIS: StatusPrazo[] = ["atrasado", "vence hoje", "no prazo"]

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

export function filtrarPacientes(pacs: PacienteEntrada[], f: FiltroPacientes): PacienteEmAndamento[] {
  let lista = emAndamento(pacs)
  if (f.setor !== TODOS) lista = lista.filter(p => p.atual.setor === f.setor)
  if (f.status !== TODOS) lista = lista.filter(p => p.atual.status === f.status)
  if (f.convenio !== TODOS) lista = lista.filter(p => p.convenio === f.convenio)
  return ordenarPorUrgencia(lista)
}

export function opcoesFiltro(pacs: PacienteEntrada[]): { setores: string[]; convenios: string[] } {
  const ab = emAndamento(pacs)
  return {
    setores: [...new Set(ab.map(p => p.atual.setor))],
    convenios: [...new Set(ab.map(p => p.convenio))].sort(),
  }
}

export interface GrupoSetor {
  setor: string
  pacientes: PacienteEmAndamento[]
  atrasados: PacienteEmAndamento[]
}

/** "Onde está parado": setores com mais atrasados primeiro. */
export function porSetor(pacs: PacienteEntrada[]): GrupoSetor[] {
  const mapa = new Map<string, PacienteEmAndamento[]>()
  for (const p of emAndamento(pacs)) {
    const lista = mapa.get(p.atual.setor) ?? []
    lista.push(p)
    mapa.set(p.atual.setor, lista)
  }
  return [...mapa.entries()]
    .map(([setor, lista]) => {
      const ordenada = [...lista].sort((a, b) => excesso(b.atual) - excesso(a.atual))
      return { setor, pacientes: ordenada, atrasados: ordenada.filter(p => p.atual.status === "atrasado") }
    })
    .sort((a, b) => b.atrasados.length - a.atrasados.length)
}

/** As três raias: etapa 5 (apresentar), etapa 7 (aguardando início) e quem já começou. */
export function raias(pacs: PacienteEntrada[]) {
  const ab = emAndamento(pacs)
  const naEtapa = (et: string) =>
    ab.filter(p => p.atual.etapa === et).sort((a, b) => (b.atual.dias ?? 0) - (a.atual.dias ?? 0))
  return {
    paraApresentar: naEtapa("E5"),
    aguardandoInicio: naEtapa("E7"),
    iniciados: pacs
      .filter(p => p.situacao === "concluído" && p.tipo !== "Neuro")
      .sort((a, b) => (b.inicio ?? "").localeCompare(a.inicio ?? "")),
  }
}

/** "Registro a corrigir": alertas de quem não foi encerrado. */
export function alertasDeRegistro(pacs: PacienteEntrada[]): { paciente: string; alerta: string }[] {
  return pacs
    .filter(p => p.situacao !== "encerrado")
    .flatMap(p => (p.alertas ?? []).map(alerta => ({ paciente: p.paciente, alerta })))
}

export function concluidosEEncerrados(pacs: PacienteEntrada[]): PacienteEntrada[] {
  return pacs
    .filter(p => p.situacao !== "em andamento")
    .sort((a, b) => (b.entrada ?? "").localeCompare(a.entrada ?? ""))
}

export function mapaDisponibilidade(lista: DisponibilidadePainel[]): Map<string, DisponibilidadePainel> {
  return new Map(lista.map(d => [d.nome, d]))
}
