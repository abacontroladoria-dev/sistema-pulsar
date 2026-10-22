// npx tsx --conditions=react-server modules/atendimento/evolution/ingestao.test.mts

import { confirmarConexaoPeloTrafego } from './ingestao.js'

let falhas = 0
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado)
  if (ok) { console.log(`  ok    ${nome}`); return }
  console.log(`  FALHA ${nome}: esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`)
  falhas++
}

// Dublê do cliente: um canal com status, e o registro das escritas.
function montar(status: string, opcoes: { falhar?: boolean } = {}) {
  const estado = { status, connection_status: status }
  const escritas: string[] = []
  const cliente = {
    schema: () => cliente,
    from: (tabela: string) => {
      let patch: Record<string, unknown> = {}
      let filtroStatus: string[] | null = null
      const q = {
        update: (p: Record<string, unknown>) => { patch = p; return q },
        eq: () => q,
        in: (_c: string, v: string[]) => { filtroStatus = v; return q },
        select: () => {
          if (opcoes.falhar) return Promise.resolve({ data: null, error: new Error('pool') })
          const casa = !filtroStatus || filtroStatus.includes(estado.status)
          if (casa) { estado.status = patch.status as string; escritas.push(tabela) }
          return Promise.resolve({ data: casa ? [{ id: 'ch' }] : [], error: null })
        },
        then: (r: (v: unknown) => void) => {
          estado.connection_status = patch.connection_status as string
          escritas.push(tabela)
          r({ error: null })
        },
      }
      return q
    },
  }
  return { cliente, estado, escritas }
}

const canal = { organization_id: 'org', channel_id: 'ch', inbox_id: 'ib' }

for (const preso of ['connecting', 'disconnected', 'error']) {
  const { cliente, estado, escritas } = montar(preso)
  await confirmarConexaoPeloTrafego(cliente as never, canal)
  checar(`${preso} com tráfego vira active`, [estado.status, estado.connection_status], ['active', 'active'])
  checar(`${preso}: grava canal e conexão`, escritas, ['channels', 'channel_connections'])
}
{
  const { cliente, escritas } = montar('active')
  await confirmarConexaoPeloTrafego(cliente as never, canal)
  checar('já active: só o update filtrado, nada gravado', escritas, [])
}
{
  const { cliente, estado } = montar('suspended')
  await confirmarConexaoPeloTrafego(cliente as never, canal)
  checar('suspended não muda', estado.status, 'suspended')
}
{
  const { cliente } = montar('connecting', { falhar: true })
  let lancou = false
  try { await confirmarConexaoPeloTrafego(cliente as never, canal) } catch { lancou = true }
  checar('erro do banco não lança', lancou, false)
}

console.log(falhas === 0 ? '\nTudo certo.' : `\n${falhas} falha(s).`)
if (falhas > 0) process.exit(1)
