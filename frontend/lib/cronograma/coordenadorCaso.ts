// ─── Coordenador de Caso em Ocupação · Paciente ──────────────────────────────
//
// Regras que só existem para esta terapia, usadas por "Criar Novo Cronograma"
// e "Aumentar Cronograma":
//
//   1. Só é sugerida com Psicologia ABA autorizada ≥ 1 no laudo — e gasta esse
//      autorizado (TERAPIA_TO_ESP["Coordenador de Caso"] = "Psicologia ABA").
//   2. No máximo MAX_SESSOES_CC_PACIENTE sessões por paciente na semana,
//      somando as já agendadas e as novas.
//   3. Um coordenador por paciente.
//   4. Um profissional coordena no máximo `limite` pacientes únicos, não
//      fictícios (cc_lim_default em Taxas e Parâmetros, hoje 18). Com 17 ainda
//      recebe mais um; com 18 não recebe nenhum.
//
// Só regras puras aqui. A leitura do banco (carteira e limite) fica em
// coordenadorCasoCarga.ts, para este arquivo poder ser importado por
// novoCronograma.ts e pelos testes sem puxar o cliente Supabase.

import { isFakePatient } from "@/lib/remuneracao/pacientes"
import { normTxt } from "@/lib/cronograma/constants"
import type { AceitePacBundle } from "@/types/acompanhamento"

export const COORDENADOR_CASO = "Coordenador de Caso"
export const MAX_SESSOES_CC_PACIENTE = 3
/** Valor usado quando o parâmetro não pode ser lido (sem acesso a remuneração). */
export const LIMITE_PACIENTES_CC_PADRAO = 18

export interface CarteiraCC {
  /** profissional (normTxt) → chaves dos pacientes que ele coordena. */
  pacientesPorProf: Map<string, Set<string>>
  /** chave do paciente → profissionais (normTxt) que o coordenam. */
  coordPorPaciente: Map<string, Set<string>>
  /** nome do paciente (normTxt) → chave, para casar quem só vem por nome. */
  chavePorNome: Map<string, string>
}

export interface PacienteRef {
  id?: number | string | null
  nome: string
}

export function carteiraVazia(): CarteiraCC {
  return { pacientesPorProf: new Map(), coordPorPaciente: new Map(), chavePorNome: new Map() }
}

/** Chave estável do paciente: id do TiTa quando houver, senão o nome. */
export function chavePaciente(carteira: CarteiraCC, p: PacienteRef): string {
  const id = p.id === null || p.id === undefined ? "" : String(p.id).trim()
  if (id) return `id:${id}`
  const nome = normTxt(p.nome)
  return carteira.chavePorNome.get(nome) ?? `nome:${nome}`
}

function adicionar(carteira: CarteiraCC, prof: string, p: PacienteRef) {
  const profKey = normTxt(prof)
  if (!profKey || (!normTxt(p.nome) && !p.id)) return
  const pacKey = chavePaciente(carteira, p)
  const nome = normTxt(p.nome)
  if (nome && !carteira.chavePorNome.has(nome)) carteira.chavePorNome.set(nome, pacKey)

  const pacs = carteira.pacientesPorProf.get(profKey) ?? new Set<string>()
  pacs.add(pacKey)
  carteira.pacientesPorProf.set(profKey, pacs)

  const profs = carteira.coordPorPaciente.get(pacKey) ?? new Set<string>()
  profs.add(profKey)
  carteira.coordPorPaciente.set(pacKey, profs)
}

export interface LinhaCC {
  profissional: string
  pacienteId: number | string | null
  pacienteNome: string
}

/**
 * Monta a carteira a partir das linhas Agendado de Coordenador de Caso,
 * descartando paciente fictício (Alinhamento, Supervisão, Horário
 * Administrativo…): pela coluna `pacientes.ficticio` quando ela pôde ser lida
 * (`idsFicticios`) e, sempre, pela lista de nomes/ids de isFakePatient — que
 * cobre o localhost sem login, onde a consulta à tabela volta vazia.
 */
export function montarCarteira(linhas: LinhaCC[], idsFicticios: Set<string> = new Set()): CarteiraCC {
  const carteira = carteiraVazia()
  for (const l of linhas) {
    const id = l.pacienteId === null || l.pacienteId === undefined ? "" : String(l.pacienteId).trim()
    if (id && idsFicticios.has(id)) continue
    if (isFakePatient(l.pacienteNome, id || null)) continue
    adicionar(carteira, l.profissional, { id: id || null, nome: l.pacienteNome })
  }
  return carteira
}

/**
 * Acrescenta à carteira os pacotes já confirmados na tela que ainda não
 * chegaram à grade. Sem isso, dois operadores (ou o mesmo, em duas rodadas)
 * poderiam passar o profissional do teto antes do sync. Como a carteira é um
 * conjunto de pacientes, o que já está na grade não conta duas vezes.
 */
