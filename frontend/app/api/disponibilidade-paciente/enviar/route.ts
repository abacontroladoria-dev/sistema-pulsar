import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { supabaseService } from '@/lib/supabase/service'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { onlyDigits, validarCpf } from '@/lib/remuneracao/formatacao'
import { PARENTESCOS } from '@/types/responsavel'
import { conferirTelefone } from '@/lib/responsaveis/conferirTelefone'
import { COLUNAS_CONTEUDO } from '@/lib/disponibilidadePaciente.server'
import {
  DIAS,
  FINS_SESSAO,
  HORARIOS_ESCOLA,
  INICIOS_SESSAO,
  horaCurta,
  paraMinutos,
  type ColunasDisponibilidade,
} from '@/lib/disponibilidadePaciente'

// Recebe a disponibilidade preenchida pelo responsável em /disponibilidade-paciente.
//
// Rota PÚBLICA. Quem decide se o envio entra é a RPC
// disponibilidade_enviar_formulario (20261005160000), não este handler:
//
//   - ela RECONFERE o CPF contra o cadastro do paciente (o id vem do navegador
//     e poderia ser trocado num POST montado à mão);
//   - ela aplica o prazo — 5 dias do primeiro envio, travado depois, reaberto
//     só pela equipe — com lock na linha do prazo;
//   - ela grava uma VERSÃO NOVA. Nada é sobrescrito: se o pai envia X e depois
//     a mãe envia Y, as duas declarações ficam no histórico com nome e
//     parentesco de quem preencheu.
//
// O que fica aqui é a validação de forma, para o recado chegar legível:
// horários só da grade de sessões (decisão do usuário), parentesco da lista
// fechada, tamanhos máximos. O jsonb da RPC é montado campo a campo — nunca
// espalhar o corpo do request.

const RATE_LIMITE = 5
const RATE_JANELA_MS = 10 * 60_000
const LIMITE_CURTO = 120

const SEM_CACHE = { 'Cache-Control': 'no-store' }

function recusa(mensagem: string, status = 400) {
  return NextResponse.json({ error: mensagem }, { status, headers: SEM_CACHE })
}

export async function POST(request: NextRequest) {
  try {
    return await enviar(request)
  } catch {
    return recusa('Serviço indisponível', 500)
  }
}

