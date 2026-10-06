import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { onlyDigits, validarCpf } from '@/lib/remuneracao/formatacao'
import { nomeMascarado } from '@/lib/disponibilidadePaciente'
import { estadoDoFormulario, lerJsonLimitado, pacientesPorCpf } from '@/lib/disponibilidadePaciente.server'

// Busca do paciente pelo CPF para o formulário público /disponibilidade-paciente,
// que o responsável abre por um link único do WhatsApp — sem conta, sem token.
//
// O desenho segue /api/ficha-escolar/buscar-paciente e é uma decisão de
// privacidade (dado de saúde, LGPD):
//
//   1. POST, não GET: o CPF não pode ficar na URL, no histórico do navegador
//      nem no log de acesso do proxy.
//   2. Nome MASCARADO ("Maria S. O."): basta para a família reconhecer a
//      criança, e não entrega o nome completo a quem digitar um CPF qualquer.
//   3. Resposta mínima, campo a campo: id, nome mascarado, se o formulário
//      está aberto e, só se estiver, os horários atuais para vir preenchido —
//      nunca quem preencheu antes (o pai não vê o nome nem o telefone da mãe).
//   4. 10 buscas por minuto por IP, porque CPF é enumerável.
//
// O id devolvido volta no envio, e a RPC do envio RECONFERE o CPF contra o
// cadastro. Esta rota não autoriza nada; só ajuda a achar a criança.

const RATE_LIMITE = 10
const RATE_JANELA_MS = 60_000

const SEM_CACHE = { 'Cache-Control': 'no-store' }

export async function POST(request: NextRequest) {
  try {
    return await buscar(request)
  } catch {
    return NextResponse.json({ error: 'Serviço indisponível' }, { status: 500, headers: SEM_CACHE })
  }
}

async function buscar(request: NextRequest) {
  const ip = getClientIp(request)

  if (checkRateLimit(`disponibilidade-paciente:buscar:${ip}`, RATE_LIMITE, RATE_JANELA_MS)) {
    return NextResponse.json(
      { error: 'Muitas tentativas. Aguarde um minuto e tente de novo.' },
      { status: 429, headers: SEM_CACHE }
    )
  }

  const body = await lerJsonLimitado(request)
  const cpf = onlyDigits(body?.cpf ?? '')

  if (cpf.length !== 11 || !validarCpf(cpf)) {
    return NextResponse.json({ error: 'CPF inválido. Confira os números.' }, { status: 400, headers: SEM_CACHE })
  }

  const encontrados = await pacientesPorCpf(cpf)

  const pacientes = await Promise.all(
    encontrados.map(async (p) => {
      const estado = await estadoDoFormulario(p.id_paciente)
      return {
        id: p.id_paciente,
        nome: nomeMascarado(p.nome),
        estado: estado.estado,
        prazo: estado.prazo,
        ultimoEnvioEm: estado.ultimoEnvioEm,
        valoresAtuais: estado.valoresAtuais,
      }
    })
  )

  return NextResponse.json({ pacientes }, { headers: SEM_CACHE })
}
