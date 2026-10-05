// Tradução do antes/depois (JSONB cru) da trilha de auditoria da PEP em algo
// legível pra usuário leigo — mesmo papel de lib/cronograma/auditoriaFormat.ts
// (Ocupação de Salas), só que pros 4 tipos de linha da PEP: registro de
// entrega, planejamento semestral, apuração mensal (liberar/reabrir) e
// calendário da competência ("Semanas no mês").

import type { PepCatalogoItem } from "@/types/pep"
import type { PepTrilhaAcao, PepTrilhaTabela } from "@/services/pepAuditoria.service"

/** Só o mínimo necessário pra calcular o resumo — usado tanto ao gravar (antes de a linha existir) quanto ao ler a trilha já salva. */
export interface AuditoriaEntradaPep {
  tabela: PepTrilhaTabela
  acao: PepTrilhaAcao
  antes?: unknown
  depois?: unknown
}

// Campos técnicos que nunca aparecem pro usuário — ids internos, timestamps
// de controle, e os campos de contexto que a linha da trilha já expõe direto
// (prestador_nome/paciente_nome/competencia), sem precisar duplicar no diff.
const CAMPOS_IGNORADOS = new Set([
  "id", "paciente_nome", "paciente_cpf", "prestador_nome", "item_id", "competencia",
  "created_at", "updated_at", "criado_em", "entregue_em", "registrado_por", "calculado_por",
  "planejamento_anterior_id",
])

const STATUS_LABEL: Record<string, string> = { pendente: "Pendente", entregue: "Entregue" }
const ORIGEM_LABEL: Record<string, string> = {
  inicial: "Planejamento inicial",
  reprogramacao_antecipada: "Reprogramação (entrega antecipada)",
  reprogramacao_impedimento: "Reprogramação (impedimento terapêutico)",
  manual: "Ajuste manual",
}
const ESTADO_LABEL: Record<string, string> = { apurado: "Apurado", liberado: "Faturamento liberado" }

const LABEL_POR_TABELA: Record<PepTrilhaTabela, Record<string, string>> = {
  registro_entrega: {
    status: "Status",
    quantidade_entregue: "Quantidade entregue",
    evidencias: "Evidências",
    observacao: "Observação",
    data_entrega: "Data de entrega",
  },
  planejamento_semestral: {
    competencia_planejada: "Competência planejada",
    data_planejada: "Data planejada",
    origem: "Origem",
    ativo: "Planejamento ativo",
    motivo: "Motivo do planejamento",
    evidencias: "Evidências",
  },
  apuracao_mensal: {
    estado: "Estado do faturamento",
  },
  calendario_competencia: {
    semanas_supervisao_estudo: "Semanas no mês (Sup./Estudo)",
    observacao: "Observação",
  },
}

export interface EvidenciaTrilha {
  caminho: string
  nome?: string | null
}

/** As evidências gravadas num registro (jsonb), só as que têm caminho. */
export function evidenciasDe(valor: unknown): EvidenciaTrilha[] {
  if (!Array.isArray(valor)) return []
  return valor.filter((e): e is EvidenciaTrilha => !!e && typeof e === "object" && !!(e as { caminho?: unknown }).caminho)
}

/**
 * Nome legível de uma evidência — nunca a URL crua. Sem `nome`, tira do próprio
 * link: no SharePoint o caminho real vem no parâmetro `id` do AllItems.aspx
 * (".../Forms/AllItems.aspx?id=%2Fsites%2F...%2FPasta"); fora disso, o último
 * pedaço do endereço.
 */
export function nomeDaEvidencia(e: EvidenciaTrilha): string {
  if (e.nome) return e.nome
  const ultimo = (caminho: string) => caminho.split("/").filter(Boolean).pop() ?? ""
  try {
    const url = new URL(e.caminho)
    const id = url.searchParams.get("id")
    if (id && ultimo(id)) return ultimo(id)
    const fim = decodeURIComponent(ultimo(url.pathname))
    return fim && !/\.aspx$/i.test(fim) ? fim : "Arquivo no SharePoint"
  } catch {
    return ultimo(e.caminho) || e.caminho
  }
}

