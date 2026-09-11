// Junção do Controle de Prazos do PDI: relatório Órbita (elegibilidade) +
// cadastro de paciente + dado manual (`pdi_controle_prazos`) + agenda/grade,
// produzindo uma linha (`ItemPdi`) por paciente elegível.
//
// Módulo PURO — mesmo papel que `lib/laudos/acompanhamento.ts::juntarComAcompanhamento`
// cumpre para Acompanhamento de Laudos: nenhum import de supabase, `hoje` é
// sempre parâmetro (nunca `new Date()` aqui dentro — mesmo raciocínio do
// cabeçalho de lib/pdi/datas.ts). As três leituras de rede (relatório,
// pacientes, pdi_controle_prazos) e a leitura de grade vivem no chamador
// (services/pdi/prazos.ts, `server-only`) — este arquivo só cruza o que já
// chegou em memória.
//
// ─── A chave de casamento ─────────────────────────────────────────────────
//
// `idFavorecido` ("ID Favorecido" do relatório) = `pacientes.tita_paciente_id`
// = `paciente_id` na grade (`csv_grades_profissionais`/`vw_grade_base`) — os
// três são o MESMO espaço de identidade vindo do TiTa (confirmado em
// supabase/migrations/20260817190000_pacientes_canonica.sql: `tita_paciente_id`
// é "a chave ESTÁVEL vinda do TiTa (raw_json.favorecido.id, gravado em
// agenda_tita.paciente_id)", e csv_grades_profissionais.paciente_id vem da
// mesma sincronização). Por isso toda a junção abaixo indexa por esse número —
// nunca por nome.
//
// ─── Paciente elegível sem cadastro no Pulsar ────────────────────────────
//
// Mesmo padrão de Acompanhamento de Laudos (`juntarComAcompanhamento` em
// lib/laudos/acompanhamento.ts, ver o cabeçalho de lá): `public.pacientes` é
// ENRIQUECIMENTO OPCIONAL, nunca pré-condição de entrada. Correção de
// 04/09/2026 — a versão anterior desta função DESCARTAVA o paciente elegível
// sem cadastro, porque `pdi_controle_prazos.paciente_id` tinha FK dura para
// `public.pacientes(id_paciente)`. A FK foi removida (ver
// 20260904120000_pdi_controle_prazos.sql): `paciente_id` é o
// `tita_paciente_id`/"ID Favorecido" puro, e `public.pacientes` não é 100%
// adotado — muitos pacientes reais (ativos na TiTa, com laudo, com agenda)
// não têm linha lá. Um paciente sem cadastro agora fica com `fotoPath: null`,
// `ativo: null` (não "false" — inativo é um FATO do cadastro, ausência de
// cadastro é outra coisa) e `nome` cai para o nome do relatório Órbita (o
// mesmo `laudoRows` que já alimenta `calcularElegibilidadePdi`, sem leitura
// nova). `juntarPdi` devolve a contagem de `semCadastroPulsar`, para quem
// chama decidir se avisa (mesmo padrão de `descartadas`/`semCadastro` em
// `agruparLaudos`/`juntarComAcompanhamento`) — mas a lista NUNCA é filtrada
// por isso.

import type { LaudoRow } from "@/types/cronograma"
import { calcularElegibilidadePdi } from "@/lib/pdi/elegibilidade"
import { calcularCadastroDuplicadoTita } from "@/lib/pdi/duplicidade"
import {
  aplicadoresDetalhados,
  coordenadoresDetalhados,
  diasClinicos,
  temAgendamentoAmbienteNatural,
  temAgendamentoFuturo,
  temAgendamentoPrimeiraSemanaMesSeguinte,
  temTerapiaAbaPrimeiraSemanaMesSeguinte,
  turnoClinico,
  PACIENTES_PLACEHOLDER,
  TERAPIAS_ABA,
  type LinhaGradePdi,
} from "@/lib/pdi/agenda"
import { dataImplementacaoPic, prazoFechamento, prazoRelatorio } from "@/lib/pdi/datas"
import { calcularPrioridade, calcularStatus, diasRestantes as calcularDiasRestantes } from "@/lib/pdi/status"
import type { ItemPdi } from "@/lib/pdi/filtros"

