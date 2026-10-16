import {
  AlertTriangle, CalendarMinus, CalendarPlus, CalendarSync, CalendarX, CheckCircle2, Lock, RotateCcw, UserCheck, UserPlus,
} from "lucide-react"
import { curtoDia, dataBR } from "@/lib/disponibilidadeProfissional"
import type { ImportacaoGrade, ItemImportacaoGrade } from "@/services/grade.service"
import type { PacienteImportacaoLog } from "@/types/pacienteImportacao"
import type { ImportacaoTita, ItemImportacaoTita } from "@/types/titaImportacao"
import type { ItemRelatorio, RodadaRelatorio, SecaoRelatorio } from "./RelatorioSincronizacaoTita"

// Cada domínio no formato neutro do relatório "Sincronização do TiTa".

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

// ── Pacientes (pacientes_importacoes_log) ─────────────────────────────────────
// Textos idênticos aos do modal original: é a tela de referência.

export function rodadaDePacientes(log: PacienteImportacaoLog): RodadaRelatorio {
  const novos = log.detalhes?.novos ?? []
  const atualizados = log.detalhes?.atualizados ?? []
  const cron = log.origem === "cron"
  return {
    id: log.id,
    iniciadoEm: log.iniciado_em,
    situacao: log.status,
    origemLonga: cron ? "Automático (rotina 04:00)" : "Disparo manual",
    origemCurta: cron ? "Automático (04:00)" : "Manual",
    usuarioNome: log.usuario_nome,
    erroMensagem: log.erro_mensagem,
    noTita: log.vistos_na_tita,
    resumoHistorico: [
      `${log.novos} novo${log.novos === 1 ? "" : "s"}`,
      `${log.atualizados} atualizado${log.atualizados === 1 ? "" : "s"}`,
      ...(log.vinculados_por_cpf > 0 ? [`${log.vinculados_por_cpf} por CPF`] : []),
    ],
    secoes: [
      {
        chave: "novos",
        titulo: "Novos Pacientes",
        rotuloCartao: "Novos",
        total: log.novos,
        tom: "verde",
        Icone: UserPlus,
        itens: novos.map(p => ({
          chave: String(p.id),
          nome: p.nome,
          href: `/cadastros/pacientes/${p.id}`,
          subtitulo: `ID TiTa ${p.tita_id ?? "—"} ${p.cpf ? `· CPF ${p.cpf}` : ""}`,
          selo: "Novo",
        })),
        dicaFechada: "Toque para abrir e ver os nomes",
        vazio: "Nenhum paciente novo adicionado nesta rodada.",
        buscaPlaceholder: "Buscar paciente novo...",
        semResultado: "Nenhum paciente encontrado na busca.",
      },
      {
        chave: "alterados",
        titulo: "Dados Alterados",
        rotuloCartao: "Alterados",
        total: log.atualizados,
        tom: "primario",
        Icone: UserCheck,
        itens: atualizados.map(p => ({
          chave: String(p.id),
          nome: p.nome,
          href: `/cadastros/pacientes/${p.id}`,
          direita: p.tita_id ? `ID TiTa ${p.tita_id}` : null,
          mudancas: p.mudancas?.length ? p.mudancas : undefined,
          etiquetas: p.mudancas?.length ? undefined : p.campos.map(c => `+${c}`),
        })),
        dicaFechada: "Toque para ver o que mudou em cada um",
        vazio: "Nenhum dado alterado nesta rodada.",
        buscaPlaceholder: "Buscar paciente ou campo alterado...",
        semResultado: "Nenhum paciente encontrado na busca.",
      },
    ],
  }
}

// ── Profissionais e disponibilidade (tita_importacoes) ────────────────────────

const doTipo = (itens: ItemImportacaoTita[] | undefined, tipo: ItemImportacaoTita["tipo"]) =>
  (itens ?? []).filter(i => i.tipo === tipo)

