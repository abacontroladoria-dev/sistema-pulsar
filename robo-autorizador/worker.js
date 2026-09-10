/**
 * =========================
 * WORKER RPA
 * =========================
 *
 * O que mudou nesta versão:
 *
 * - NENHUMA credencial de banco no PC. Antes o .env trazia duas cópias da
 *   SUPABASE_SERVICE_ROLE_KEY (as variáveis SUPABASE_KEY e
 *   SUPABASE_SERVICE_ROLE_KEY decodificavam ambas para role:service_role) e todo
 *   acesso era direto às tabelas, sem RLS. Agora só existe a anon key (pública)
 *   e o token desta máquina, protegido por DPAPI.
 * - A identidade vem do SERVIDOR. Antes era `MACHINE_ID=admin` auto-declarado no
 *   .env; agora o servidor devolve o machine_id a partir do token, e é esse
 *   valor que o endpoint /machine-id publica para o frontend rotear a tarefa.
 * - Poll adaptativo. Antes eram 2 requisições a cada 500ms (a fila e o estado da
 *   máquina), 24h por dia, mesmo com a clínica fechada — 4 req/s por PC, o que
 *   alimentava o aperto de Disk IO. Agora é uma chamada, no ritmo que o servidor
 *   determinar, mais lenta quando ocioso.
 * - Existe supervisor. Antes `restart_solicitado` fazia process.exit(0) e nada
 *   relançava o processo: "reiniciar" pelo painel na verdade matava o robô até o
 *   próximo logon do Windows. Agora start.bat tem laço e os códigos de saída
 *   significam algo (0 = relançar, 99 = parar de vez).
 *
 * 1.1.8:
 * - O registro da aba passa a ser entregue ao rpa.js, que marca nele
 *   `aguardandoOperador` enquanto está parado esperando o clique em "enviar".
 *   É essa flag que impede `podar()` de fechar a janela no meio do atendimento
 *   agora que aquela espera não tem mais prazo.
 * - Desfecho novo: `envio_nao_ocorrido`, quando alguém fecha a janela antes do
 *   envio. Vem por RETORNO, como o 'devolvida' do token — um throw passaria por
 *   sessao.descartar().
 */

require('dotenv').config({ path: __dirname + '/.env' })

const fs = require('fs')
const os = require('os')
const path = require('path')
const express = require('express')
const cors = require('cors')
const { chromium } = require('playwright')

const { Api } = require('./api')
const { obterToken } = require('./segredo')
const { SessaoAssim } = require('./assim')
const executarRpa = require('./rpa')
const { verificarEAplicar, versaoAtual } = require('./updater')

// Vem de versao.json quando o robô já se auto-atualizou; de package.json na
// instalação de fábrica.
const VERSAO = versaoAtual()

// Códigos de saída lidos pelo supervisor em start.bat.
const SAIDA_RELANCAR = 0
const SAIDA_PARAR = 99

const HEARTBEAT_MS = 30000
const CONFIG_TTL_MS = 10 * 60000

// Preenchido no primeiro heartbeat. Antes do servidor responder, o robô
// deliberadamente não afirma identidade nenhuma.
let MACHINE_ID = null
let ultimoEstado = null

// =========================
// API LOCAL (127.0.0.1)
// =========================

const app = express()

app.use(cors({
  origin(origin, callback) {
    const permitidos = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://orbitaautomacao.com.br',
    ]
    // Requisição local sem Origin (curl, o próprio Windows) é aceita: o
    // servidor só escuta em 127.0.0.1 e não expõe nada sensível.
    if (!origin) return callback(null, true)
    if (permitidos.includes(origin)) return callback(null, true)
    return callback(new Error('Not allowed by CORS'))
  },
}))

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    worker: 'online',
    machine_id: MACHINE_ID,
    versao: VERSAO,
    ativa: ultimoEstado?.ativa ?? null,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

app.get('/machine-id', (req, res) => {
  // Antes do primeiro heartbeat não há identidade confirmada. Responder 503 é
  // melhor que responder um palpite: frontend/lib/machine.ts já trata resposta
  // não-ok caindo em 'WEB'.
  if (!MACHINE_ID) {
    return res.status(503).json({ error: 'aguardando identificacao no servidor' })
  }
  res.json({ machine_id: MACHINE_ID })
})

