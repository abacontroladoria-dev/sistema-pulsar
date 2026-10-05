import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { PARENTESCOS } from '@/types/responsavel'
import { conferirTelefone } from '@/lib/responsaveis/conferirTelefone'

// Recebe o formulário escolar preenchido pelo responsável em /ficha-escolar.
//
// Esta rota é PÚBLICA e escreve no banco com service_role, que ignora RLS. Não há
// policy nenhuma protegendo esta escrita: a whitelist de colunas montada abaixo é
// a única barreira que existe. Nunca espalhar o corpo do request num insert aqui.
//
// Duas checagens definem o que entra:
//
//   1. Data de nascimento (obrigatória). O link é único para todos, então a única
//      coisa que amarra o envio a uma criança específica é o responsável saber a
//      data de nascimento dela. Sem isso, qualquer um escreveria no registro de
//      qualquer paciente. É porteiro, não prova.
//
//   2. Telefone (informativo). Cruzado com os responsáveis cadastrados só para
//      gravar `telefone_confere`. NÃO barra o envio: os telefones em
//      `responsaveis` são texto livre sem normalização e o cadastro tem buracos —
//      recusar por divergência bloquearia família legítima.
//
// O que é gravado NÃO é dado conferido; é declaração do responsável, e a ficha
// do paciente precisa exibi-la como tal.

// 5 envios por 10 min por IP. Uma família pode errar a data, corrigir, reenviar.
const RATE_LIMITE = 5
const RATE_JANELA_MS = 10 * 60_000

const TURNOS = ['Manhã', 'Tarde', 'Integral'] as const

// Tetos de tamanho por campo. Existem porque a rota é pública: sem eles, um POST
// com 2 MB de texto entra no banco. Folgados o bastante para nome de escola
// comprida e endereço por extenso.
const LIMITE_CURTO = 120
const LIMITE_LONGO = 300

/**
 * Texto obrigatório. Distingue "não veio" de "veio grande demais" porque as duas
 * situações pedem recados diferentes na tela — dizer "informe o nome da escola"
 * a quem digitou um nome de 500 caracteres manda corrigir a coisa errada.
 */
function textoObrigatorio(
  valor: unknown,
  limite: number
): { ok: true; valor: string } | { ok: false; motivo: 'vazio' | 'longo' } {
  if (typeof valor !== 'string') return { ok: false, motivo: 'vazio' }

  const limpo = valor.trim()

  if (limpo.length === 0) return { ok: false, motivo: 'vazio' }
  if (limpo.length > limite) return { ok: false, motivo: 'longo' }

  return { ok: true, valor: limpo }
}

/** Texto opcional: vazio vira `null`; acima do limite invalida (undefined). */
function textoOpcional(valor: unknown, limite: number): string | null | undefined {
  if (valor === null || valor === undefined || valor === '') return null
  if (typeof valor !== 'string') return undefined

  const limpo = valor.trim()

  if (limpo.length === 0) return null

  return limpo.length <= limite ? limpo : undefined
}