function rodadaBase(imp: ImportacaoTita) {
  return {
    id: imp.id,
    iniciadoEm: imp.iniciado_em,
    situacao: imp.situacao === "previa" || imp.situacao === "aplicando" ? "previa" as const
      : imp.situacao === "descartada" ? "erro" as const
      : imp.situacao,
    origemLonga: imp.origem === "cron" ? "Automático" : "Disparo manual",
    origemCurta: imp.origem === "cron" ? "Automático" : "Manual",
    usuarioNome: imp.usuario_nome,
    erroMensagem: imp.erro_mensagem,
    noTita: imp.vistos_na_tita,
  }
}

/** Cadastro de profissionais. Sem `itens` = só os contadores (o histórico detalha sob demanda). */
export function rodadaDeProfissionais(imp: ImportacaoTita, itens?: ItemImportacaoTita[]): RodadaRelatorio {
  const vinc = imp.extras?.vinculados_por_cpf ?? 0
  const href = (i: ItemImportacaoTita) => (i.entidade_id ? `/cadastros/profissionais/${i.entidade_id}` : null)
  return {
    ...rodadaBase(imp),
    resumoHistorico: [
      plural(imp.novos, "novo", "novos"),
      plural(imp.alterados, "alterado", "alterados"),
      ...(vinc > 0 ? [`${vinc} por CPF`] : []),
    ],
    secoes: [
      {
        chave: "novos",
        titulo: "Novos Profissionais",
        rotuloCartao: "Novos",
        total: imp.novos,
        tom: "verde",
        Icone: UserPlus,
        itens: doTipo(itens, "novo").map(i => ({
          chave: String(i.id),
          nome: i.nome,
          href: href(i),
          subtitulo: [`ID TiTa ${i.tita_id ?? "—"}`, i.resumo].filter(Boolean).join(" · "),
          selo: "Novo",
        })),
        dicaFechada: "Toque para abrir e ver os nomes",
        vazio: "Nenhum profissional novo nesta rodada.",
        buscaPlaceholder: "Buscar profissional novo...",
        semResultado: "Nenhum profissional encontrado na busca.",
      },
      {
        chave: "alterados",
        titulo: "Dados Alterados",
        rotuloCartao: "Alterados",
        total: imp.alterados,
        tom: "primario",
        Icone: UserCheck,
        itens: doTipo(itens, "alterado").map(i => ({
          chave: String(i.id),
          nome: i.nome,
          href: href(i),
          direita: i.tita_id ? `ID TiTa ${i.tita_id}` : null,
          mudancas: i.mudancas,
        })),
        dicaFechada: "Toque para ver o que mudou em cada um",
        vazio: "Nenhum dado alterado nesta rodada.",
        buscaPlaceholder: "Buscar profissional ou campo alterado...",
        semResultado: "Nenhum profissional encontrado na busca.",
      },
    ],
  }
}

function itemDisponibilidade(i: ItemImportacaoTita, aplicada: boolean): ItemRelatorio {
  return {
    chave: String(i.id),
    nome: i.nome,
    href: i.entidade_id ? `/cadastros/profissionais/${i.entidade_id}?aba=disponibilidade` : null,
    subtitulo: [i.tita_id ? `ID TiTa ${i.tita_id}` : null, i.resumo].filter(Boolean).join(" · ") || null,
    selo: aplicada && (i.tipo === "novo" || i.tipo === "alterado") && !i.aplicado_em ? "Não gravado" : null,
    mudancas: i.mudancas,
    etiquetas: i.etiquetas,
    erro: i.erro,
  }
}

/**
 * Disponibilidade em massa — serve à prévia (antes de gravar) e às execuções
 * concluídas. "No TiTa" = profissionais com horários na grade das duas semanas.
 */
