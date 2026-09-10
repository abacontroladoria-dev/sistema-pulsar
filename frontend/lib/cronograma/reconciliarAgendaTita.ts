// ─── A agenda_tita tem a palavra final sobre sessão AGENDADA ────────────────
//
// A Ocupação de Paciente lê `vw_grade_base` (→ `csv_grades_profissionais`), que
// é alimentada pelo cron `sync-grade-csv-daily`. Em 10/09/2026 descobriu-se que
// esse sync vinha morrendo havia 9 dias sem escrever nada em data futura: pedia
// ~60 dias de uma vez e estourava o compute da Edge Function. O cron descarta a
// resposta HTTP, então a falha foi diária e silenciosa.
//
// O caso que revelou: o Aplicador ABA (PS) do Davi Lucca Alves (11582) com a
// Michele mudou de 10:00 para 10:40 em 02/09. A `agenda_tita` registrou (o
// agendamento 3569319 virou ativo=false, o 3624424 entrou às 10:40); o CSV nunca
// viu — o 3624424 não existe lá em linha nenhuma. A tela mostrava um buraco às
// 10:40 e uma sessão fantasma às 10:00.
//
// Medido na janela da tela (01–07/10, unidade 280), com o sync já quebrado:
//   • 169 linhas `Agendado` no CSV que a agenda_tita não confirma (horário velho)
//   • 134 sessões ativas na agenda_tita que o CSV não tem (invisíveis), em 57
//     pacientes
//
// O sync foi corrigido (fatia de 1 dia), mas os dois pipelines já divergiram
// antes por outros motivos — ver `project_roster_uniao_pipelines`, onde
// profissional novo ficava 24h invisível. Esta reconciliação é a rede de
// segurança: **para linha `Agendado`, quem manda é a agenda_tita.**
//
// ─── O que esta função NÃO faz ─────────────────────────────────────────────
//
// Não toca em slot `Livre`. A agenda_tita só guarda sessão real — na janela
// medida, as 749 linhas `Livre` do CSV têm `tita_agendamento_id` nulo, e não há
// nada do outro lado para casar. Vaga continua vindo do `vw_grade_base`, filtrada
// por gradeTitaOcupacao (regras C1/C2/C3).
//
// Não é fail-closed: leitura vazia ou erro devolve o CSV intacto. Zerar a grade
// por falha de rede seria pior que o problema que a função resolve.

import { getSupabaseClient } from "@/lib/supabase/client"
import { pm, exU } from "@/lib/cronograma/helpers"
import { fixMojibake } from "@/lib/grade/fonte"
import type { CsvRow } from "@/types/cronograma"

const TABELA = "agenda_tita"
const UNIDADE = 280
const PAGE = 1000

/** Uma sessão real, como a agenda_tita a guarda. */
interface LinhaAgenda {
  tita_agendamento_id: number | null
  paciente_id: number | null
  paciente_nome: string | null
  data_atendimento: string | null
  hora_inicial: string | null
  hora_final: string | null
  profissional_id: number | null
  profissional_nome: string | null
  terapia_nome: string | null
  terapia_exibicao_nome: string | null
  convenio_nome: string | null
  sala_nome: string | null
}

const CAMPOS =
  "tita_agendamento_id, paciente_id, paciente_nome, data_atendimento, hora_inicial, "
  + "hora_final, profissional_id, profissional_nome, terapia_nome, terapia_exibicao_nome, "
  + "convenio_nome, sala_nome"

/**
 * Dia da semana em português, como `csv_grades_profissionais` grava.
 *
 * A agenda_tita não tem a coluna, e o resto do módulo casa por ela (`dayHours`,
 * `profOcupado`, `buildSugestoes` — todos indexam por "Dia da Semana"). Montada
 * a partir da data em UTC de propósito: é aritmética de calendário sobre uma
 * data ISO, sem instante nem fuso envolvido.
 */
