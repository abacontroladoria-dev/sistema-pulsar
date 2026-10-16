import { normTxt } from "@/lib/cronograma/constants"
import { normalizarUnidadeOcupacao } from "@/lib/cronograma/ocupacaoProf"
import { normNumeroSala, parseSalaAgenda } from "@/lib/cronograma/salas"
import { separarTerapias } from "@/lib/cadastros/terapias"
import {
  curtoDia, dataBR, diferencasEntreVersoes, faixasDaGrade, faixasParaRpc, mesmoConteudo, paraMin,
  rascunhoDeVersao, resumoSemana, somarDias, validarRascunho, type HorarioGrade,
} from "@/lib/disponibilidadeProfissional"
import type { LocalDisponivel, RascunhoDisponibilidade, VersaoDisponibilidade } from "@/types/disponibilidadeProfissional"
import type { ItemPreviaDisponibilidade } from "@/types/titaImportacao"

// Disponibilidade a partir da grade do TiTa — a MESMA conta para o botão de um
// profissional ("Preencher a partir da grade do TiTa", no editor) e para o de
// todos ("Gravar no Pulsar a disponibilidade do TiTa", na lista). Pura: sem
// React, sem Supabase.

/** Uma linha da cópia da grade do TiTa (vw_grade_base). Livre e Agendado contam igual. */
export type LinhaGradeTita = {
  data: string
  hora_inicial: string
  hora_final: string
  terapia_nome: string | null
  sala_nome: string | null
}

type TerapiaCatalogo = { id: number; nome: string; ativo?: boolean }

/** Casa o sala_nome do TiTa com um local de Ocupação de Salas (unidade + número, ou nome). */
export function casarLocal(salaNome: string | null, locais: LocalDisponivel[]): string | null {
  if (!salaNome) return null
  const p = parseSalaAgenda(salaNome)
  if (p) {
    const daUnidade = locais.filter(l => normalizarUnidadeOcupacao(l.unidade_nome) === p.unidade)
    const achado = p.numeroSala
      ? daUnidade.find(l => normNumeroSala(l.numero_sala) === p.numeroSala)
      : daUnidade.length === 1 ? daUnidade[0] : undefined
    if (achado) return achado.id
  }
  const n = normTxt(salaNome)
  return locais.find(l => normTxt(l.nome_exibicao) === n || normTxt(l.sala_nome_referencia) === n)?.id ?? null
}

/**
 * Semana que vem e a seguinte (segunda a sábado). Duas semanas porque um
 * feriado ou um horário quinzenal numa semana só "apagaria" a faixa. A grade do
 * TiTa vai até o fim do mês seguinte, então as duas sempre estão cobertas.
 */
export function janelaGradeTita(hoje: string): { de: string; ate: string } {
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay()
  const segunda = somarDias(hoje, ((8 - dow) % 7) || 7)
  return { de: segunda, ate: somarDias(segunda, 12) }
}

export type MontagemTita = {
  rascunho: RascunhoDisponibilidade
  /** Faixas com terapia fora do Cadastro de Terapias (as que sobram entram). */
  foraDoCatalogo: string[]
  salasSemCasamento: string[]
}

/**
 * Faixas a partir das linhas do TiTa. As duas semanas se somam por dia da
 * semana: o mesmo horário que aparece nas duas vira um só.
 */
export function montarDaGradeTita(linhas: LinhaGradeTita[], catalogo: TerapiaCatalogo[], locais: LocalDisponivel[]): MontagemTita {
  const porNome = new Map(catalogo.filter(t => t.ativo !== false).map(t => [normTxt(t.nome), t.id]))
  const foraDoCatalogo = new Set<string>()
  const horarios: HorarioGrade[] = linhas.map(l => {
    const dia = new Date(`${l.data.slice(0, 10)}T12:00:00Z`).getUTCDay()
    const terapias = separarTerapias(l.terapia_nome).map(n => {
      const id = porNome.get(normTxt(n))
      if (id === undefined) foraDoCatalogo.add(n)
      return id
    }).filter((x): x is number => x !== undefined)
    return { dia, inicio: l.hora_inicial.slice(0, 5), fim: l.hora_final.slice(0, 5), terapias, localId: casarLocal(l.sala_nome, locais), salaTita: l.sala_nome }
  }).filter(h => h.dia >= 1 && h.dia <= 6)
  const { faixas, salasSemCasamento } = faixasDaGrade(horarios)
  return {
    rascunho: { diasAtivos: [...new Set(faixas.map(f => f.dia))].sort((a, b) => a - b), faixas },
    foraDoCatalogo: [...foraDoCatalogo],
    salasSemCasamento,
  }
}

/**
 * "Pacientes por horário" não existe no TiTa. Faixa nova que cai no mesmo dia,
 * local e horário de uma faixa em grupo da versão atual herda a capacidade dela,
 * em vez de voltar a 1 sem ninguém pedir.
 */
export function herdarCapacidade(novo: RascunhoDisponibilidade, atual: RascunhoDisponibilidade | null): RascunhoDisponibilidade {
  if (!atual) return novo
  return {
    ...novo,
    faixas: novo.faixas.map(f => {
      const grupo = atual.faixas.find(a =>
        a.dia === f.dia && a.localId === f.localId && (a.capacidade ?? 1) > 1
        && paraMin(a.inicio) < paraMin(f.fim) && paraMin(f.inicio) < paraMin(a.fim))
      return grupo ? { ...f, capacidade: grupo.capacidade } : f
    }),
  }
}