export function rodadaDeDisponibilidade(imp: ImportacaoTita, itens?: ItemImportacaoTita[]): RodadaRelatorio {
  const p = imp.parametros ?? {}
  const aplicada = imp.situacao === "sucesso" || imp.situacao === "parcial" || imp.situacao === "erro"
  const lista = (tipo: ItemImportacaoTita["tipo"]) => doTipo(itens, tipo).map(i => itemDisponibilidade(i, aplicada))
  const secoes: SecaoRelatorio[] = [
    {
      chave: "novos",
      titulo: "Disponibilidades novas",
      rotuloCartao: "Novos",
      total: imp.novos,
      tom: "verde",
      Icone: CalendarPlus,
      itens: lista("novo"),
      dicaFechada: "Toque para ver quem passa a ter disponibilidade",
      vazio: "Ninguém novo nesta rodada.",
      buscaPlaceholder: "Buscar profissional...",
      semResultado: "Nenhum profissional encontrado na busca.",
      rotuloSoPara: null,
    },
    {
      chave: "alterados",
      titulo: "Disponibilidades alteradas",
      rotuloCartao: "Alterados",
      total: imp.alterados,
      tom: "primario",
      Icone: CalendarSync,
      itens: lista("alterado"),
      dicaFechada: "Toque para ver o que muda em cada um",
      vazio: "Nenhuma disponibilidade alterada nesta rodada.",
      buscaPlaceholder: "Buscar profissional ou dia...",
      semResultado: "Nenhum profissional encontrado na busca.",
      rotuloSoPara: null,
    },
  ]
  if (imp.pendencias > 0) {
    secoes.push({
      chave: "pendencias",
      titulo: "Pendências",
      rotuloCartao: "Pendências",
      total: imp.pendencias,
      tom: "ambar",
      Icone: AlertTriangle,
      itens: lista("pendencia"),
      dicaFechada: "Não entram até resolver — toque para ver o motivo",
      vazio: "Nenhuma pendência.",
      buscaPlaceholder: "Buscar profissional ou sala...",
      semResultado: "Nenhum profissional encontrado na busca.",
      rotuloSoPara: null,
    })
  }
  if (imp.sem_grade > 0) {
    secoes.push({
      chave: "sem_grade",
      titulo: "Sem horários no TiTa",
      total: imp.sem_grade,
      tom: "cinza",
      Icone: CalendarX,
      itens: lista("sem_grade"),
      dicaFechada: "Nada muda para eles — toque para ver os nomes",
      vazio: "Todos têm horários no TiTa.",
      buscaPlaceholder: "Buscar profissional...",
      semResultado: "Nenhum profissional encontrado na busca.",
      rotuloSoPara: null,
    })
  }
  if (imp.iguais > 0) {
    secoes.push({
      chave: "iguais",
      titulo: "Iguais ao TiTa",
      total: imp.iguais,
      tom: "cinza",
      Icone: CheckCircle2,
      itens: lista("igual"),
      dicaFechada: "Já batem com o TiTa — nada a gravar",
      vazio: "Nenhum.",
      buscaPlaceholder: "Buscar profissional...",
      semResultado: "Nenhum profissional encontrado na busca.",
      rotuloSoPara: null,
    })
  }
  return {
    ...rodadaBase(imp),
    nota: p.vigente_de
      ? `Vale a partir de ${dataBR(p.vigente_de)} · grade do TiTa de ${dataBR(p.semana_de)} a ${dataBR(p.semana_ate)}`
        + (aplicada ? ` · ${plural(imp.aplicados, "gravado", "gravados")}${imp.erros ? `, ${plural(imp.erros, "com erro", "com erro")}` : ""}` : "")
      : null,
    resumoHistorico: [
      plural(imp.novos, "novo", "novos"),
      plural(imp.alterados, "alterado", "alterados"),
      ...(imp.pendencias ? [plural(imp.pendencias, "pendência", "pendências")] : []),
      ...(imp.erros ? [plural(imp.erros, "com erro", "com erro")] : []),
    ],
    secoes,
  }
}

// ── Agenda (grade_importacoes + grade_importacoes_itens) ──────────────────────

const ROTULO_PENDENCIA_GRADE: Record<string, string> = {
  paciente_sem_cadastro: "Paciente sem cadastro no Pulsar",
  profissional_sem_cadastro: "Profissional sem cadastro no Pulsar",
  terapia_sem_catalogo: "Terapia fora do Cadastro de Terapias",
}

const diaCurto = (iso: string | null) => {
  if (!iso) return ""
  const dow = new Date(`${iso.slice(0, 10)}T12:00:00Z`).getUTCDay()
  return `${dow === 0 ? "Dom" : curtoDia(dow)} ${dataBR(iso).slice(0, 5)}`
}
const LINHAS_POR_PROFISSIONAL = 40