const DIAS = [
  "Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira",
  "Quinta-feira", "Sexta-feira", "Sábado",
] as const

function diaSemanaDe(data: string): string {
  const [a, m, d] = data.split("-").map(Number)
  return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()] ?? ""
}

/** Converte para o mesmo formato que buscarGradeComoCSVRows entrega. */
function paraCsvRow(l: LinhaAgenda): CsvRow {
  const hi_str = String(l.hora_inicial ?? "").slice(0, 5)
  const salaNome = fixMojibake(l.sala_nome)
  const data = String(l.data_atendimento ?? "").slice(0, 10)
  return {
    CsvGradeId:              undefined,
    PacienteId:              l.paciente_id ?? null,
    ProfissionalId:          l.profissional_id ?? null,
    "Nome Favorecido":       fixMojibake(l.paciente_nome),
    "Dia da Semana":         diaSemanaDe(data),
    "Hora Inicial":          hi_str,
    "Terapia":               fixMojibake(l.terapia_nome),
    "Terapia Exibição":      fixMojibake(l.terapia_exibicao_nome),
    "Profissional":          fixMojibake(l.profissional_nome),
    "Status do Agendamento": "Agendado",
    "Convênio":              fixMojibake(l.convenio_nome),
    "Sala":                  salaNome,
    "Data":                  data,
    HI_str:                  hi_str,
    HI:                      pm(hi_str),
    Unidade:                 exU(salaNome),
  } as unknown as CsvRow
}

/**
 * Troca as linhas `Agendado` do CSV pelo que a agenda_tita afirma no período.
 *
 * Casa por `tita_agendamento_id`, que é a chave dos dois lados e sobrevive a
 * remarcação. Na janela medida, 100% das linhas `Agendado` ativas do CSV têm o
 * id preenchido — quem não tem é slot `Livre`, que esta função não toca.
 *
 * `Livre` passa intacto, na ordem original. As `Agendado` são substituídas em
 * bloco pelas da agenda_tita, então some horário velho e aparece sessão nova de
 * uma vez só.
 */
export async function reconciliarAgendadosComAgendaTita(
  cRows: CsvRow[], de: string, ate: string,
): Promise<CsvRow[]> {
  const sb = getSupabaseClient()

  const linhas: LinhaAgenda[] = []
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from(TABELA)
        .select(CAMPOS)
        .eq("clinica_id", UNIDADE)
        .eq("ativo", true)
        .gte("data_atendimento", de)
        .lte("data_atendimento", ate)
        .order("id")
        .range(from, from + PAGE - 1)

      if (error) throw new Error(error.message)
      const pagina = (data ?? []) as unknown as LinhaAgenda[]
      linhas.push(...pagina)
      if (pagina.length < PAGE) break
    }
  } catch (e) {
    // Fail-open: sem a agenda_tita, o CSV sozinho ainda é melhor que tela vazia.
    console.warn(
      "[reconciliarAgendaTita] Falha ao ler agenda_tita — a grade segue como veio do CSV. "
      + "Sessão remarcada recentemente pode não aparecer.",
      e instanceof Error ? e.message : String(e),
    )
    return cRows
  }

  // Mesma guarda de RLS de gradeTitaOcupacao: leitura vazia é quase sempre
  // sessão não autenticada, e aí trocar tudo apagaria a agenda inteira.
  if (linhas.length === 0) {
    console.warn(
      "[reconciliarAgendaTita] Nenhuma linha lida de agenda_tita — reconciliação desligada. "
      + "Se a tela está mostrando horário errado, verifique se a sessão está autenticada (RLS).",
      JSON.stringify({ de, ate }),
    )
    return cRows
  }

  const livres = cRows.filter(r => r["Status do Agendamento"] !== "Agendado")
  const agendados = linhas
    .filter(l => l.data_atendimento && l.hora_inicial)
    .map(paraCsvRow)

  return [...livres, ...agendados]
}
