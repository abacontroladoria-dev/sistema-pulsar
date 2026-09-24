import "server-only"

import { createHash } from "node:crypto"
import { supabaseService } from "@/lib/supabase/service"
import type { GradeProfissionalRow } from "./types"
import type { ResumoCriacao } from "./confirmar"

/**
 * Depósito na outbox que faz a inclusão de terapia se anunciar ao cronograma.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * Quando o terapêutico implanta uma terapia nova, ele precisa HOJE lembrar de
 * preencher um formulário no ClickUp que gera um card na lista PACIENTES — é
 * esse card que avisa o setor de cronograma a fazer os trâmites junto ao
 * convênio (cadastro, contrato, guia), todos fora do Pulsar. Em 09/2026 alguém
 * esqueceu e a sessão glosou. Aqui o aviso passa a nascer do próprio ato de
 * implantar, que é o único jeito de o esquecimento deixar de ser possível.
 *
 * POR QUE ISTO VIVE NA ROTA E NÃO NUM TRIGGER
 * A implantação não passa pelo Postgres: a rota escreve direto na API da TiTa, e
 * csv_grades_profissionais só reflete a sessão nova depois do sync, horas
 * depois. Não há o que um trigger capturasse a tempo. Ver o cabeçalho de
 * supabase/migrations/20260902120000_inclusao_terapia_avisa_cronograma.sql.
 *
 * A REGRA QUE GOVERNA ESTE ARQUIVO INTEIRO
 * AVISAR NÃO PODE DERRUBAR IMPLANTAR. A terapia já foi criada na TiTa quando
 * esta função roda; se ela lançasse, o usuário veria erro numa operação que deu
 * certo e tentaria de novo, criando agendamento duplicado. Por isso nada aqui
 * lança — é a mesma blindagem que avisar_glosa_clickup() tem no trigger.
 */

/** Uma sessão como ela entra no jsonb da outbox. */
interface SessaoIncluida {
  csv_grade_id: string
  terapia_nome: string | null
  terapia_exibicao_id: number | null
  profissional_nome: string | null
  dia_semana: string | null
  hora_inicial: string | null
  data_inicial: string | null
  sala_nome: string | null
  id_agenda_fav: number | null
  status_criacao: ResumoCriacao["status"]
  criadas: number
  conflitos: number
}

/** O que a rota entrega, já com grade resolvida e resultado da TiTa em mãos. */
export interface EntradaInclusao {
  csvGradeId: string
  grade: GradeProfissionalRow
  resumo: ResumoCriacao
}

const LOG_TAG = "[inclusao-terapia]"

const DIAS_SEMANA = [
  "domingo", "segunda-feira", "terça-feira", "quarta-feira",
  "quinta-feira", "sexta-feira", "sábado",
]

/**
 * Dia da semana da série, a partir da data da primeira ocorrência.
 *
 * Construído com `Date.UTC` sobre as partes da string, nunca `new Date(iso)`:
 * uma data pura ("2026-09-07") é interpretada como meia-noite UTC, e o servidor
 * rodando em fuso negativo devolveria o dia ANTERIOR. O agendamento é semanal
 * recorrente, então errar o dia da semana erra o card inteiro.
 */
function diaDaSemana(data: string | null | undefined): string | null {
  if (!data) return null
  const m = String(data).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return DIAS_SEMANA[d.getUTCDay()] ?? null
}

/**
 * A chave de deduplicação: hash do conjunto ORDENADO de csv_grade_id.
 *
 * Determinístico de propósito. Um duplo-clique ou um retry de rede reenvia
 * exatamente o mesmo conjunto de slots e colide com o unique index, então o card
 * não duplica; duas implantações genuinamente diferentes têm conjuntos
 * diferentes e passam. Timestamp ou o id do bundle do cliente (que é
 * `${Date.now()}_${pac}`) derrotariam a dedup — cada retry geraria valor novo.
 */
export function montarBundleId(csvGradeIds: string[]): string {
  const ordenados = [...csvGradeIds].sort()
  return createHash("sha256").update(ordenados.join("|")).digest("hex").slice(0, 32)
}

/** A menor data_inicial do conjunto — a "Data de Início da Vigência" do form. */
function menorData(sessoes: SessaoIncluida[]): string | null {
  const datas = sessoes
    .map(s => s.data_inicial)
    .filter((d): d is string => typeof d === "string" && d.length >= 10)
    .map(d => d.slice(0, 10))
  if (datas.length === 0) return null
  return datas.reduce((min, d) => (d < min ? d : min))
}

/**
 * Nome de exibição do usuário que implantou.
 *
 * Lê `usuarios` com o service client em vez de reusar `resolverNomeUsuario` de
 * services/autorizacoes.service.ts: aquela é client-side e guarda o nome num
 * cache de MÓDULO, que num servidor de longa duração vazaria o nome de um
 * usuário para a requisição de outro.
 *
 * Cai no e-mail quando não há linha em `usuarios` — o card precisa dizer quem
 * pediu, e e-mail identifica melhor que "não informado".
 */