async function enviar(request: NextRequest) {
  const ip = getClientIp(request)

  if (checkRateLimit(`disponibilidade-paciente:enviar:${ip}`, RATE_LIMITE, RATE_JANELA_MS)) {
    return recusa('Muitos envios. Aguarde alguns minutos.', 429)
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null

  if (!body || typeof body !== 'object') return recusa('Dados inválidos.')

  const pacienteId = Number(body.paciente_id)
  if (!Number.isInteger(pacienteId) || pacienteId <= 0) return recusa('Informe o CPF do paciente novamente.')

  const cpf = onlyDigits(body.cpf)
  if (cpf.length !== 11 || !validarCpf(cpf)) return recusa('CPF inválido. Confira os números.')

  // ===== Quem está preenchendo =====
  const nome = typeof body.preenchido_por_nome === 'string' ? body.preenchido_por_nome.trim() : ''
  if (!nome) return recusa('Informe o seu nome.')
  if (nome.length > LIMITE_CURTO) return recusa(`O seu nome passou de ${LIMITE_CURTO} caracteres.`)

  const parentesco = typeof body.preenchido_por_parentesco === 'string' ? body.preenchido_por_parentesco : ''
  if (!(PARENTESCOS as readonly string[]).includes(parentesco)) return recusa('Escolha o seu parentesco com o paciente.')

  const telefoneBruto = typeof body.preenchido_por_telefone === 'string' ? body.preenchido_por_telefone.trim() : ''
  if (telefoneBruto.length > LIMITE_CURTO) return recusa('O telefone passou do tamanho permitido.')
  const telefone = telefoneBruto || null

  // ===== Horários =====
  // Um valor fora da grade só é aceito se for IGUAL ao que já está gravado no
  // mesmo campo (veio da importação da Órbita e o responsável não mexeu). Sem
  // essa folga, a família que só confirma os dados levaria "horário inválido".
  const { data: atual, error: erroAtual } = await supabaseService
    .from('pacientes_disponibilidade_versoes')
    .select(COLUNAS_CONTEUDO)
    .eq('paciente_id', pacienteId)
    .order('numero_versao', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (erroAtual) return recusa('Serviço indisponível', 500)
  const gravado = (atual ?? {}) as Partial<ColunasDisponibilidade>

  const frequenta =
    body.frequenta_escola === true ? true : body.frequenta_escola === false ? false : body.frequenta_escola == null ? null : undefined
  if (frequenta === undefined) return recusa('Dados inválidos.')

  const lerHora = (campo: keyof ColunasDisponibilidade, grade: readonly string[]): string | null | undefined => {
    const bruto = body[campo]
    if (bruto === null || bruto === undefined || bruto === '') return null
    const h = typeof bruto === 'string' ? horaCurta(bruto) : null
    if (!h) return undefined
    if (grade.includes(h) || horaCurta(gravado[campo] as string | null | undefined) === h) return h
    return undefined
  }

  const dados: Record<string, string | boolean | null> = { frequenta_escola: frequenta }

  const escolaInicio = frequenta ? lerHora('escola_inicio', HORARIOS_ESCOLA) : null
  const escolaFim = frequenta ? lerHora('escola_fim', HORARIOS_ESCOLA) : null
  if (escolaInicio === undefined || escolaFim === undefined) return recusa('Horário da escola inválido.')
  if (frequenta && (!escolaInicio || !escolaFim)) return recusa('Informe o horário de entrada e de saída da escola.')
  if (escolaInicio && escolaFim && (paraMinutos(escolaFim) as number) <= (paraMinutos(escolaInicio) as number)) {
    return recusa('Escola: a saída precisa ser depois da entrada.')
  }
  dados.escola_inicio = escolaInicio
  dados.escola_fim = escolaFim

  for (const dia of DIAS) {
    const inicio = lerHora(`${dia.chave}_inicio`, INICIOS_SESSAO)
    const fim = lerHora(`${dia.chave}_fim`, FINS_SESSAO)
    if (inicio === undefined || fim === undefined) return recusa(`${dia.longo}: horário inválido.`)
    if (!inicio !== !fim) return recusa(`${dia.longo}: escolha o horário de início e de fim.`)
    if (inicio && fim && (paraMinutos(fim) as number) <= (paraMinutos(inicio) as number)) {
      return recusa(`${dia.longo}: o fim precisa ser depois do início.`)
    }
    dados[`${dia.chave}_inicio`] = inicio
    dados[`${dia.chave}_fim`] = fim
  }

  dados.preenchido_por_nome = nome
  dados.preenchido_por_parentesco = parentesco
  dados.preenchido_por_telefone = telefone
  dados.telefone_confere = await conferirTelefone(pacienteId, telefone)

  const { data, error } = await supabaseService.rpc('disponibilidade_enviar_formulario', {
    p_paciente_id: pacienteId,
    p_cpf: cpf,
    p_dados: dados,
  })

  if (error) {
    // 23514 = CHECK. A validação acima deveria ter pego antes; se chegou aqui,
    // o recado continua sendo sobre os horários, não "erro interno".
    if (error.code === '23514' || error.code === '22007') return recusa('Algum horário está inválido. Confira e envie de novo.')
    return recusa('Não foi possível salvar. Tente novamente.', 500)
  }

  const resposta = data as { status?: string; prazo?: string | null; numero_versao?: number } | null

  if (resposta?.status === 'travado') {
    return NextResponse.json(
      { error: 'O prazo para alterar terminou. Para mudar a disponibilidade, fale com a clínica.', travado: true, prazo: resposta.prazo ?? null },
      { status: 409, headers: SEM_CACHE }
    )
  }

  // Mesma resposta para "paciente não existe" e "CPF não é deste paciente": um
  // recado diferente para cada caso confirmaria a quem tenta se aquela criança
  // é paciente da clínica.
  if (resposta?.status !== 'ok') return recusa('O CPF não confere com o cadastro do paciente.')

  return NextResponse.json({ ok: true, prazo: resposta.prazo ?? null }, { headers: SEM_CACHE })
}