export function somarBundlesConfirmados(carteira: CarteiraCC, bundles: readonly AceitePacBundle[]): CarteiraCC {
  const nova: CarteiraCC = {
    pacientesPorProf: new Map([...carteira.pacientesPorProf].map(([k, v]) => [k, new Set(v)])),
    coordPorPaciente: new Map([...carteira.coordPorPaciente].map(([k, v]) => [k, new Set(v)])),
    chavePorNome: new Map(carteira.chavePorNome),
  }
  for (const b of bundles) {
    if (b.status !== "confirmado") continue
    if (isFakePatient(b.pac)) continue
    for (const s of b.sessoes) {
      if (s.tP !== COORDENADOR_CASO) continue
      adicionar(nova, s.prof, { id: s.idFavorecidoFallback ?? null, nome: b.pac })
    }
  }
  return nova
}

/** Coordenadores atuais (normTxt) do paciente. */
export function coordenadoresDoPaciente(carteira: CarteiraCC, p: PacienteRef): Set<string> {
  const porChave = carteira.coordPorPaciente.get(chavePaciente(carteira, p))
  if (porChave) return porChave
  // Quem chega com id pode estar na carteira só pelo nome (pacote confirmado
  // sem id), e vice-versa.
  const porNome = carteira.chavePorNome.get(normTxt(p.nome))
  return (porNome && carteira.coordPorPaciente.get(porNome)) || new Set()
}

export interface SituacaoProfCC {
  pode: boolean
  /** Pacientes que ele já coordena (sem contar este, se for novo para ele). */
  qtd: number
  limite: number
}

/** O profissional pode coordenar este paciente? Já sendo dele, sempre pode. */
export function profPodeReceber(carteira: CarteiraCC, prof: string, p: PacienteRef, limite: number): SituacaoProfCC {
  const pacs = carteira.pacientesPorProf.get(normTxt(prof)) ?? new Set<string>()
  const qtd = pacs.size
  if (coordenadoresDoPaciente(carteira, p).has(normTxt(prof))) return { pode: true, qtd, limite }
  return { pode: qtd < limite, qtd, limite }
}

export interface ValidacaoSelecaoCC {
  carteira: CarteiraCC
  limite: number
  paciente: PacienteRef
  /** Sessões de Coordenador de Caso que o paciente já tem na semana. */
  sessoesExistentes: number
  /** Profissional de cada sessão de Coordenador de Caso marcada agora. */
  selecionadas: readonly { prof: string }[]
}

/**
 * Quantos coordenadores diferentes o paciente ficaria tendo: os atuais mais
 * os das sessões marcadas agora. Acima de 1 bloqueia (um por paciente) — é o
 * número que o cartão mostra ("2 Coordenadores").
 */
export function coordenadoresDistintos(v: ValidacaoSelecaoCC): number {
  if (v.selecionadas.length === 0) return 0
  return new Set([
    ...coordenadoresDoPaciente(v.carteira, v.paciente),
    ...v.selecionadas.map(s => normTxt(s.prof)),
  ]).size
}

/** Mensagens que impedem salvar. Vazio = pode salvar. */
export function validarSelecaoCC(v: ValidacaoSelecaoCC): string[] {
  if (v.selecionadas.length === 0) return []
  const erros: string[] = []

  const total = v.sessoesExistentes + v.selecionadas.length
  if (total > MAX_SESSOES_CC_PACIENTE) {
    const jaTem = v.sessoesExistentes > 0 ? `, ${v.sessoesExistentes} já agendada(s)` : ""
    erros.push(`Coordenador de Caso: no máximo ${MAX_SESSOES_CC_PACIENTE} sessões por paciente (${total} marcadas${jaTem}).`)
  }

  const nomes = new Map<string, string>()
  for (const s of v.selecionadas) nomes.set(normTxt(s.prof), s.prof)
  const todos = new Set([...coordenadoresDoPaciente(v.carteira, v.paciente), ...nomes.keys()])
  if (todos.size > 1) erros.push("Coordenador de Caso: o paciente só pode ter um coordenador.")

  for (const [, prof] of nomes) {
    const sit = profPodeReceber(v.carteira, prof, v.paciente, v.limite)
    if (!sit.pode) erros.push(`${prof} já tem ${sit.qtd} pacientes como Coordenador de Caso (limite ${sit.limite}).`)
  }
  return erros
}

/**
 * Sessões de Coordenador de Caso do paciente na semana: grade + pacotes
 * confirmados, sem contar duas vezes o pacote que já sincronizou (mesmo
 * critério de `seenOf` no gapMap de OcupPacMode).
 */
export function contarSessoesCCSemana(
  daGrade: readonly { dia: string; hora: string; prof: string }[],
  dosBundles: readonly { dia: string; hora: string; prof: string }[],
): number {
  const vistos = new Set<string>()
  for (const s of [...daGrade, ...dosBundles]) {
    vistos.add(`${s.dia}|||${String(s.hora).slice(0, 5)}|||${normTxt(s.prof)}`)
  }
  return vistos.size
}