/** Sessões agrupadas por profissional: um item por profissional, uma linha por sessão. */
function porProfissional(itens: ItemImportacaoGrade[], prefixo: string): ItemRelatorio[] {
  const grupos = new Map<string, ItemImportacaoGrade[]>()
  for (const i of itens) {
    const k = i.profissional_nome ?? "Sem profissional"
    grupos.set(k, [...(grupos.get(k) ?? []), i])
  }
  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([nome, lista]) => {
      const pacientes = new Set(lista.map(i => i.paciente_nome)).size
      const extras = lista.length - LINHAS_POR_PROFISSIONAL
      return {
        chave: `${prefixo}:${nome}`,
        nome,
        href: lista[0]?.profissional_id ? `/cadastros/profissionais/${lista[0].profissional_id}` : null,
        subtitulo: `${plural(lista.length, "sessão", "sessões")} · ${plural(pacientes, "paciente", "pacientes")}`,
        mudancas: lista.slice(0, LINHAS_POR_PROFISSIONAL).map(i => ({
          campo: `${diaCurto(i.data)} ${i.hora ?? ""}`.trim(),
          para: [i.paciente_nome, i.terapia, i.sala].filter(Boolean).join(" · "),
        })),
        etiquetas: extras > 0 ? [`+ ${extras} outras sessões`] : undefined,
      }
    })
}