const RASCUNHO_VAZIO: RascunhoDisponibilidade = { diasAtivos: [], faixas: [] }

/**
 * Classifica um profissional para a importação em massa. O TiTa prevalece
 * (decisão de 15/10/2026): o que difere vira "alterado", inclusive a versão
 * editada à mão no Pulsar (que fica no histórico).
 */
export function classificarDisponibilidade(args: {
  profissionalId: number
  nome: string
  linhas: LinhaGradeTita[]
  /** Versões do profissional (substituídas são ignoradas aqui). */
  versoes: VersaoDisponibilidade[]
  vigenteDe: string
  janela: { de: string; ate: string }
  habilitadas: Set<number>
  catalogo: TerapiaCatalogo[]
  locais: LocalDisponivel[]
}): ItemPreviaDisponibilidade {
  const { profissionalId, nome, linhas, vigenteDe, catalogo, locais } = args
  const base = { profissional_id: profissionalId, nome }
  if (!linhas.length) {
    return { ...base, tipo: "sem_grade", resumo: `Sem horários no TiTa de ${dataBR(args.janela.de)} a ${dataBR(args.janela.ate)}. Nada muda.` }
  }

  const nomeTerapia = (id: number) => catalogo.find(t => t.id === id)?.nome ?? `Terapia ${id}`
  const locaisPorId = new Map(locais.map(l => [l.id, l]))
  const nomeLocal = (id: string | null) => {
    const l = id ? locaisPorId.get(id) : undefined
    return l ? `${l.unidade_nome} · ${l.nome_exibicao}` : "sem local"
  }

  const m = montarDaGradeTita(linhas, catalogo, locais)
  const problemas: string[] = []
  for (const s of m.salasSemCasamento) problemas.push(`Sala "${s}" sem correspondência em Ocupação de Salas`)
  if (m.rascunho.faixas.some(f => !f.terapias.length)) {
    problemas.push(`Horário só com terapia fora do Cadastro de Terapias: ${m.foraDoCatalogo.join(", ")}`)
  }
  if (!problemas.length) {
    // Terapias do TiTa contam como habilitadas: a importação habilita as que faltam.
    const todas = new Set([...args.habilitadas, ...m.rascunho.faixas.flatMap(f => f.terapias)])
    const v = validarRascunho(m.rascunho, todas)
    problemas.push(...new Set([...v.gerais, ...[...v.erros.values()].flat()]))
  }
  if (problemas.length) {
    return {
      ...base,
      tipo: "pendencia",
      resumo: "Não entra até resolver. Ajuste e gere outra prévia.",
      mudancas: problemas.map(p => ({ campo: "Pendência", para: p })),
    }
  }

  const ativas = args.versoes.filter(v => v.situacao !== "substituida")
  const atual = ativas.find(v => v.vigente_de <= vigenteDe && (v.vigente_ate === null || v.vigente_ate >= vigenteDe)) ?? null
  const posteriores = ativas.filter(v => v.vigente_de > vigenteDe)
  const rAtual = atual ? rascunhoDeVersao(atual) : null
  const r = herdarCapacidade(m.rascunho, rAtual)

  const habilitar = [...new Set(r.faixas.flatMap(f => f.terapias))].filter(t => !args.habilitadas.has(t)).sort((a, b) => a - b)
  const etiquetas: string[] = []
  if (habilitar.length) etiquetas.push(`Habilita ${habilitar.map(nomeTerapia).join(", ")}`)
  if (m.foraDoCatalogo.length) etiquetas.push(`Ignora ${m.foraDoCatalogo.join(", ")} (fora do Cadastro de Terapias)`)

  const resumo = resumoSemana(r.diasAtivos, r.faixas.map(f => ({ dia_semana: f.dia, hora_inicio: f.inicio, hora_fim: f.fim }))) ?? undefined
  const payload = { dias: r.diasAtivos, faixas: faixasParaRpc(r), habilitar }

  if (!atual && !posteriores.length) {
    const mudancas = diferencasEntreVersoes(RASCUNHO_VAZIO, r, nomeTerapia, nomeLocal)
      .filter(d => d.tipo === "adicionada")
      .map(d => ({ campo: curtoDia(d.dia), para: d.para ?? d.texto }))
    return { ...base, tipo: "novo", resumo, mudancas, etiquetas, payload }
  }
  if (atual && rAtual && !posteriores.length && mesmoConteudo(rAtual, r)) {
    return { ...base, tipo: "igual", resumo }
  }

  if (atual && atual.origem !== "preenchido_tita") etiquetas.unshift("Substitui a versão editada no Pulsar (fica no histórico)")
  for (const p of posteriores) etiquetas.push(`Substitui a versão agendada para ${dataBR(p.vigente_de)}`)
  // O relatório mostra: "Seg: antes ➔ depois", "Seg: Nova faixa: …", "Seg: ~~…~~ removida", "Sex: Dia ligado".
  const mudancas = diferencasEntreVersoes(rAtual ?? RASCUNHO_VAZIO, r, nomeTerapia, nomeLocal).map(d => {
    const campo = curtoDia(d.dia)
    if (d.tipo === "adicionada") return { campo, para: `Nova faixa: ${d.para ?? d.texto}` }
    if (d.tipo === "removida") return { campo, de: d.de ?? d.texto, para: null }
    if (d.tipo === "alterada") return { campo, de: d.de ?? null, para: d.para ?? null }
    return { campo, para: d.texto }
  })
  return { ...base, tipo: "alterado", resumo, mudancas, etiquetas, payload }
}