function formatarEvidencias(valor: unknown): string {
  return evidenciasDe(valor).map(nomeDaEvidencia).join(", ") || "—"
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** O que mudou na lista de evidências, comparando pelo caminho. */
export function diffEvidencias(antes: unknown, depois: unknown): { adicionadas: EvidenciaTrilha[]; removidas: EvidenciaTrilha[] } {
  const a = evidenciasDe(antes)
  const d = evidenciasDe(depois)
  const emA = new Set(a.map(e => e.caminho))
  const emD = new Set(d.map(e => e.caminho))
  return { adicionadas: d.filter(e => !emA.has(e.caminho)), removidas: a.filter(e => !emD.has(e.caminho)) }
}

function resumoDiffEvidencias(antes: unknown, depois: unknown): string {
  const { adicionadas, removidas } = diffEvidencias(antes, depois)
  if (adicionadas.length === 1 && removidas.length === 1) return "arquivo trocado"
  const partes = [
    adicionadas.length ? plural(adicionadas.length, "adicionado", "adicionados") : "",
    removidas.length ? plural(removidas.length, "removido", "removidos") : "",
  ].filter(Boolean)
  return partes.join(", ") || "alteradas"
}

function formatarValor(campo: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—"
  if (campo === "status") return STATUS_LABEL[valor as string] ?? String(valor)
  if (campo === "origem") return ORIGEM_LABEL[valor as string] ?? String(valor)
  if (campo === "estado") return ESTADO_LABEL[valor as string] ?? String(valor)
  if (campo === "ativo") return valor ? "Sim" : "Não"
  if (campo === "evidencias") return formatarEvidencias(valor)
  if (campo === "data_planejada" || campo === "data_entrega") {
    const [ano, mes, dia] = String(valor).split("-")
    return dia && mes && ano ? `${dia}/${mes}/${ano}` : String(valor)
  }
  return String(valor)
}

export interface CampoAlteracaoPep {
  campo: string
  label: string
  antes: string
  depois: string
  mudou: boolean
  /** Valores crus — a tela usa nas evidências, que viram links. */
  antesBruto: unknown
  depoisBruto: unknown
}

export interface CampoSnapshotPep {
  campo: string
  label: string
  valor: string
  valorBruto: unknown
}

function camposConhecidos(tabela: PepTrilhaTabela, registro: Record<string, unknown>): [string, string][] {
  const labels = LABEL_POR_TABELA[tabela]
  return Object.keys(labels)
    .filter(campo => !CAMPOS_IGNORADOS.has(campo) && campo in registro)
    .map(campo => [campo, labels[campo]])
}

/** Linhas "campo: antes → depois", só dos campos que de fato mudaram. */
export function camposAlterados(item: AuditoriaEntradaPep): CampoAlteracaoPep[] {
  const antes = (item.antes ?? {}) as Record<string, unknown>
  const depois = (item.depois ?? {}) as Record<string, unknown>
  const base = Object.keys(depois).length ? depois : antes
  return camposConhecidos(item.tabela, base)
    .map(([campo, label]) => ({
      campo,
      label,
      antes: formatarValor(campo, antes[campo]),
      depois: formatarValor(campo, depois[campo]),
      mudou: JSON.stringify(antes[campo] ?? null) !== JSON.stringify(depois[campo] ?? null),
      antesBruto: antes[campo],
      depoisBruto: depois[campo],
    }))
    .filter(c => c.mudou)
}

/** Linhas "campo: valor" — usado em criação (depois) e exclusão (antes). */
export function camposSnapshot(item: AuditoriaEntradaPep): CampoSnapshotPep[] {
  const registro = (item.acao === "excluir" ? item.antes : item.depois ?? item.antes) as Record<string, unknown> | null
  if (!registro) return []
  return camposConhecidos(item.tabela, registro).map(([campo, label]) => ({ campo, label, valor: formatarValor(campo, registro[campo]), valorBruto: registro[campo] }))
}

/**
 * Uma linha só, pronta pra ler direto na planilha do Supabase (coluna
 * `resumo`) sem abrir o JSON de antes/depois.
 */
export function resumoAlteracao(item: AuditoriaEntradaPep): string {
  if (item.acao === "editar") {
    const alteracoes = camposAlterados(item)
    return alteracoes.length
      ? alteracoes.map(c => `${c.label}: ${c.antes} → ${c.depois}`).join(" · ")
      : "Nenhum campo alterado."
  }
  const snapshot = camposSnapshot(item)
  if (!snapshot.length) return item.acao === "criar" ? "Registro criado." : "Registro excluído."
  return snapshot.map(c => `${c.label}: ${c.valor}`).join(" · ")
}

/** Edição gravada sem `antes` (o robô grava só o `depois`): não há o que comparar. */
export function semEstadoAnterior(item: AuditoriaEntradaPep): boolean {
  return !item.antes || (typeof item.antes === "object" && Object.keys(item.antes as object).length === 0)
}

/**
 * A linha curta da lista do histórico, montada na hora a partir de antes/depois
 * — diferente de `resumo` (gravado), que nas linhas antigas traz a URL inteira
 * das evidências. Edição: só o que mudou, evidência resumida ("arquivo
 * trocado"); criação/exclusão: só os campos preenchidos, evidência contada.
 */
export function resumoCurto(item: AuditoriaEntradaPep): string {
  if (item.acao === "editar" && !semEstadoAnterior(item)) {
    const alteracoes = camposAlterados(item)
    if (!alteracoes.length) return "Nenhum campo alterado."
    return alteracoes
      .map(c => c.campo === "evidencias"
        ? `${c.label}: ${resumoDiffEvidencias(c.antesBruto, c.depoisBruto)}`
        : `${c.label}: ${c.antes} → ${c.depois}`)
      .join(" · ")
  }
  return camposSnapshot(item)
    .filter(c => c.valor !== "—")
    .map(c => c.campo === "evidencias"
      ? plural(evidenciasDe(c.valorBruto).length, "evidência", "evidências")
      : `${c.label}: ${c.valor}`)
    .join(" · ")
}

/** Nome do item de catálogo referenciado por uma linha da trilha (antes ou depois), pro cabeçalho da lista — resolve item_id sem precisar de nova consulta. */
export function nomeItemDaTrilha(
  item: { antes?: unknown; depois?: unknown },
  catalogo: PepCatalogoItem[]
): string | null {
  const registro = (item.depois ?? item.antes) as { item_id?: string } | null
  if (!registro?.item_id) return null
  return catalogo.find(c => c.id === registro.item_id)?.nome ?? null
}