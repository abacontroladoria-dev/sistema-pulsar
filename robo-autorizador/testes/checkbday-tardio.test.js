/**
 * Roda com: node --test testes/checkbday-tardio.test.js
 *
 * COBRE a regressão de 17/09/2026: o #checkBday que aparece TARDE.
 *
 * O caso real. Sem dispositivo Intelbras a ASSIM abre primeiro o aviso com
 * botão (.jconfirm-box: "Solicite identificacao do beneficiario por QRCode"), e
 * o #checkBday só nasce quando alguém clica CONFIRMAR nele. Como
 * `SEL_IDENTIFICACAO` casa com AS DUAS telas, o laço da etapa 2 já saía no
 * aviso; a chamada única a `preencherNascimentoCpf` logo depois esperava 10s por
 * um modal inexistente, saía por 'sem_modal' e ninguém mais olhava. Resultado em
 * produção: duas tarefas com biofacial_assim='8-DISPOSITIVO INDISPONIVEL'
 * concluídas por Token, com o CPF e o nascimento disponíveis o tempo todo.
 *
 * Por isso este teste exercita `aguardarConfirmacaoBeneficiario` INTEIRA, e não
 * `preencherNascimentoCpf` direto (é o que checkbday.test.js já faz): o defeito
 * não estava no preenchimento, estava em QUANDO ele era tentado. Chamar a função
 * interna passaria com o bug de pé.
 */
const path = require('path')

const RAIZ = path.join(__dirname, '..')
const { chromium } = require('playwright')
const { aguardarConfirmacaoBeneficiario } = require(path.join(RAIZ, 'rpa.js'))

const CPF_CERTO = '12345678901'
const NASC_CERTO = '2017-04-12'

/**
 * @param atrasoDoModalMs quanto tempo o aviso do QR fica sozinho na tela antes
 *        de o #checkBday nascer. Maior que `modal_bday_ms` de propósito: é o que
 *        reproduz o bug.
 */
function pagina({ atrasoDoModalMs }) {
  return `<!doctype html><html><body>
    <form name="autorizador">
      <input name="associado1" value="000000">
      <input name="associado2" value="0750812">
      <input name="associado3" value="00">
      <input name="autBiofacial" value="">
    </form>
    <div id="indemp">FULANO DE TAL</div>
    <div id="loadModal" class="modal" style="display:block"></div>
    <div id="myModal" class="modal" style="display:none"></div>
    <div id="checkToken" class="modal" style="display:none"></div>

    <!-- A PRIMEIRA tela: o aviso com botão. Já satisfaz SEL_IDENTIFICACAO. -->
    <div class="jconfirm-box">
      Solicite identificacao do beneficiario por QRCode no dispositivo
      <button type="button">CONFIRMAR</button>
    </div>

    <div id="checkBday" class="modal" style="display:none">
      <input type="date" id="bdayDate">
      <input type="text" id="bdayCpf" placeholder="digite apenas numeros">
      <button type="button" onclick="ConfirmBdayDate()">Confirmar</button>
    </div>

    <div id="InformeOsDados">informe os dados</div>
    <div id="EnviarDados" style="display:none">enviar</div>

    <script>
      // A recepção clica CONFIRMAR no aviso: o aviso some e o modal aparece.
      setTimeout(function () {
        document.querySelector('.jconfirm-box').style.display = 'none';
        document.getElementById('checkBday').style.display = 'block';
        window.__modalNasceuEm = Date.now();
      }, ${atrasoDoModalMs});

      function ConfirmBdayDate() {
        var cpf  = document.getElementById('bdayCpf').value.replace(/\\D/g, '');
        var nasc = document.getElementById('bdayDate').value;

        if (cpf === '${CPF_CERTO}' && nasc === '${NASC_CERTO}') {
          document.getElementById('checkBday').style.display = 'none';
          document.getElementById('InformeOsDados').style.display = 'none';
          document.getElementById('EnviarDados').style.display = '';
          document.forms.autorizador.autBiofacial.value = 'OK-' + Date.now();
          window.__confirmou = true;
        }
      }
    </script>
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
  // `modal_bday_ms` de 800ms contra um modal que nasce aos 2500ms. A proporção é
  // a de produção (10s de teto contra um clique humano que demora mais), só que
  // em escala de teste.
  console.log('\n1. o #checkBday nasce DEPOIS do aviso do QR — o robô ainda preenche')
  {
    const page = await browser.newPage()
    await page.setContent(pagina({ atrasoDoModalMs: 2500 }))

    const logs = []
    const api = { registrarLog: async (_i, m) => { logs.push(m) }, concluirTarefa: async () => {} }

    const cfg = {
      beneficiario_consulta_ms: 5000,
      identificacao_aparecer_ms: 5000,
      token_ms: 30000,
      modal_bday_ms: 800,
    }

    const tarefa = { id: 'tardio-1', cpf: CPF_CERTO, data_nascimento: NASC_CERTO }

    let lancou = null
    const veredito = await aguardarConfirmacaoBeneficiario(page, cfg, api, tarefa, [])
      .catch((e) => { lancou = e; return null })

    checar('não lançou', lancou === null, lancou ? lancou.message : '')
    checar('o robô preencheu e a ASSIM aceitou',
      await page.evaluate(() => window.__confirmou === true))
    checar('o código de identificação foi gravado',
      await page.evaluate(() => !!document.forms.autorizador.autBiofacial.value))
    checar('envio liberado (EnviarDados visível)',
      await page.locator('#EnviarDados').isVisible())
    checar("encerrou por 'manual'", veredito === 'manual', `veio '${veredito}'`)

    await page.close()
  }

  // ---------------------------------------------------------------
  // A guarda de disparo único tem que valer para o caso comum também: quando o
  // #checkBday nunca aparece, nada deve ser digitado e nada deve travar.
  console.log('\n2. o #checkBday nunca aparece — nada é preenchido, nada trava')
  {
    const page = await browser.newPage()
    await page.setContent(pagina({ atrasoDoModalMs: 999999 }))

    const logs = []
    const api = { registrarLog: async (_i, m) => { logs.push(m) }, concluirTarefa: async () => {} }

    const cfg = {
      beneficiario_consulta_ms: 5000,
      identificacao_aparecer_ms: 5000,
      token_ms: 30000,
      modal_bday_ms: 500,
    }

    const tarefa = { id: 'tardio-2', cpf: CPF_CERTO, data_nascimento: NASC_CERTO }

    // A recepção resolve por fora (biofacial no dispositivo) enquanto o robô espera.
    setTimeout(() => {
      page.evaluate(() => {
        document.querySelector('.jconfirm-box').style.display = 'none'
        document.forms.autorizador.autBiofacial.value = 'BIO-OK'
      }).catch(() => {})
    }, 2000)

    let lancou = null
    const veredito = await aguardarConfirmacaoBeneficiario(page, cfg, api, tarefa, [])
      .catch((e) => { lancou = e; return null })

    checar('não lançou', lancou === null, lancou ? lancou.message : '')
    checar('não digitou nada', await page.evaluate(() => window.__confirmou === undefined))
    checar("encerrou por 'manual'", veredito === 'manual', `veio '${veredito}'`)

    await page.close()
  }

  await browser.close()

  const ok = casos.filter(c => c.ok).length
  console.log('\n' + '='.repeat(60))
  console.log(`${ok}/${casos.length} verificações passaram`)
  if (ok !== casos.length) process.exit(1)
})()
