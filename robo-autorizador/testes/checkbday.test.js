/**
 * Roda com: npm test   (da pasta robo-autorizador)
 *
 * COBRE: preencherNascimentoCpf() — o modal #checkBday preenchido pelo robô —
 * mais os guardas de aba de assim.js (temTokenAberto, podar, descartar).
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
const rpa = require(path.join(RAIZ, 'rpa.js'))
const { preencherNascimentoCpf } = rpa
const { SessaoAssim } = require(path.join(RAIZ, 'assim.js'))

// CPF e nascimento fictícios, só para o teste.
const CPF_CERTO = '12345678901'
const NASC_CERTO = '2017-04-12'

function paginaAssim({ tipoData = 'date', comToken = false } = {}) {
  return `<!doctype html><html><body>
    <form name="autorizador">
      <input name="associado1" value="000000">
      <input name="associado2" value="0750812">
      <input name="associado3" value="00">
      <input name="autBiofacial" value="">
    </form>

    <div id="loadModal" class="modal" style="display:block"></div>
    <table><tr>
      <td id="InformeOsDados">Informe os Dados</td>
      <td id="EnviarDados" style="display:none">Enviar</td>
    </tr></table>

    <div id="checkBday" class="modal" style="display:block">
      <h3>Confirme os dados abaixo</h3>
      <label>Data de Nascimento:</label>
      <input type="${tipoData}" id="bdayDate" name="nascimento" placeholder="dd/mm/aaaa">
      <label>CPF:</label>
      <input type="text" id="bdayCpf" name="cpf" placeholder="digite apenas numeros">
      <button type="button" onclick="ConfirmBdayDate()">Confirmar</button>
    </div>

    <div id="checkToken" class="modal" style="display:${comToken ? 'block' : 'none'}">
      <h3>Confirme os dados abaixo</h3>
      <label>Beneficiario:</label>
      <input type="text" id="tokenBenef" value="000000075081200000" readonly>
      <label>Token:</label>
      <input type="text" id="tokenValor" placeholder="digite o token aqui...">
      <button type="button">Confirmar</button>
    </div>

    <script>
      const CPF_OK  = '${CPF_CERTO}';
      const NASC_OK = '${NASC_CERTO}';

      // Sem regex literal de propósito: dentro de um template literal do Node,
      // escrever /\\D/ aqui exige 4 barras invertidas e errar isso já custou
      // dois falsos negativos neste teste. RegExp por string é inequívoco.
      var NAO_DIGITO = new RegExp(String.fromCharCode(92) + 'D', 'g');
      function soDigitos(v) { return (v || '').replace(NAO_DIGITO, ''); }

      function limpa_carteira() {
        const f = document.forms.autorizador;
        f.associado1.value = ''; f.associado2.value = ''; f.associado3.value = '';
      }

      // O campo nativo já entrega 'aaaa-mm-dd'; o de texto entrega 'ddmmaaaa'
      // (ou 'dd/mm/aaaa'). Distinguir pelo TIPO, não pelo comprimento: os dois
      // dão 8 dígitos e confundi-los foi bug deste mock, não do robô.
      function normalizarData(v) {
        const campo = document.getElementById('bdayDate');
        if (campo.type === 'date') return campo.value || '';

        const d = soDigitos(v);
        if (d.length === 8) {
          // ddmmaaaa -> aaaa-mm-dd
          return d.slice(4) + '-' + d.slice(2,4) + '-' + d.slice(0,2);
        }
        return '';
      }

      function ConfirmBdayDate() {
        const cpf  = soDigitos(document.getElementById('bdayCpf').value);
        const nasc = normalizarData(document.getElementById('bdayDate').value);

        if (cpf === CPF_OK && nasc === NASC_OK) {
          document.getElementById('checkBday').style.display = 'none';
          document.getElementById('InformeOsDados').style.display = 'none';
          document.getElementById('EnviarDados').style.display = '';
          document.forms.autorizador.autBiofacial.value = 'OK-' + Date.now();
          window.__confirmou = true;
          return;
        }

        // Conferido no fonte real (custom/js/modal_confirm_ben.js): a recusa NAO
        // limpa a carteirinha (aquelas linhas estao comentadas no portal).
        // Limpa so os dois campos, deixa o modal ABERTO e alerta.
        window.__confirmou = false;
        document.getElementById('bdayDate').value = '';
        document.getElementById('bdayCpf').value = '';
        alert('CPF ou Data de Nascimento estao incorretos! Tente novamente!');
      }
    </script>
  </body></html>`
}

const cfg = { modal_bday_ms: 4000 }

function apiFalsa(logs) {
  return {
    registrarLog: async (_id, m) => { logs.push(m) },
    concluirTarefa: async () => {},
  }
}

function ligarAlertas(page, alertas) {
  page.on('dialog', async (d) => { alertas.push(d.message()); await d.dismiss().catch(() => {}) })
}

async function carteirinha(page) {
  return page.evaluate(() => {
    const f = document.forms.autorizador
    return [f.associado1.value, f.associado2.value, f.associado3.value]
  })
}

const casos = []
function checar(nome, ok, detalhe = '') {
  casos.push({ nome, ok })
  console.log(`${ok ? '  PASSOU' : '  FALHOU'}  ${nome}${detalhe ? ' — ' + detalhe : ''}`)
}

;(async () => {
  const browser = await chromium.launch({ headless: true })

  // ---------------------------------------------------------------
  console.log('\n1. input[type=date] com dado correto')
  {
    const page = await browser.newPage()
    const alertas = []; const logs = []
    ligarAlertas(page, alertas)
    await page.setContent(paginaAssim({ tipoData: 'date' }))

    const r = await preencherNascimentoCpf(page, cfg, apiFalsa(logs),
      { id: 't1', cpf: CPF_CERTO, data_nascimento: NASC_CERTO }, alertas)

    checar("veredito 'preenchido'", r === 'preenchido', `veio '${r}'`)
    checar('ConfirmBdayDate aceitou', await page.evaluate(() => window.__confirmou) === true)
    checar('carteirinha intacta', (await carteirinha(page)).every(v => v))
    checar('envio liberado (EnviarDados visível)',
      await page.locator('#EnviarDados').isVisible())
    await page.close()
  }

  // ---------------------------------------------------------------
  console.log('\n2. campo de texto com máscara (type=text) com dado correto')
  {
    const page = await browser.newPage()
    const alertas = []; const logs = []
    ligarAlertas(page, alertas)
    await page.setContent(paginaAssim({ tipoData: 'text' }))

    const r = await preencherNascimentoCpf(page, cfg, apiFalsa(logs),
      { id: 't2', cpf: CPF_CERTO, data_nascimento: NASC_CERTO }, alertas)

    checar("veredito 'preenchido'", r === 'preenchido', `veio '${r}'`)
    checar('digitou ddmmaaaa sem barras',
      /^\d{8}$/.test(await page.locator('#bdayDate').inputValue()),
      `campo="${await page.locator('#bdayDate').inputValue()}"`)
    await page.close()
  }

  // ---------------------------------------------------------------
  console.log('\n3. CPF divergente do cadastro da ASSIM')
  {
    const page = await browser.newPage()
    const alertas = []; const logs = []
    ligarAlertas(page, alertas)
    await page.setContent(paginaAssim({ tipoData: 'date' }))

    const r = await preencherNascimentoCpf(page, cfg, apiFalsa(logs),
      { id: 't3', cpf: '99999999999', data_nascimento: NASC_CERTO }, alertas)

    checar("veredito 'recusado'", r === 'recusado', `veio '${r}'`)
    checar('capturou o alerta da ASSIM', alertas.some(a => /incorret/i.test(a)))
    checar('carteirinha INTACTA (o portal real nao a limpa na recusa)',
      (await carteirinha(page)).every(v => v))
    checar('o modal segue aberto para nova tentativa',
      await page.locator('#checkBday').isVisible())
    checar('registrou o motivo no log', logs.some(l => /recus|limpou/i.test(l)),
      JSON.stringify(logs))
    await page.close()
  }

  // ---------------------------------------------------------------
  console.log('\n4. sem CPF no cadastro (os 20 pacientes) — não digita nada')
  {
    const page = await browser.newPage()
    const alertas = []; const logs = []
    ligarAlertas(page, alertas)
    await page.setContent(paginaAssim({ tipoData: 'date' }))

    const r = await preencherNascimentoCpf(page, cfg, apiFalsa(logs),
      { id: 't4', cpf: null, data_nascimento: NASC_CERTO }, alertas)

    checar("veredito 'sem_dados'", r === 'sem_dados', `veio '${r}'`)
    checar('não digitou no CPF', (await page.locator('#bdayCpf').inputValue()) === '')
    checar('não clicou em Confirmar',
      await page.evaluate(() => window.__confirmou) === undefined)
    checar('carteirinha intacta', (await carteirinha(page)).every(v => v))
    checar('log diz o que faltou', logs.some(l => /CPF/i.test(l)), JSON.stringify(logs))
    await page.close()
  }

  // ---------------------------------------------------------------
  console.log('\n5. CPF curto (dado corrompido) — não inventa zeros')
  {
    const page = await browser.newPage()
    const alertas = []; const logs = []
    ligarAlertas(page, alertas)
    await page.setContent(paginaAssim({ tipoData: 'date' }))

    const r = await preencherNascimentoCpf(page, cfg, apiFalsa(logs),
      { id: 't5', cpf: '123', data_nascimento: NASC_CERTO }, alertas)

    checar("veredito 'sem_dados'", r === 'sem_dados', `veio '${r}'`)
    checar('não digitou nada', (await page.locator('#bdayCpf').inputValue()) === '')
    await page.close()
  }

  // ---------------------------------------------------------------
  console.log('\n6. o modal nem abre (caminho biofacial/QR) — sai de graça')
  {
    const page = await browser.newPage()
    const alertas = []; const logs = []
    ligarAlertas(page, alertas)
    await page.setContent(
      paginaAssim({ tipoData: 'date' }).replace(
        '<div id="checkBday" class="modal" style="display:block">',
        '<div id="checkBday" class="modal" style="display:none">'))

    const t0 = Date.now()
    const r = await preencherNascimentoCpf(page, cfg, apiFalsa(logs),
      { id: 't6', cpf: CPF_CERTO, data_nascimento: NASC_CERTO }, alertas)
    const ms = Date.now() - t0

    checar("veredito 'sem_modal'", r === 'sem_modal', `veio '${r}'`)
    checar('respeitou o teto curto (~4s)', ms < 6000, `${ms}ms`)
    checar('nenhum log inútil', logs.length === 0, JSON.stringify(logs))
    await page.close()
  }

  // ---------------------------------------------------------------
  console.log('\n7. temTokenAberto(): o guarda que protege a aba')
  {
    const sessao = new SessaoAssim(browser)

    const comToken = await browser.newPage()
    await comToken.setContent(paginaAssim({ comToken: true }))
    checar('detecta token na tela',
      await sessao.temTokenAberto({ page: comToken }) === true)

    const semToken = await browser.newPage()
    await semToken.setContent(paginaAssim({ comToken: false }))
    checar('não vê token quando está escondido',
      await sessao.temTokenAberto({ page: semToken }) === false)

    // O caso que motivou exigir o CAMPO e não só a caixa.
    const inerte = await browser.newPage()
    await inerte.setContent(paginaAssim({ comToken: true }))
    await inerte.evaluate(() => {
      document.getElementById('tokenValor').style.display = 'none'
      document.getElementById('tokenBenef').style.display = 'none'
    })
    checar('modal inerte (sem campo visível) NÃO bloqueia a poda',
      await sessao.temTokenAberto({ page: inerte }) === false)

    await sessao.temTokenAberto({ page: null })
    checar('página nula responde false sem explodir', true)

    await comToken.close()
    checar('página fechada responde false',
      await sessao.temTokenAberto({ page: comToken }) === false)

    await semToken.close(); await inerte.close()
  }

  // ---------------------------------------------------------------
  console.log('\n8. podar(): não fecha a aba com token, fecha as outras')
  {
    const sessao = new SessaoAssim(browser)
    const antigo = Date.now() - 60 * 60000 // 1h: vencida para um TTL de 30min

    const ctxToken = await browser.newContext()
    const pgToken = await ctxToken.newPage()
    await pgToken.setContent(paginaAssim({ comToken: true }))

    const ctxLivre = await browser.newContext()
    const pgLivre = await ctxLivre.newPage()
    await pgLivre.setContent(paginaAssim({ comToken: false }))

    sessao.abas = [
      { ctx: ctxToken, page: pgToken, criadoEm: antigo, filaId: 'x', alertas: [] },
      { ctx: ctxLivre, page: pgLivre, criadoEm: antigo, filaId: 'y', alertas: [] },
    ]

    await sessao.podar({ max_abas_abertas: 3, aba_ttl_minutos: 30 })

    checar('a aba do token sobreviveu',
      sessao.abas.length === 1 && sessao.abas[0].page === pgToken,
      `restaram ${sessao.abas.length}`)
    checar('a aba sem token foi fechada', pgLivre.isClosed())

    // Passado o prazo de graça (4x o TTL = 2h), nem o token segura.
    sessao.abas[0].criadoEm = Date.now() - 5 * 60 * 60000
    await sessao.podar({ max_abas_abertas: 3, aba_ttl_minutos: 30 })
    checar('depois da graça, a aba do token também é recolhida',
      sessao.abas.length === 0, `restaram ${sessao.abas.length}`)
  }

  // ---------------------------------------------------------------
  console.log('\n9. descartar(): recusa fechar aba com token, a menos que forçado')
  {
    const sessao = new SessaoAssim(browser)

    const ctx = await browser.newContext()
    const pg = await ctx.newPage()
    await pg.setContent(paginaAssim({ comToken: true }))
    const reg = { ctx, page: pg, criadoEm: Date.now(), filaId: 'z', alertas: [] }
    sessao.abas = [reg]

    await sessao.descartar(reg)
    checar('não fechou a aba do token', !pg.isClosed())
    checar('soltou o vínculo com a tarefa', reg.filaId === null)
    checar('a aba continua no pool (a poda cuida depois)', sessao.abas.length === 1)

    await sessao.descartar(reg, { forcar: true })
    checar('com forcar:true, fecha', pg.isClosed())
    checar('saiu do pool', sessao.abas.length === 0)
  }

  // ---------------------------------------------------------------
  //
  // 1.1.8. A espera pelo clique em "enviar" deixou de ter prazo, e uma espera
  // sem prazo passa do TTL de 30 min por definição. Sem este guarda a poda
  // fecharia a janela com o formulário preenchido dentro — o mesmo defeito que
  // a 1.1.8 veio consertar, só que meia hora depois.
  console.log('\n10. aguardandoOperador: a aba do envio não é podada nem descartada')
  {
    const sessao = new SessaoAssim(browser)
    const antigo = Date.now() - 60 * 60000 // 1h: vencida para um TTL de 30min

    const ctx = await browser.newContext()
    const pg = await ctx.newPage()
    // SEM token na tela: quem protege aqui é só a flag.
    await pg.setContent(paginaAssim({ comToken: false }))
    const reg = {
      ctx, page: pg, criadoEm: antigo, filaId: 'w', alertas: [],
      aguardandoOperador: true,
    }

    checar('abaEmUso() reconhece a espera pelo envio',
      await sessao.abaEmUso(reg) === true)

    sessao.abas = [reg]
    await sessao.podar({ max_abas_abertas: 3, aba_ttl_minutos: 30 })
    checar('a poda não fechou a aba vencida que aguarda envio',
      !pg.isClosed() && sessao.abas.length === 1, `restaram ${sessao.abas.length}`)

    // Diferente do token: aqui NÃO existe prazo de graça. O formulário
    // preenchido continua válido depois de horas.
    reg.criadoEm = Date.now() - 10 * 60 * 60000
    await sessao.podar({ max_abas_abertas: 3, aba_ttl_minutos: 30 })
    checar('nem depois de 10h a poda a recolhe (não há prazo de graça)',
      !pg.isClosed() && sessao.abas.length === 1, `restaram ${sessao.abas.length}`)

    await sessao.descartar(reg)
    checar('descartar() também recusa fechá-la', !pg.isClosed())
    checar('soltou o vínculo com a tarefa', reg.filaId === null)

    // Resolvido o envio, a aba volta a ser comum.
    reg.aguardandoOperador = false
    checar('sem a flag, abaEmUso() volta a false',
      await sessao.abaEmUso(reg) === false)

    await sessao.podar({ max_abas_abertas: 3, aba_ttl_minutos: 30 })
    checar('e a poda a recolhe normalmente', pg.isClosed())
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
