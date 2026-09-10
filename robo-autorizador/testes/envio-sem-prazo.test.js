/**
 * Roda com: npm test   (da pasta robo-autorizador)
 *
 * COBRE a regra central da 1.1.8: a espera pelo clique em "enviar" NÃO TEM
 * PRAZO, e a janela nunca fecha sozinha.
 *
 * O QUE ACONTECIA ATÉ A 1.1.7: `aguardarResultadoEnvio` recebia
 * `envio_timeout_ms` (120s). Estourado o prazo devolvia 'timeout', o chamador
 * LANÇAVA, o worker chamava sessao.descartar() e o contexto do Chrome fechava —
 * a janela sumia na cara do operador com o formulário preenchido dentro, sem
 * nenhuma contagem visível avisando.
 *
 * Agora a espera acaba de dois jeitos, e só: a ASSIM responde, ou uma PESSOA
 * fecha a aba. Os testes abaixo checam exatamente esses dois desfechos, mais a
 * garantia de que um clique MUITO tardio continua sendo reconhecido.
 *
 * NÃO fala com o portal da ASSIM: monta uma página que imita o recibo.
 *
 * Esta pasta fica FORA de ARQUIVOS_DO_ROBO (publicar.js): teste não vai para o
 * PC da recepção.
 */
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const { chromium } = require('playwright')
const { aguardarResultadoEnvio } = require(path.join(RAIZ, 'rpa.js'))

// O formulário preenchido, à espera do clique. Sem nenhuma das MARCAS_DESFECHO
// na tela: é o estado em que o robô fica parado.
const FORMULARIO = `<!doctype html><html><body>
  <form name="autorizador">
    <input name="associado1" value="000000">
    <input name="ttuss1" value="50000470">
  </form>
  <div id="EnviarDados"><button type="button">Enviar</button></div>
  <div id="recibo"></div>
</body></html>`

// A ASSIM imprime o desfecho SEM acento e sem charset declarado — por isso o
// rpa.js casa por ASCII puro. O teste imita o mesmo formato.
const recibo = (marca) =>
  `document.getElementById('recibo').textContent = '${marca}'`

const casos = []
const checar = (nome, ok, det = '') => {
  casos.push({ nome, ok })
  console.log(`  ${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${det ? ' — ' + det : ''}`)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })

  // ---------------------------------------------------------------
  console.log('\n1. clique MUITO tardio: a espera não expira e o sucesso é reconhecido')
  {
    const page = await browser.newPage()
    await page.setContent(FORMULARIO)

    // 6s é pouco no relógio, mas o ponto é o desenho: não existe mais NENHUM
    // prazo no caminho. Na 1.1.7 quem mandava aqui era `envio_timeout_ms`, e a
    // função nem recebe mais esse parâmetro — não há valor a passar.
    setTimeout(() => {
      page.evaluate(recibo('BENEFICIO PROCESSADO')).catch(() => {})
    }, 6000)

    const t0 = Date.now()
    let lancou = null
    let saida = null
    try {
      saida = await aguardarResultadoEnvio(page, [])
    } catch (e) { lancou = e.message }
    const ms = Date.now() - t0

    checar('não lançou', lancou === null, lancou || '')
    checar("devolveu 'sucesso'", saida?.resultado === 'sucesso', `veio '${saida?.resultado}'`)
    checar('esperou o clique tardio', ms > 5500, `${ms}ms`)
    checar('a aba continua viva', !page.isClosed())

    await page.close()
  }

  // ---------------------------------------------------------------
  console.log('\n2. a rejeição da ASSIM continua sendo desfecho imediato')
  {
    const page = await browser.newPage()
    await page.setContent(FORMULARIO)

    setTimeout(() => {
      page.evaluate(recibo('BENEFICIO REJEITADO')).catch(() => {})
    }, 1500)

    const t0 = Date.now()
    const saida = await aguardarResultadoEnvio(page, [])
    const ms = Date.now() - t0

    checar("devolveu 'rejeitado'", saida.resultado === 'rejeitado', `veio '${saida.resultado}'`)
    checar('retornou na hora, sem esperar mais nada', ms < 6000, `${ms}ms`)
    checar('a aba continua viva (é dela que sai o print da recusa)', !page.isClosed())

    await page.close()
  }

  // ---------------------------------------------------------------
  console.log('\n3. janela fechada por uma pessoa: devolve aba_fechada SEM lançar')
  {
    const page = await browser.newPage()
    await page.setContent(FORMULARIO)

    // O único jeito humano de sair da espera agora.
    setTimeout(() => { page.close().catch(() => {}) }, 3000)

    const t0 = Date.now()
    let lancou = null
    let saida = null
    try {
      saida = await aguardarResultadoEnvio(page, [])
    } catch (e) { lancou = e.message }
    const ms = Date.now() - t0

    // Um throw aqui subiria ao worker e chamaria sessao.descartar(): é a cadeia
    // exata que a 1.1.8 desmontou. O retorno tem de ser limpo.
    checar('não lançou (throw levaria a descartar a aba)', lancou === null, lancou || '')
    checar("devolveu 'aba_fechada'", saida?.resultado === 'aba_fechada', `veio '${saida?.resultado}'`)
    checar('percebeu o fechamento rápido, sem girar à toa', ms < 12000, `${ms}ms`)
  }

  // ---------------------------------------------------------------
  console.log('\n4. alerta de recusa não encerra a espera: dá para corrigir e reenviar')
  {
    const page = await browser.newPage()
    await page.setContent(FORMULARIO)

    // O handler de dialog da aba alimenta este array. A ASSIM recusou o envio
    // sem sair da tela — e a recepcionista ainda pode corrigir.
    const alertas = ['Beneficiario nao confirmado. Tentar novamente']

    setTimeout(() => {
      page.evaluate(recibo('BENEFICIO PROCESSADO')).catch(() => {})
    }, 4000)

    const saida = await aguardarResultadoEnvio(page, alertas)

    checar('esperou o reenvio em vez de desistir na recusa',
      saida.resultado === 'sucesso', `veio '${saida.resultado}'`)
    checar('a aba continua viva', !page.isClosed())

    await page.close()
  }

  await browser.close()

  const falhas = casos.filter(c => !c.ok)
  console.log(`\n${'='.repeat(60)}`)
  console.log(`${casos.length - falhas.length}/${casos.length} verificações passaram`)
  if (falhas.length) {
    console.log('\nFALHARAM:')
    for (const f of falhas) console.log('  - ' + f.nome)
    process.exit(1)
  }
})().catch(e => { console.error(e); process.exit(1) })
