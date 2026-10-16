import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { supabaseService } from "@/lib/supabase/service"
import { carregarPermissoesEfetivas } from "@/lib/permissions/carregar"
import { temPermissao } from "@/lib/permissions/resolver"
import { checkRateLimit } from "@/lib/rate-limit"
import { gravarCopiaCadastroTita } from "@/services/tita/cargaTita.server"

// Grava a cópia do CADASTRO de pacientes do TiTa (csv_situacao_favorecidos) em
// public.tita_favorecidos_cadastro. É de lá que a importação de pacientes tira
// o convênio (o do cadastro, nunca o do agendamento — decisão de 16/10/2026).
// SÓ LEITURA do TiTa. Chamada antes de importar pacientes (botão da tela e
// página "Carregar do TiTa"); a rotina diária de snapshot grava a mesma cópia.
//
// Plano em conflito (mesmo paciente com dois planos) ou "Não informado" fica
// vazio: a importação não mexe no convênio desse paciente. Mesma regra da aba
// Pacientes (lib/cronograma/convenioCadastro.ts).

const PERMISSOES = ["cadastros_pacientes", "carregar_tita"]

function negar(status: number, mensagem: string) {
  return NextResponse.json({ ok: false, mensagem }, { status })
}

export async function POST() {
  let usuarioId = "dev"
  if (process.env.DISABLE_AUTH !== "true") {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return negar(401, "Sessão expirada. Entre de novo.")
    const { data: perfil } = await supabase.from("usuarios").select("role, ativo").eq("id", user.id).maybeSingle()
    if (!perfil?.ativo) return negar(401, "Usuário não encontrado ou inativo.")
    const codigos = await carregarPermissoesEfetivas(supabase)
    if (!PERMISSOES.some(c => temPermissao((perfil.role as string | null) ?? "", codigos, c))) {
      return negar(403, "Você não tem permissão para atualizar o cadastro do TiTa.")
    }
    usuarioId = user.id
  }
  if (checkRateLimit(`favorecidos-sincronizar:${usuarioId}`, 3, 60 * 1000)) {
    return negar(429, "Atualizado há instantes. Tente de novo em um minuto.")
  }

  const r = await gravarCopiaCadastroTita(supabaseService)
  if (!r.ok) return negar(r.migrationPendente ? 424 : 502, r.mensagem)
  return NextResponse.json({ ok: true, total: r.total, comConvenio: r.comConvenio, emConflito: r.emConflito })
}