/** Uma importação da agenda. Sem `itens` = só os contadores (o histórico detalha sob demanda). */
export function rodadaDeGrade(imp: ImportacaoGrade, itens?: ItemImportacaoGrade[]): RodadaRelatorio {
  const a = imp.aplicado ?? ({} as ImportacaoGrade["aplicado"])
  const c = imp.contadores ?? ({} as ImportacaoGrade["contadores"])
  const lista = itens ?? []
  const doTipoG = (...tipos: ItemImportacaoGrade["tipo"][]) => lista.filter(i => tipos.includes(i.tipo))
  const novas = a.sessoes_novas ?? 0
  const alteradas = a.alteradas ?? 0
  const sairam = a.sumidos_excluidos ?? 0
  const voltaram = a.restauradas ?? 0
  const bloqueios = (a.bloqueios ?? 0) + (a.bloqueios_excluidos ?? 0)
  const pendencias = imp.pendencias ?? []

  const secoes: SecaoRelatorio[] = [
    {
      chave: "novos",
      titulo: "Sessões novas",
      rotuloCartao: "Novas",
      total: novas,
      tom: "verde",
      Icone: CalendarPlus,
      itens: porProfissional(doTipoG("novo"), "novo"),
      dicaFechada: "Toque para ver o que entrou, por profissional",
      vazio: "Nenhuma sessão nova nesta rodada.",
      buscaPlaceholder: "Buscar profissional, paciente ou terapia...",
      semResultado: "Nada encontrado na busca.",
      rotuloSoPara: null,
    },
    {
      chave: "alterados",
      titulo: "Alteradas no TiTa",
      rotuloCartao: "Alteradas",
      total: alteradas,
      tom: "primario",
      Icone: CalendarSync,
      itens: doTipoG("alterado").map(i => ({
        chave: String(i.id),
        nome: `${i.paciente_nome ?? "?"} — ${i.profissional_nome ?? "?"}`,
        mudancas: [{ campo: "Sessão", de: i.de, para: `${diaCurto(i.data)} ${i.hora ?? ""}${i.sala ? ` · ${i.sala}` : ""}` }],
      })),
      dicaFechada: "Toque para ver como era e como ficou",
      vazio: "Nenhuma sessão alterada nesta rodada.",
      buscaPlaceholder: "Buscar paciente ou profissional...",
      semResultado: "Nada encontrado na busca.",
      rotuloSoPara: null,
    },
    {
      chave: "sumidos",
      titulo: "Saíram (não estão mais no TiTa)",
      rotuloCartao: "Saíram",
      total: sairam,
      tom: "ambar",
      Icone: CalendarMinus,
      itens: porProfissional(doTipoG("sumido"), "sumido"),
      dicaFechada: "Toque para ver o que saiu, por profissional",
      vazio: "Nada saiu nesta rodada.",
      buscaPlaceholder: "Buscar profissional, paciente ou terapia...",
      semResultado: "Nada encontrado na busca.",
      rotuloSoPara: null,
    },
  ]
  if (voltaram > 0 || doTipoG("restaurado").length) {
    secoes.push({
      chave: "restaurados",
      titulo: "Voltaram (excluídas aqui, ainda no TiTa)",
      total: voltaram,
      tom: "primario",
      Icone: RotateCcw,
      itens: porProfissional(doTipoG("restaurado"), "restaurado"),
      dicaFechada: "O TiTa manda: toque para ver o que voltou",
      vazio: "Nada voltou nesta rodada.",
      buscaPlaceholder: "Buscar profissional ou paciente...",
      semResultado: "Nada encontrado na busca.",
      rotuloSoPara: null,
    })
  }
  if (bloqueios > 0 || doTipoG("bloqueio", "bloqueio_sumido").length) {
    secoes.push({
      chave: "bloqueios",
      titulo: "Bloqueios",
      total: bloqueios,
      tom: "cinza",
      Icone: Lock,
      itens: doTipoG("bloqueio", "bloqueio_sumido").map(i => ({
        chave: String(i.id),
        nome: i.profissional_nome ?? "?",
        subtitulo: `${diaCurto(i.data)} ${i.hora ?? ""} · ${i.paciente_nome ?? ""}`,
        selo: i.tipo === "bloqueio" ? "Novo" : "Saiu",
      })),
      dicaFechada: "Horário bloqueado / administrativo do TiTa",
      vazio: "Nenhum bloqueio nesta rodada.",
      buscaPlaceholder: "Buscar profissional...",
      semResultado: "Nada encontrado na busca.",
    })
  }
  if (pendencias.length) {
    secoes.push({
      chave: "pendencias",
      titulo: "Pendências de cadastro",
      total: c.pendencias ?? pendencias.reduce((s, p) => s + p.sessoes, 0),
      tom: "ambar",
      Icone: AlertTriangle,
      itens: pendencias.map((p, i) => ({
        chave: `p${i}`,
        nome: p.nome ?? "?",
        subtitulo: `${ROTULO_PENDENCIA_GRADE[p.motivo] ?? p.motivo}${p.tita_id ? ` · ID TiTa ${p.tita_id}` : ""}`,
        direita: plural(p.sessoes, "sessão", "sessões"),
      })),
      dicaFechada: "Não entram até cadastrar — toque para ver quem",
      vazio: "Nenhuma pendência.",
      buscaPlaceholder: "Buscar nome...",
      semResultado: "Nada encontrado na busca.",
    })
  }

  const aplicada = imp.situacao === "aplicada"
  return {
    id: imp.id,
    iniciadoEm: imp.aplicada_em ?? imp.criado_em,
    situacao: aplicada ? "sucesso" : "previa",
    origemLonga: "Disparo manual",
    origemCurta: "Manual",
    usuarioNome: imp.aplicada_por_nome ?? imp.criado_por_nome,
    erroMensagem: null,
    noTita: c.lidas ?? 0,
    nota: `Agenda de ${dataBR(imp.janela_inicio)} a ${dataBR(imp.janela_fim)}`
      + ((a.series_encerradas ?? 0) > 0 ? ` · ${plural(a.series_encerradas, "série encerrada", "séries encerradas")} (acabaram no TiTa)` : "")
      + ((c.ja_no_pulsar ?? 0) > 0 ? ` · ${plural(c.ja_no_pulsar ?? 0, "sessão já criada", "sessões já criadas")} no Pulsar (intocadas)` : ""),
    resumoHistorico: [
      plural(novas, "nova", "novas"),
      plural(alteradas, "alterada", "alteradas"),
      `${sairam} saíram`,
      ...(voltaram ? [`${voltaram} voltaram`] : []),
    ],
    secoes,
  }
}