// =========================
// LOOP PRINCIPAL
// =========================

const esperar = ms => new Promise(r => setTimeout(r, ms))

async function iniciarWorker() {
  console.log('=================================')
  console.log('🤖 WORKER RPA INICIADO — v' + VERSAO)
  console.log('=================================')

  const token = obterToken()
  const api = new Api(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    token
  )

  const dadosMaquina = {
    hostname: os.hostname(),
    so: `${os.type()} ${os.release()}`,
    versao: VERSAO,
  }

  // Primeiro contato: identidade + estado + config.
  ultimoEstado = await api.heartbeat(dadosMaquina)
  MACHINE_ID = ultimoEstado.machine_id
  console.log('💻 Máquina identificada pelo servidor:', MACHINE_ID)

  // O heartbeat consome restart_solicitado de forma atômica. Se a marca estava
  // ligada agora, no arranque, o pedido já está atendido — acabamos de subir.
  // Sair aqui só provocaria um segundo reinício sem motivo. Mas isso precisa
  // aparecer no log: antes era consumido em silêncio, e quem clicou em
  // "reiniciar" no painel não teria como saber o que aconteceu com o pedido.
  if (ultimoEstado.restart_solicitado) {
    console.log('ℹ️  Havia um pedido de reinício pendente; o processo já é novo, pedido atendido.')
  }

  // Marcador para o supervisor: chegamos a falar com o servidor, então um
  // encerramento daqui para frente é reinício legítimo, não falha de partida.
  // Sem isso, o backoff trataria "reiniciar pelo painel" como crash.
  try {
    fs.writeFileSync(path.join(__dirname, '.saudavel'), new Date().toISOString())
  } catch (e) { /* disco cheio/somente leitura: o robô funciona, só perde o backoff fino */ }

  // Atualiza ANTES de abrir navegador: mais barato reiniciar agora.
  if (await verificarEAplicar(api, VERSAO, ultimoEstado.versao_disponivel)) {
    console.log('🔄 Atualização aplicada — encerrando para o supervisor relançar')
    return SAIDA_RELANCAR
  }

  let cfg = await api.obterConfigAssim()
  let cfgEm = Date.now()
  console.log('⚙️  Configuração da ASSIM carregada do servidor')

  let browser = await chromium.launch({ headless: false })
  console.log('🌐 Browser iniciado')

  const sessao = new SessaoAssim(browser)

  browser.on('disconnected', () => {
    console.log('⚠️ Browser fechado pela recepcionista — será relançado na próxima tarefa')
    browser = null
  })

  // ---- batida de vida, fora do laço ----
  // A batida precisa ser independente do laço porque o laço PARA. `executarRpa`
  // é aguardado nu lá embaixo, e a espera pela identificação do beneficiário
  // (rpa.js, tetoHumano) segura a tarefa por até 15 min — mais de 30 min somando
  // os outros prazos. Com a batida dentro do laço, o `last_seen` congelava todo
  // esse tempo: o painel marcava a máquina como offline (90s de tolerância) e o
  // pedido de reinício não era consumido. O robô parecia travado exatamente
  // quando estava mais ocupado, e foi assim que a recepção o descreveu.
  //
  // O que continua no topo do laço são as DECISÕES (reiniciar, atualizar).
  // Trocar de versão ou fechar o navegador no meio de uma autorização seria
  // trocar um problema por outro pior.
  let restartPedido = false
  let versaoDisponivel = ultimoEstado.versao_disponivel ?? null
  let batendo = false
  // A checagem de atualização morava dentro do `if` da batida, ou seja, rodava
  // no máximo a cada 30s. Solta no topo do laço ela cairia a cada volta do poll
  // — e um pacote que falha o download viraria rajada de `obterPacote` contra o
  // servidor. Esta marca devolve a cadência original.
  let proximaChecagemVersao = 0

  const bater = async () => {
    // Rede ruim + os 4 retries com backoff do api.js podem fazer uma batida
    // durar mais que o intervalo. Empilhar requisição não ressuscita ninguém.
    if (batendo) return
    batendo = true
    try {
      const estado = await api.heartbeat(dadosMaquina)
      ultimoEstado = estado

      // `robo_heartbeat` consome `restart_solicitado` de forma ATÔMICA: o
      // servidor desliga a marca ao responder. Se ela chegar no meio de uma
      // tarefa, descartar aqui seria perder o clique de quem apertou
      // "reiniciar" no painel. Guarda, e o topo do laço obedece quando a tarefa
      // terminar.
      if (estado.restart_solicitado) restartPedido = true
      if (estado.versao_disponivel) versaoDisponivel = estado.versao_disponivel
    } catch (e) {
      // Batida é sinal de vida, não trabalho: falhar aqui não derruba o robô.
      // A próxima tentativa vem em HEARTBEAT_MS.
      console.warn('⚠️  Heartbeat falhou:', e.message)
    } finally {
      batendo = false
    }
  }

  const batida = setInterval(bater, HEARTBEAT_MS)
  // Nunca é a batida que mantém o processo vivo — quem faz isso é a API local.
  // Assim, um caminho de saída que esqueça o clearInterval não pendura o robô.
  batida.unref()

  let ultimaAtividade = Date.now()

  while (true) {
    try {
      // ---- decisões que a batida guardou ----
      if (restartPedido) {
        console.log('🔄 Reinício solicitado pelo painel — encerrando...')
        clearInterval(batida)
        await sessao.fecharTudo()
        return SAIDA_RELANCAR
      }

      if (versaoDisponivel && Date.now() >= proximaChecagemVersao) {
        proximaChecagemVersao = Date.now() + HEARTBEAT_MS
        if (await verificarEAplicar(api, VERSAO, versaoDisponivel)) {
          console.log('🔄 Atualização aplicada — encerrando para o supervisor relançar')
          clearInterval(batida)
          await sessao.fecharTudo()
          return SAIDA_RELANCAR
        }
      }

      // ---- config viva ----
      if (Date.now() - cfgEm >= CONFIG_TTL_MS) {
        cfg = await api.obterConfigAssim()
        cfgEm = Date.now()
      }

      // ---- pausada pelo painel ----
      if (ultimoEstado.ativa === false) {
        await esperar(5000)
        continue
      }

      // ---- housekeeping das abas ----
      await sessao.podar(cfg)

      // ---- tarefa ----
      const tarefa = await api.buscarTarefa()

      if (!tarefa) {
        const ocioso = Date.now() - ultimaAtividade > (Number(cfg.ocioso_apos_ms) || 120000)
        await esperar(Number(ocioso ? cfg.poll_ms_ocioso : cfg.poll_ms_ativo) || 1000)
        continue
      }

      ultimaAtividade = Date.now()
      console.log('📌 Tarefa recebida (já travada pelo servidor):', tarefa.id)
      await api.registrarLog(tarefa.id, 'Iniciando execução')

      if (!browser || !browser.isConnected()) {
        browser = await chromium.launch({ headless: false })
        console.log('🌐 Browser relançado')
        sessao.trocarBrowser(browser)
        browser.on('disconnected', () => {
          console.log('⚠️ Browser fechado pela recepcionista — será relançado na próxima tarefa')
          browser = null
        })
      }

      const cancelado = async () => {
        const status = await api.statusTarefa(tarefa.id).catch(() => null)
        // Status ausente (cancelada e removida da máquina) ou fora dos estados
        // de execução significa: pare.
        return !['processando', 'executando'].includes(status)
      }

      let aba = null

      try {
        aba = await sessao.abrirFormulario(cfg)
        aba.filaId = tarefa.id

        const resultado = await executarRpa({
          page: aba.page,
          tarefa,
          cfg,
          api,
          cancelado,
          // Os alertas que a ASSIM emitiu nesta aba. É por eles que uma recusa
          // do portal deixa de ser confundida com "ninguém clicou em enviar".
          alertas: aba.alertas || [],
          // O registro da aba, para o rpa.js marcar `aguardandoOperador`
          // enquanto está parado esperando o clique em "enviar" — é essa flag
          // que impede a poda de fechar a janela no meio do atendimento.
          aba,
        })

        const DESCRICAO_DESFECHO = {
          sucesso:   'Execução concluída',
          sem_guia:  'Concluída sem guia capturada',
          glosa:     'ASSIM recusou (glosa)',
          // Chega aqui, e não no catch, de propósito: é o desfecho em que o
          // modal de token ficou aberto e a aba TEM de sobreviver. Um throw
          // passaria por sessao.descartar() e fecharia a janela na cara de quem
          // está digitando o token.
          devolvida: 'Devolvida à recepção (token aberto, aba preservada)',
          // Mesma razão: a janela foi fechada por uma pessoa antes do clique em
          // "enviar". Não é falha do robô e não há nada a descartar — a aba já
          // não existe. Vem por retorno para não passar pelo catch.
          envio_nao_ocorrido: 'Encerrada sem envio (janela fechada antes do enviar)',
        }

        await api.registrarLog(
          tarefa.id,
          DESCRICAO_DESFECHO[resultado] || `Execução encerrada (${resultado})`
        )
        console.log(
          resultado === 'glosa' ? '🚫 Finalizado:' : '✅ Finalizado:',
          tarefa.id, `(${resultado})`
        )

        // A aba fica de propósito, para impressão/conferência — inclusive na
        // glosa, porque é dessa tela que a recepção tira o print da recusa.
        // sessao.podar() cuida de não deixar acumular.

      } catch (erroExecucao) {
        console.error('❌ Erro na tarefa:', erroExecucao.message)
        await api.registrarLog(tarefa.id, erroExecucao.message)

        // Execução que falhou não tem nada para imprimir: fecha a aba em vez de
        // deixar lixo na tela da recepcionista.
        //
        // COM EXCEÇÕES, decididas dentro de `descartar()` (ver abaEmUso): a aba
        // NÃO é fechada se o modal de token do beneficiário está na tela, nem
        // se o robô está parado esperando o clique em "enviar". Nos dois casos
        // existe alguém do outro lado no meio de uma etapa que não se refaz de
        // graça — o token vale ~60s, e o formulário preenchido é o atendimento
        // inteiro. Os caminhos normais nem chegam aqui (voltam como 'devolvida'
        // e 'envio_nao_ocorrido', sem throw); este é o cinto para qualquer
        // outro erro que apareça durante essas etapas.
        await sessao.descartar(aba)

        if (erroExecucao.fatal) throw erroExecucao

        await esperar(1000)
      }

    } catch (erroGeral) {
      if (erroGeral.fatal) {
        console.error('\n⛔ ERRO QUE O ROBÔ NÃO RESOLVE SOZINHO:')
        console.error('   ' + erroGeral.message)
        console.error('   O supervisor NÃO vai relançar. Resolva e inicie manualmente.\n')
        clearInterval(batida)
        await sessao.fecharTudo().catch(() => {})
        return SAIDA_PARAR
      }

      console.error('❌ Erro geral:', erroGeral.message)
      await esperar(2000)
    }
  }
}

