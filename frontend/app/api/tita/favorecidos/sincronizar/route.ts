import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { supabaseService } from "@/lib/supabase/service"
import { carregarPermissoesEfetivas } from "@/lib/permissions/carregar"
import { temPermissao } from "@/lib/permissions/resolver"
import { checkRateLimit } from "@/lib/rate-limit"
import { montarMapaConvenioCadastro } from "@/lib/cronograma/convenioCadastro"
import { buscarSituacaoFavorecidos } from "@/services/tita/situacaoFavorecidos"

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

  const r = await buscarSituacaoFavorecidos()
  if (!r.ok) return negar(502, `O TiTa não respondeu o cadastro de pacientes (${r.erro ?? "erro"}).`)

  const mapa = montarMapaConvenioCadastro(r.favorecidos)
  const agora = new Date().toISOString()
  const porId = new Map<number, Record<string, unknown>>()
  for (const f of r.favorecidos) {
    if (f.id == null) continue
    const atual = porId.get(f.id)
    // Linha repetida: mantém a primeira, mas "Ativo" vence "Inativo".
    if (atual && !(atual.situacao === "Inativo" && f.situacao === "Ativo")) continue
    porId.set(f.id, {
      tita_favorecido_id: f.id,
      nome: f.nome || `ID TiTa ${f.id}`,
      situacao: f.situacao,
      plano_saude: mapa.porPacienteId.get(f.id) ?? null,
      plano_em_conflito: mapa.conflitos.has(f.id),
      unidade_nome: f.unidadeNome || null,
      sincronizado_em: agora,
    })
  }
  const linhas = [...porId.values()]
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await supabaseService
      .from("tita_favorecidos_cadastro")
      .upsert(linhas.slice(i, i + 500), { onConflict: "tita_favorecido_id" })
    if (error) {
      console.error("[tita:favorecidos:sincronizar]", error.message)
      const pendente = /tita_favorecidos_cadastro|does not exist|schema cache/i.test(error.message)
      return negar(pendente ? 424 : 500, pendente
        ? "Falta aplicar a migration 20261016140000_pacientes_convenio_do_cadastro_tita.sql."
        : "Não foi possível gravar a cópia do cadastro do TiTa.")
    }
  }
  return NextResponse.json({
    ok: true,
    total: linhas.length,
    comConvenio: linhas.filter(l => l.plano_saude).length,
    emConflito: mapa.conflitos.size,
  })
}