export async function resolverNome(userId: string, email: string | null): Promise<string | null> {
  try {
    const { data } = await supabaseService
      .from("usuarios")
      .select("nome")
      .eq("id", userId)
      .maybeSingle()
    return (data?.nome as string | undefined) ?? email
  } catch {
    return email
  }
}

/**
 * Deposita UMA linha por implantação (não por sessão).
 *
 * Decisão do usuário (2026-09-02): um paciente que ganha Fono e T.O. no mesmo
 * ato gera UM card listando as duas — o cronograma trata o paciente de uma vez e
 * a lista PACIENTES não vira mural.
 *
 * `entradas` deve conter SÓ o que a TiTa aceitou (success ou partial_success);
 * quem filtra é o chamador, que é quem sabe o resultado de cada chamada.
 *
 * Nunca lança: toda falha vira log. Ver a regra no topo do arquivo.
 */
export async function registrarInclusaoTerapia(params: {
  pacienteNome: string
  entradas: EntradaInclusao[]
  naoCriadas: number
  /** null cobre DISABLE_AUTH em dev (sem sessão real) — implantado_por é FK anulável. */
  userId: string | null
  userEmail: string | null
  modalidade?: "aumentar" | "novo"
}): Promise<void> {
  const { pacienteNome, entradas, naoCriadas, userId, userEmail, modalidade } = params

  try {
    if (entradas.length === 0) return

    const { data: cfg } = await supabaseService
      .from("inclusoes_terapia_config")
      .select("ativo")
      .eq("id", 1)
      .maybeSingle()

    // Config desligada é o estado NORMAL até a estreia (a coluna nasce false).
    // Sair aqui evita encher a outbox de linhas que ninguém vai enviar e que
    // depois cairiam na guarda de retroatividade — pior, virariam um lote de
    // cards velhos no dia em que alguém ligasse.
    if (!cfg?.ativo) return

    const sessoes: SessaoIncluida[] = entradas.map(({ csvGradeId, grade, resumo }) => ({
      csv_grade_id: csvGradeId,
      terapia_nome: grade.terapia_nome,
      terapia_exibicao_id: grade.terapia_exibicao_id,
      profissional_nome: grade.profissional_nome,
      dia_semana: diaDaSemana(grade.data),
      hora_inicial: grade.hora_inicial,
      data_inicial: grade.data ? String(grade.data).slice(0, 10) : null,
      sala_nome: grade.sala_nome,
      id_agenda_fav: resumo.idAgendaFav ?? null,
      status_criacao: resumo.status,
      criadas: resumo.criadas,
      conflitos: resumo.conflitos,
    }))

    // Convênio e unidade vêm da GRADE, não do cliente. Na tela o convênio sai do
    // CSV de laudos (pacConvMap), que só existe no navegador — lendo daqui o
    // servidor não depende de nada que o cliente mande.
    const primeira = entradas[0].grade

    const bundleId = montarBundleId(entradas.map(e => e.csvGradeId))
    const nome = userId ? await resolverNome(userId, userEmail) : userEmail

    const { error } = await supabaseService
      .from("inclusoes_terapia")
      .insert({
        bundle_id: bundleId,
        paciente_nome: pacienteNome,
        paciente_id: primeira.paciente_id != null ? String(primeira.paciente_id) : null,
        convenio_nome: primeira.convenio_nome,
        unidade_nome: primeira.unidade_nome,
        sessoes,
        sessoes_nao_criadas: naoCriadas,
        data_inicial: menorData(sessoes),
        implantado_por: userId,
        implantado_por_nome: nome,
        implantado_por_email: userEmail,
        modalidade: modalidade ?? null,
      })

    if (error) {
      // 23505 = unique_violation: o mesmo conjunto de slots já foi depositado.
      // É o retry funcionando como projetado, não um problema — registrar como
      // erro faria alguém investigar um sucesso.
      if ((error as { code?: string }).code === "23505") {
        console.log(`${LOG_TAG} bundle já registrado (dedup)`, JSON.stringify({ bundleId }))
        return
      }
      console.error(`${LOG_TAG} falha ao registrar`, JSON.stringify({ bundleId, erro: error.message }))
      return
    }

    console.log(
      `${LOG_TAG} registrado`,
      JSON.stringify({ bundleId, paciente: pacienteNome, sessoes: sessoes.length, naoCriadas }),
    )
  } catch (err) {
    // De propósito: avisar não pode derrubar implantar. Ver o topo do arquivo.
    const mensagem = err instanceof Error ? err.message : String(err)
    console.error(`${LOG_TAG} erro inesperado (implantação NÃO afetada)`, JSON.stringify({ mensagem }))
  }
}