// =========================
// EXECUÇÃO
// =========================

/**
 * Ponto de entrada real. Traduz o desfecho em código de saída, que é o contrato
 * com o supervisor do start.bat: 0 = relance, 99 = pare e chame alguém.
 *
 * index.js também chama esta função — antes ele chamava iniciarWorker() e jogava
 * o retorno no lixo, o que fazia o supervisor relançar até em caso de token
 * revogado.
 */
function main() {
  const porta = process.env.LOCAL_API_PORT || 3010

  app.listen(porta, '127.0.0.1', () => {
    console.log(`🌐 API local ativa em http://127.0.0.1:${porta}`)
  })

  return iniciarWorker()
    .then((codigo) => process.exit(codigo ?? SAIDA_RELANCAR))
    .catch((erro) => {
      console.error('\n⛔ Falha ao iniciar o worker:')
      console.error('   ' + erro.message)
      // Erro fatal (token ausente, recusado, revogado) é problema de
      // instalação/provisionamento: relançar em laço só esconderia o aviso.
      // Erro comum (a internet caiu no boot) merece nova tentativa.
      process.exit(erro.fatal ? SAIDA_PARAR : SAIDA_RELANCAR)
    })
}

module.exports = iniciarWorker
module.exports.main = main
module.exports.SAIDA_RELANCAR = SAIDA_RELANCAR
module.exports.SAIDA_PARAR = SAIDA_PARAR

if (require.main === module) {
  main()
}
