import { timingSafeEqual } from "crypto"
import { after, NextResponse } from "next/server"
import { supabaseService } from "@/lib/supabase/service"
import { hojeBrasilia } from "@/lib/disponibilidadeProfissional"
import { gerarRetratosEvolucao } from "@/lib/cronograma/evolucaoSnapshot.server"

// Retrato mensal da evolução de Ocupação Clínica (A15) e Dashboard de
// Pacientes (A16) — gráfico de linhas 1A · 5A · Máx das duas abas.
//
// Chamada pelo pg_cron (docs/ATIVAR_EVOLUCAO_INDICADORES.sql), com o MESMO
// segredo da rotina do TiTa (CARGA_TITA_SEGREDO / Vault carga_tita_segredo —
// decisão de 21/10/2026). Responde 202 na hora e calcula depois (after()).
//
// Corpo (tudo opcional):
//   competencias  ["AAAA-MM", …] — padrão: mês corrente e o seguinte (a grade
//                 planejada vai até o fim do mês seguinte)
//   fechamento    true no dia 5, para o mês anterior (status "fechado")
//   aproximado    true na carga do passado da Ocupação (mapa de salas atual)
//   ocupacao / pacientes  false para pular um dos dois
//
// Sem o segredo certo: 401, sem dizer por quê. Só escreve nas duas
// tabelas-resumo (ocupacao_clinica_historico_resumo, pacientes_historico_resumo).

export const dynamic = "force-dynamic"

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/

function segredoConfere(recebido: string, esperado: string): boolean {
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

function mesMais(competencia: string, n: number): string {
  const [a, m] = competencia.split("-").map(Number)
  const d = new Date(Date.UTC(a, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export async function POST(req: Request) {
  const esperado = process.env.CARGA_TITA_SEGREDO
  if (!esperado || esperado.length < 32) {
    console.error("[evolucao-snapshot] CARGA_TITA_SEGREDO ausente ou curto no servidor")
    return NextResponse.json({ ok: false }, { status: 503 })
  }
  if (!segredoConfere(req.headers.get("x-carga-segredo") ?? "", esperado)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const corpo = (await req.json().catch(() => ({}))) as {
    competencias?: unknown; fechamento?: unknown; aproximado?: unknown; ocupacao?: unknown; pacientes?: unknown
  }
  const hoje = hojeBrasilia()
  const corrente = hoje.slice(0, 7)
  let competencias: string[] = [corrente, mesMais(corrente, 1)]
  if (corpo.competencias !== undefined) {
    if (!Array.isArray(corpo.competencias) || corpo.competencias.length === 0 || corpo.competencias.length > 24
      || !corpo.competencias.every(c => typeof c === "string" && COMPETENCIA.test(c))) {
      return NextResponse.json({ ok: false, mensagem: "competencias: lista de \"AAAA-MM\" (1 a 24)." }, { status: 400 })
    }
    competencias = [...new Set(corpo.competencias as string[])].sort()
  }
  const opcoes = {
    fechamento: corpo.fechamento === true,
    aproximado: corpo.aproximado === true,
    ocupacao: corpo.ocupacao !== false,
    pacientes: corpo.pacientes !== false,
  }

  after(async () => {
    const r = await gerarRetratosEvolucao(supabaseService, competencias, opcoes, hoje)
    console.log("[evolucao-snapshot]", JSON.stringify(r))
  })
  return NextResponse.json({ ok: true, competencias }, { status: 202 })
}
