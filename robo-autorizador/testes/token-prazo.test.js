/**
 * Roda com: npm test   (da pasta robo-autorizador)
 *
 * COBRE: a suspensão do prazo enquanto o #checkToken está na tela, e a saída
 * por 'token_pendente' (retorno, NUNCA throw — um throw chegaria ao worker e
 * fecharia a aba na cara de quem está digitando o token).
 *
 * NÃO fala com o portal da ASSIM. Monta uma página que imita o formulário —
 * inclusive o efeito colateral que governa todo o desenho: errar o CPF/nascimento
 * dispara alert() E roda limpa_carteira(), apagando a carteirinha.
 *
 * Esta pasta fica FORA de ARQUIVOS_DO_ROBO (publicar.js): teste não vai para o
 * PC da recepção.
 */
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const { chromium } = require('playwright')
const { aguardarConfirmacaoBeneficiario } = require(path.join(RAIZ, 'rpa.js'))

function pagina({ comToken }) {
  return `<!doctype html><html><body>
    <form name="autorizador">
      <input name="associado1" value="000000">
      <input name="associado2" value="0750812">
      <input name="associado3" value="00">
      <input name="autBiofacial" value="">
    </form>
    <div id="indemp">FULANO DE TAL</div>
    <div id="loadModal" class="modal" style="display:block"></div>
    <div id="checkBday" class="modal" style="display:none"></div>
    <div id="myModal" class="modal" style="display:none"></div>
    <div id="checkToken" class="modal" style="display:${comToken ? 'block' : 'none'}">
      <input type="text" id="tokenValor" placeholder="digite o token aqui...">
      <button type="button">Confirmar</button>
    </div>
  </body></html>`
}

