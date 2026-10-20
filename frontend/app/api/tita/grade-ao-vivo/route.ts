import { NextResponse, type NextRequest } from "next/server"
import { AcessoRecusado, exigirPermissao } from "@/lib/permissions/exigirPermissao"
import { buscarGradeTitaAoVivo, MAX_DIAS_AO_VIVO } from "@/services/tita/gradeAoVivo"

const LOG_TAG = "[tita:grade-ao-vivo]"

/**
 * Grade do TiTa lida na hora, para a Ocupação de Paciente conferir o que oferece
 * (ver gradeTitaOcupacao.ts e lib/cronograma/conferenciaTita.ts).
 *
 * Só lê o TiTa. Devolve profissional, data, hora, status, sala e
 * grade_terapeuta_id — nenhum dado de paciente (o endpoint de grade não traz).
 * Exige a mesma permissão da tela porque cada chamada custa ao TiTa uma leitura
 * da unidade inteira por dia pedido.
 */
export async function POST(request: NextRequest) {
  try {
    await exigirPermissao("cronograma_ocupacao_paciente")
  } catch (e) {
    if (e instanceof AcessoRecusado) {
      return NextResponse.json(
        { ok: false, error: e.status === 401 ? "not_authenticated" : "sem_permissao" },
        { status: e.status },
      )
    }
    console.error(`${LOG_TAG} falha ao verificar o acesso`, e)
    return NextResponse.json({ ok: false, error: "falha_ao_verificar_acesso" }, { status: 500 })
  }

  const body = await request.json().catch(() => null) as { desde?: string; ate?: string } | null
  if (!body?.desde || !body?.ate) {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 })
  }

  const r = await buscarGradeTitaAoVivo(body.desde, body.ate)
  if (!r.ok) {
    const status = r.erro === "periodo_invalido" || r.erro === "periodo_longo_demais" ? 400 : 502
    return NextResponse.json(
      { ok: false, error: r.erro, ...(status === 400 ? { maxDias: MAX_DIAS_AO_VIVO } : {}) },
      { status },
    )
  }
  return NextResponse.json({ ok: true, linhas: r.linhas, lidoEm: r.lidoEm })
}