/** Lê uma coluna do relatório, tolerando ausência/tipo — mesma convenção de `ler()` em lib/laudos/acompanhamento.ts. */
function ler(row: LaudoRow, ...chaves: string[]): string {
  for (const k of chaves) {
    const v = row[k]
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim()
  }
  return ""
}

function idFavorecidoDe(row: LaudoRow): number | null {
  const bruto = ler(row, "ID Favorecido", "Id Favorecido", "ID Paciente", "Id Paciente")
  return /^\d+$/.test(bruto) ? Number(bruto) : null
}

/**
 * O nome do relatório Órbita por `idFavorecido` — 2º na precedência de nome
 * (ver `juntarPdi`), quando não há cadastro em `public.pacientes`. Mesma
 * fonte que `calcularElegibilidadePdi` já lê; não é uma leitura de rede nova.
 */
function nomesDoRelatorio(rows: LaudoRow[]): Map<number, string> {
  const nomes = new Map<number, string>()
  for (const row of rows) {
    const id = idFavorecidoDe(row)
    if (id === null || nomes.has(id)) continue
    const nome = ler(row, "Paciente")
    if (nome) nomes.set(id, nome)
  }
  return nomes
}

/**
 * O nome gravado na própria linha de grade por `paciente_id` — 3º e último
 * fallback de nome (ver `juntarPdi`): cobre o paciente TRACKED (já tem linha
 * em `pdi_controle_prazos`) que caiu do relatório Órbita de hoje E não tem
 * cadastro em `public.pacientes` — sem isso o card mostraria só o número do
 * ID. `linhasGrade` já é a mesma lista recebida pela função (agora ampliada
 * em services/pdi/prazos.ts para cobrir também os pacientes tracked, não só
 * os elegíveis do relatório).
 */
function nomesDaGrade(linhasGrade: LinhaGradePdi[]): Map<number, string> {
  const nomes = new Map<number, string>()
  for (const linha of linhasGrade) {
    if (linha.paciente_id === null || nomes.has(linha.paciente_id)) continue
    const nome = linha.paciente_nome?.trim()
    if (nome) nomes.set(linha.paciente_id, nome)
  }
  return nomes
}

/** O corte de `public.pacientes` que esta junção usa — ENRIQUECIMENTO OPCIONAL, ver o cabeçalho. */
export interface PacienteParaPdi {
  id_paciente: number
  /** "ID Favorecido" do relatório — a chave de casamento, nunca o nome. */
  tita_paciente_id: number | null
  nome: string
  ativo: boolean
  foto_path: string | null
}

/** O corte de `public.pdi_controle_prazos` que esta junção usa — o dado manual. */
export interface RegistroPdiPrazosBruto {
  paciente_id: number
  especialista_tita_id: number | null
  data_avaliacao: string | null
  data_validade: string | null
  observacoes: string | null
}

/**
 * Cruza relatório + cadastro + dado manual + agenda, produzindo a lista de
 * `ItemPdi` — uma linha por paciente na UNIÃO de três conjuntos:
 *
 *   1. ELEGÍVEL hoje pelo relatório Órbita (`calcularElegibilidadePdi`);
 *   2. TRACKED — já tem linha em `pdi_controle_prazos` (`registros`), mesmo
 *      que o laudo tenha saído do relatório de hoje.
 *   3. COM ABA NA AGENDA — tem terapia de `TERAPIAS_ABA` na grade recebida
 *      (correção de 11/09/2026, ver o bloco sobre laudo × agenda em
 *      lib/pdi/agenda.ts): o laudo do Órbita não é confiável como censo de
 *      quem é de ABA, e sem este conjunto o "PDI - Painel por Analista"
 *      perdia paciente em atendimento real.
 *
 * Menos os `PACIENTES_PLACEHOLDER` (pseudo-pacientes de bloqueio de horário),
 * que são removidos da união em qualquer caso.
 *
 * Decisão do usuário (2026-09-04): a lista NUNCA MAIS perde um paciente que
 * já tem controle PDI iniciado, só porque o laudo dele parou de aparecer no
 * relatório do dia. Cada item ganha `ativoNaGrade` (ver `ItemPdi` em
 * lib/pdi/filtros.ts) — o sinal de "em atendimento" é ter QUALQUER
 * agendamento na janela de grade já buscada (`temAgendamentoFuturo`), não
 * mais a elegibilidade por laudo. `elegibilidadeDoFavorecido` pode não
 * existir para um paciente tracked-só (fora do relatório de hoje): nesse
 * caso `autorizadoAmbienteNatural` cai para `false` (não há como saber sem o
 * relatório) e o item ainda entra normalmente.
 *
 * `linhasGrade` deve trazer as linhas de TODOS os pacientes dessa união (quem
 * chama já filtrou por `paciente_id` — ver o cabeçalho de
 * services/pdi/prazos.ts, que amplia o filtro para incluir os tracked); esta
 * função não filtra de novo, só agrupa por `paciente_id`.
 */