const casos = []
const checar = (nome, ok, det = '') => {
  casos.push({ nome, ok })
  console.log(`  ${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${det ? ' — ' + det : ''}`)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })

  // ---------------------------------------------------------------
  console.log('\n1. token na tela: prazo suspenso, e ao fim devolve sem lançar')
  {
    const page = await browser.newPage()
    await page.setContent(pagina({ comToken: true }))

    const logs = []
    const api = { registrarLog: async (_i, m) => { logs.push(m) }, concluirTarefa: async () => {} }

    // tetoHumano curtíssimo (1,5s) e tetoToken de 4s: sem a suspensão, a função
    // estouraria o tetoHumano e LANÇARIA em ~1,5s.
    const cfg = {
      beneficiario_consulta_ms: 3000,
      identificacao_aparecer_ms: 3000,
      confirmacao_beneficiario_ms: 1500,
      token_ms: 4000,
      modal_bday_ms: 500,
    }

    const t0 = Date.now()
    let lancou = null
    let veredito = null
    try {
      veredito = await aguardarConfirmacaoBeneficiario(
        page, cfg, api, { id: 'tk1', cpf: null, data_nascimento: null }, [])
    } catch (e) { lancou = e.message }
    const ms = Date.now() - t0

    checar('não lançou', lancou === null, lancou || '')
    checar("devolveu 'token_pendente'", veredito === 'token_pendente', `veio '${veredito}'`)
    checar('esperou além do tetoHumano (prazo suspenso)', ms > 3000, `${ms}ms`)
    checar('respeitou o tetoToken', ms < 9000, `${ms}ms`)
    checar('a página continua viva', !page.isClosed())
    checar('o token continua na tela',
      await page.locator('#checkToken').isVisible())
    checar('avisou no log da fila', logs.some(l => /token/i.test(l)), JSON.stringify(logs))

    await page.close()
  }

  // ---------------------------------------------------------------
  console.log('\n2. token resolvido pelo usuário no meio: a função conclui normal')
  {
    const page = await browser.newPage()
    await page.setContent(pagina({ comToken: true }))

    const api = { registrarLog: async () => {}, concluirTarefa: async () => {} }
    const cfg = {
      beneficiario_consulta_ms: 3000,
      identificacao_aparecer_ms: 3000,
      confirmacao_beneficiario_ms: 30000,
      token_ms: 30000,
      modal_bday_ms: 500,
    }

    // O "usuário" conclui o token depois de 2s, como faria na recepção.
    setTimeout(() => {
      page.evaluate(() => {
        document.getElementById('checkToken').style.display = 'none'
        document.getElementById('loadModal').style.display = 'none'
        document.forms.autorizador.autBiofacial.value = 'OK-123'
      }).catch(() => {})
    }, 2000)

    const t0 = Date.now()
    let lancou = null
    let veredito = null
    try {
      veredito = await aguardarConfirmacaoBeneficiario(
        page, cfg, api, { id: 'tk2', cpf: null, data_nascimento: null }, [])
    } catch (e) { lancou = e.message }
    const ms = Date.now() - t0

    checar('não lançou', lancou === null, lancou || '')
    checar("concluiu como identificação normal", veredito === 'manual' || veredito === 'automatica',
      `veio '${veredito}'`)
    checar('saiu logo depois do token ser resolvido', ms < 12000, `${ms}ms`)
    checar('a aba continua viva', !page.isClosed())

    await page.close()
  }

  // ---------------------------------------------------------------
  //
  // ATÉ A 1.1.7 ESTE CASO EXIGIA O CONTRÁRIO: que a função LANÇASSE ao estourar
  // `confirmacao_beneficiario_ms`. Era justamente esse throw que subia ao worker,
  // passava por sessao.descartar() e FECHAVA A JANELA na cara de quem estava
  // fazendo a leitura facial/QR. A 1.1.8 tirou o prazo; a asserção virou.
  console.log('\n3. QR aberto e não resolvido: 1.1.8 espera SEM PRAZO e não lança')
  {
    const page = await browser.newPage()
    await page.setContent(pagina({ comToken: false }).replace(
      '<div id="myModal" class="modal" style="display:none"></div>',
      // Com conteudo: div vazia nao tem caixa e o :visible do Playwright a
      // ignora (de proposito — e o que impede o #loadModal vazio de parecer
      // aberto o tempo todo).
      '<div id="myModal" class="modal" style="display:block"><p>Leia o QR Code</p></div>'))

    const api = { registrarLog: async () => {}, concluirTarefa: async () => {} }
    const cfg = {
      // Prazo curtíssimo DE PROPÓSITO: na 1.1.7 a função lançaria em ~1,5s.
      // Agora o valor é ignorado e ela continua esperando.
      beneficiario_consulta_ms: 3000,
      identificacao_aparecer_ms: 3000,
      confirmacao_beneficiario_ms: 1500,
      token_ms: 60000,
      modal_bday_ms: 500,
    }

    // A recepção conclui a leitura MUITO depois do prazo antigo.
    setTimeout(() => {
      page.evaluate(() => {
        document.getElementById('myModal').style.display = 'none'
        document.getElementById('loadModal').style.display = 'none'
        document.forms.autorizador.autBiofacial.value = 'FACIAL-999'
      }).catch(() => {})
    }, 5000)

    const t0 = Date.now()
    let lancou = null
    let veredito = null
    try {
      veredito = await aguardarConfirmacaoBeneficiario(
        page, cfg, api, { id: 'tk3', cpf: null, data_nascimento: null }, [])
    } catch (e) { lancou = e.message }
    const ms = Date.now() - t0

    checar('não lançou (na 1.1.7 lançaria em ~1,5s)', lancou === null, lancou || '')
    checar('esperou muito além do prazo antigo', ms > 4500, `${ms}ms`)
    checar('concluiu quando a recepção resolveu',
      veredito === 'manual' || veredito === 'automatica', `veio '${veredito}'`)
    checar('a aba continua viva', !page.isClosed())

    await page.close()
  }

  // ---------------------------------------------------------------
  console.log('\n4. identificação: a aba fechada por uma pessoa encerra a espera')
  {
    const page = await browser.newPage()
    await page.setContent(pagina({ comToken: false }).replace(
      '<div id="myModal" class="modal" style="display:none"></div>',
      '<div id="myModal" class="modal" style="display:block"><p>Leia o QR Code</p></div>'))

    const api = { registrarLog: async () => {}, concluirTarefa: async () => {} }
    const cfg = {
      beneficiario_consulta_ms: 3000,
      identificacao_aparecer_ms: 3000,
      confirmacao_beneficiario_ms: 1500,
      token_ms: 60000,
      modal_bday_ms: 500,
    }

    setTimeout(() => { page.close().catch(() => {}) }, 3000)

    const t0 = Date.now()
    let lancou = null
    try {
      await aguardarConfirmacaoBeneficiario(
        page, cfg, api, { id: 'tk4', cpf: null, data_nascimento: null }, [])
    } catch (e) { lancou = e.message }
    const ms = Date.now() - t0

    // Sem prazo, fechar a janela é a ÚNICA saída humana: sem esta saída o laço
    // giraria para sempre numa página que já não existe.
    checar('a espera terminou ao fechar a aba', ms < 12000, `${ms}ms`)
    checar('acusou a janela fechada', /fechada/i.test(lancou || ''), lancou || '(não lançou)')

    if (!page.isClosed()) await page.close()
  }

  await browser.close()

  const falhas = casos.filter(c => !c.ok)
  console.log(`\n${'='.repeat(60)}`)
  console.log(`${casos.length - falhas.length}/${casos.length} verificações passaram`)
  if (falhas.length) {
    console.log('\nFALHARAM:')
    falhas.forEach(f => console.log('  - ' + f.nome))
    process.exit(1)
  }
})().catch(e => { console.error('\nERRO NO TESTE:', e); process.exit(1) })
