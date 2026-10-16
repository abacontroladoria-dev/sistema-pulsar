import { AlertTriangle, CalendarPlus, CalendarSync, CalendarX, CheckCircle2, UserCheck, UserPlus } from "lucide-react"
import { dataBR } from "@/lib/disponibilidadeProfissional"
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