export function juntarPdi(
  laudoRows: LaudoRow[],
  registros: RegistroPdiPrazosBruto[],
  pacientes: PacienteParaPdi[],
  linhasGrade: LinhaGradePdi[],
  hoje: string,
): { itens: ItemPdi[]; semCadastroPulsar: number } {
  const elegibilidade = calcularElegibilidadePdi(laudoRows)
  const nomesRelatorio = nomesDoRelatorio(laudoRows)
  const nomesGrade = nomesDaGrade(linhasGrade)
  // Mesma fonte já em memória (laudoRows) — não é leitura de rede nova. Ver
  // o cabeçalho de lib/pdi/duplicidade.ts para a heurística.
  const cadastrosDuplicados = calcularCadastroDuplicadoTita(laudoRows)

  const porFavorecido = new Map<number, PacienteParaPdi>()
  for (const p of pacientes) {
    if (p.tita_paciente_id === null) continue
    porFavorecido.set(Number(p.tita_paciente_id), p)
  }

  const porPaciente = new Map<number, RegistroPdiPrazosBruto>()
  for (const r of registros) {
    porPaciente.set(Number(r.paciente_id), r)
  }

  const gradePorFavorecido = new Map<number, LinhaGradePdi[]>()
  for (const linha of linhasGrade) {
    if (linha.paciente_id === null) continue
    const atual = gradePorFavorecido.get(linha.paciente_id)
    if (atual) atual.push(linha)
    else gradePorFavorecido.set(linha.paciente_id, [linha])
  }

  // A união: elegível hoje pelo relatório OU já tracked em pdi_controle_prazos
  // OU com terapia de ABA na agenda — ver o comentário de `juntarPdi` acima.
  const idsUniao = new Set<number>()
  for (const [id, e] of elegibilidade) {
    if (e.elegivel) idsUniao.add(id)
  }
  for (const id of porPaciente.keys()) idsUniao.add(id)
  // 3º conjunto (11/09/2026): quem tem ABA na AGENDA. Sem isto, o paciente
  // atendido em ABA cujo laudo não diz exatamente "Psicologia ABA" (visto:
  // "Aplicador ABA", "Coordenador de Caso", ou sem linha ABA nenhuma) nunca
  // chegaria ao "PDI - Painel por Analista", e o coordenador dele apareceria
  // com menos pacientes do que tem de verdade — eram 7 casos em 11/09/2026.
  // Ver o bloco sobre laudo × agenda em lib/pdi/agenda.ts.
  for (const linha of linhasGrade) {
    if (linha.paciente_id === null) continue
    if (!linha.terapia_nome || !TERAPIAS_ABA.has(linha.terapia_nome)) continue
    idsUniao.add(linha.paciente_id)
  }
  // Pseudo-pacientes de bloqueio de horário da TiTa nunca entram na lista —
  // ver `PACIENTES_PLACEHOLDER` em lib/pdi/agenda.ts.
  for (const id of PACIENTES_PLACEHOLDER) idsUniao.delete(id)

  const itens: ItemPdi[] = []
  let semCadastroPulsar = 0

  for (const idFavorecido of idsUniao) {
    // Ausente para um paciente tracked-só (fora do relatório de hoje) — ver o
    // comentário de `juntarPdi` acima.
    const elegibilidadeDoFavorecido = elegibilidade.get(idFavorecido) ?? {
      elegivel: false,
      autorizadoAmbienteNatural: false,
    }

    const paciente = porFavorecido.get(idFavorecido)
    if (!paciente) semCadastroPulsar++

    // `pacienteId` é sempre o `idFavorecido`/tita_paciente_id — a PK de
    // `pdi_controle_prazos` desde a correção de 04/09/2026. `paciente.id_paciente`
    // (a PK interna do Pulsar) não é mais usado como chave em nenhum lugar
    // desta junção, só como origem de nome/foto/ativo quando existe.
    const registro = porPaciente.get(idFavorecido)
    const linhasDoPaciente = gradePorFavorecido.get(idFavorecido) ?? []

    const dataAvaliacao = registro?.data_avaliacao ?? null
    const dataValidade = registro?.data_validade ?? null

    const relatorio = dataAvaliacao ? prazoRelatorio(dataAvaliacao) : null
    const implementacaoPic = relatorio ? dataImplementacaoPic(relatorio) : null
    const fechamento = implementacaoPic ? prazoFechamento(implementacaoPic) : null

    const status = calcularStatus({ prazoFechamento: fechamento, hoje })
    const dias = calcularDiasRestantes(fechamento, hoje)
    const aplicadores = aplicadoresDetalhados(linhasDoPaciente)
    const coordenadores = coordenadoresDetalhados(linhasDoPaciente, hoje)

    itens.push({
      pacienteId: idFavorecido,
      idFavorecido,
      // Precedência: cadastro Pulsar (nome de tratamento, inclui nome social)
      // → nome do relatório Órbita de hoje → nome gravado na própria linha de
      // grade (cobre o tracked-só, fora do relatório e sem cadastro) →
      // último recurso, só o ID. Mesma regra-base de
      // `juntarComAcompanhamento`, estendida com o 3º fallback (ver o
      // cabeçalho e `nomesDaGrade` acima).
      nome:
        paciente?.nome ??
        nomesRelatorio.get(idFavorecido) ??
        nomesGrade.get(idFavorecido) ??
        `Paciente ${idFavorecido}`,
      fotoPath: paciente?.foto_path ?? null,
      // `null` — não "false" — quando não há cadastro: inativo é um FATO do
      // cadastro, ausência de cadastro é uma condição diferente (ver o
      // cabeçalho e `ItemPdi.ativo` em lib/pdi/filtros.ts).
      ativo: paciente?.ativo ?? null,
      semCadastroPulsar: !paciente,

      especialistaTitaId: registro?.especialista_tita_id ?? null,

      dataAvaliacao,
      dataValidade,
      observacoes: registro?.observacoes ?? null,
      prazoRelatorio: relatorio,
      dataImplementacaoPic: implementacaoPic,
      prazoFechamento: fechamento,

      status,
      prioridade: calcularPrioridade(status),
      diasRestantes: dias,

      coordenadorIds: coordenadores.map((c) => c.profissionalId),
      coordenadores,
      autorizadoAmbienteNatural: elegibilidadeDoFavorecido.autorizadoAmbienteNatural,
      elegivel: elegibilidadeDoFavorecido.elegivel,
      temAgendamentoPrimeiraSemanaMesSeguinte: temAgendamentoPrimeiraSemanaMesSeguinte(linhasDoPaciente, hoje),
      temAbaNaAgenda: temTerapiaAbaPrimeiraSemanaMesSeguinte(linhasDoPaciente, hoje),
      cadastroDuplicadoTita: cadastrosDuplicados.has(idFavorecido),

      diasClinicos: diasClinicos(linhasDoPaciente),
      turnoClinico: turnoClinico(linhasDoPaciente),
      temAgendamentoAmbienteNatural: temAgendamentoAmbienteNatural(linhasDoPaciente),
      aplicadores,
      quantidadeAplicadores: aplicadores.length,
      ativoNaGrade: temAgendamentoFuturo(linhasDoPaciente),
    })
  }

  return { itens, semCadastroPulsar }
}