export async function POST(request: NextRequest) {
  try {
    return await enviar(request)
  } catch {
    return NextResponse.json(
      { error: 'Serviço indisponível' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}

async function enviar(request: NextRequest) {
  const ip = getClientIp(request)

  if (checkRateLimit(`ficha-escolar:enviar:${ip}`, RATE_LIMITE, RATE_JANELA_MS)) {
    return NextResponse.json(
      { error: 'Muitos envios. Aguarde alguns minutos.' },
      { status: 429, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const body = await request.json().catch(() => null)

  if (!body || typeof body !== 'object') {
    return NextResponse.json(
      { error: 'Dados inválidos' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const pacienteId = Number(body.paciente_id)

  if (!Number.isInteger(pacienteId) || pacienteId <= 0) {
    return NextResponse.json(
      { error: 'Selecione o paciente na busca.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const nascimento = textoObrigatorio(body.data_nascimento, 10)

  if (!nascimento.ok || !/^\d{4}-\d{2}-\d{2}$/.test(nascimento.valor)) {
    return NextResponse.json(
      { error: 'Informe a data de nascimento do paciente.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const dataNascimento = nascimento.valor

  // ===== Porteiro: a data confere com o cadastro? =====
  const { data: paciente, error: erroPaciente } = await supabaseService
    .from('pacientes')
    .select('id_paciente, data_nascimento')
    .eq('id_paciente', pacienteId)
    .eq('ativo', true)
    .eq('ficticio', false)
    .maybeSingle()

  if (erroPaciente) {
    return NextResponse.json(
      { error: 'Falha ao validar o paciente' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  // Mesma resposta para paciente inexistente e data errada, de propósito: um erro
  // distinto para cada caso transformaria este endpoint num confirmador de "esta
  // criança é paciente daqui" para quem tivesse o link.
  if (!paciente || paciente.data_nascimento !== dataNascimento) {
    return NextResponse.json(
      { error: 'A data de nascimento não confere com o cadastro do paciente.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  // ===== Campos do formulário =====
  const escola = textoObrigatorio(body.escola_nome, LIMITE_CURTO)

  if (!escola.ok) {
    return NextResponse.json(
      {
        error:
          escola.motivo === 'vazio'
            ? 'Informe o nome da escola.'
            : `O nome da escola passou de ${LIMITE_CURTO} caracteres.`,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const escolaNome = escola.valor

  const quemPreencheu = textoObrigatorio(body.preenchido_por_nome, LIMITE_CURTO)

  if (!quemPreencheu.ok) {
    return NextResponse.json(
      {
        error:
          quemPreencheu.motivo === 'vazio'
            ? 'Informe o nome de quem está preenchendo.'
            : `O nome de quem preencheu passou de ${LIMITE_CURTO} caracteres.`,
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const preenchidoPorNome = quemPreencheu.valor

  const escolaEndereco = textoOpcional(body.escola_endereco, LIMITE_LONGO)
  const escolaTelefone = textoOpcional(body.escola_telefone, LIMITE_CURTO)
  const escolaEmail = textoOpcional(body.escola_email, LIMITE_CURTO)
  const coordenadorNome = textoOpcional(body.coordenador_nome, LIMITE_CURTO)
  const turma = textoOpcional(body.turma, LIMITE_CURTO)
  const preenchidoPorTelefone = textoOpcional(body.preenchido_por_telefone, LIMITE_CURTO)

  if (
    escolaEndereco === undefined ||
    escolaTelefone === undefined ||
    escolaEmail === undefined ||
    coordenadorNome === undefined ||
    turma === undefined ||
    preenchidoPorTelefone === undefined
  ) {
    return NextResponse.json(
      { error: 'Algum campo passou do tamanho permitido.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  // Turno e parentesco vêm de listas fechadas — as mesmas dos CHECKs da tabela.
  // Validar aqui transforma erro de banco ("não foi possível salvar") em recado
  // legível, e impede que um POST fora da tela invente valor.
  const turno =
    body.turno === null || body.turno === undefined || body.turno === ''
      ? null
      : TURNOS.includes(body.turno)
        ? (body.turno as string)
        : undefined

  const parentesco =
    body.preenchido_por_parentesco === null ||
    body.preenchido_por_parentesco === undefined ||
    body.preenchido_por_parentesco === ''
      ? null
      : (PARENTESCOS as readonly string[]).includes(body.preenchido_por_parentesco)
        ? (body.preenchido_por_parentesco as string)
        : undefined

  if (turno === undefined || parentesco === undefined) {
    return NextResponse.json(
      { error: 'Turno ou parentesco inválido.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  // ===== Indício: o telefone bate com algum responsável cadastrado? =====
  const telefoneConfere = await conferirTelefone(pacienteId, preenchidoPorTelefone)

  const { error: erroInsert } = await supabaseService
    .from('pacientes_dados_escolares')
    .insert({
      paciente_id: pacienteId,
      escola_nome: escolaNome,
      escola_endereco: escolaEndereco,
      escola_telefone: escolaTelefone,
      escola_email: escolaEmail,
      coordenador_nome: coordenadorNome,
      turma,
      turno,
      preenchido_por_nome: preenchidoPorNome,
      preenchido_por_parentesco: parentesco,
      preenchido_por_telefone: preenchidoPorTelefone,
      telefone_confere: telefoneConfere,
    })

  if (erroInsert) {
    return NextResponse.json(
      { error: 'Não foi possível salvar. Tente novamente.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
