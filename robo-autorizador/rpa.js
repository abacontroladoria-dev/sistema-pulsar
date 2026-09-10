/**
 * =========================
 * RPA - AUTORIZAÇÃO ASSIM
 * =========================
 *
 * Mudou em relação à versão anterior:
 *
 * - Não cria mais contexto de navegador nem cliente de banco. Recebe uma página
 *   já autenticada (assim.js) e a API do robô (api.js). Deixou de existir
 *   qualquer credencial de banco aqui.
 * - A configuração do formulário vem do servidor (robo_config), não do .env.
 *   Quando a ASSIM mexer numa opção, é um UPDATE — não um pendrive.
 * - O modal de forma de validação virou obrigatório, indispensável e com prazo.
 *   Ver pedirFormaValidacao().
 * - A REJEIÇÃO da ASSIM deixou de ser tratada como erro. O recibo de recusa traz
 *   guia, data/hora e o motivo ("1013-CADASTRO DO BENEFICIARIO COM PROBLEMAS"):
 *   tudo isso é lido e gravado, e a tarefa termina em 'glosa'.
 * - O modal de NASCIMENTO + CPF (#checkBday) passou a ser preenchido pelo robô,
 *   com o dado que vem na tarefa. Ver preencherNascimentoCpf(). Antes era da
 *   recepção inteira; o robô esperava e saía da frente.
 * - O modal de TOKEN (#checkToken) é do USUÁRIO e o robô nunca o fecha — nem
 *   direta nem indiretamente, pelo erro que faria o worker descartar a aba.
 *   Ver aguardarConfirmacaoBeneficiario() e SessaoAssim.temTokenAberto().
 *
 * O que NÃO mudou, de propósito: o robô preenche e PARA. Quem clica em "enviar"
 * é a recepcionista. A decisão de autorizar continua humana.
 *
 * -------------------------------------------------------------------------
 * 1.1.8 — A JANELA NUNCA MAIS FECHA SOZINHA
 * -------------------------------------------------------------------------
 *
 * As duas esperas humanas tinham prazo, e o estouro fechava a janela na cara de
 * quem estava atendendo — sem aviso e sem contagem visível:
 *
 * - o envio (`envio_timeout_ms`, 120s) devolvia 'timeout', o chamador LANÇAVA,
 *   o worker chamava sessao.descartar() e o contexto do Chrome ia embora com o
 *   formulário preenchido dentro;
 * - a identificação (`confirmacao_beneficiario_ms`, 15 min) lançava do mesmo
 *   jeito, com a leitura facial/QR em andamento.
 *
 * Agora as duas esperam SEM PRAZO. Elas acabam de dois jeitos, e só: a ASSIM
 * responde, ou uma PESSOA fecha a aba. Os prazos do servidor são ignorados de
 * propósito — máquina com config velha em cache não pode ressuscitar o
 * fechamento automático.
 *
 * O preço, aceito: a máquina atende uma tarefa por vez, então tela abandonada
 * prende a fila daquela recepção. Fechar a janela é o gesto que libera o robô.
 *
 * Sobrevive um teto só, o do token (`token_ms`), porque a saída dele é SEGURA:
 * devolve a tarefa por retorno, sem lançar e sem fechar a aba.
 *
 * Ver também `aguardandoOperador` em assim.js: sem aquele guarda a poda fecharia
 * a aba ao passar do TTL de 30 min, refazendo este mesmo defeito meia hora
 * depois.
 */

const { delay, humanType } = require('./humano')

// =========================
// Elementos do portal da ASSIM
// =========================
//
// Levantados na própria página em 2026-08-13 (lendo o código das funções, não
// por tentativa e erro):
//
// - `callLoader()` cria um <img> do Load_Assim dentro de `#loadModal` e põe o
//   div em display:block; `closeLoader()` o esconde.
// - `#checkBday` (class="modal") é o modal de confirmação do beneficiário, que
//   pede DATA DE NASCIMENTO + CPF. Quem o abre é `abrirModal()`.
// - `trocaElement(mostrar, esconder)` alterna a célula `#InformeOsDados` com a
//   `#EnviarDados`. Enquanto a ASSIM não considera o beneficiário confirmado,
//   quem está visível é `#InformeOsDados` — e o envio é recusado no servidor.
//   Este é o sinal mais fiel de "pode enviar" que a página oferece.
const SEL_LOADER = '#loadModal'
const SEL_MODAL_BENEFICIARIO = '#checkBday'
const SEL_ALERTA_JQUERY = '.jconfirm-box'
const SEL_ENVIO_BLOQUEADO = '#InformeOsDados'

// O modal do token é do USUÁRIO, e é o único elemento desta página que o robô
// trata como intocável. Ele mostra um token que a ASSIM mandou para o celular do
// responsável, com contagem de ~60s. Fechar a aba enquanto ele está na tela
// queima o token: a operadora só reenvia depois de espera, e quem paga é a
// recepção com o beneficiário na frente. Por isso nenhum caminho automático de
// fechamento passa por cima dele — ver o teto próprio na etapa 3 abaixo e
// SessaoAssim.temTokenAberto() em assim.js.
const SEL_MODAL_TOKEN = '#checkToken'

// A tela de identificação do beneficiário, em qualquer das formas que a ASSIM
// usa. Sempre por `:visible` do Playwright, que exige caixa de verdade — e
// NUNCA por `getComputedStyle().display`, porque `#loadModal` nasce com
// display:block e vazio: pelo display ele parece aberto o tempo todo.
//
// .jconfirm-box = os avisos com botão da ASSIM. É esta a tela que aparece na
//                 recepção: "Solicite identificacao do beneficiario por QRCode
//                 no dispositivo", com CONFIRMAR / CANCELAR IDENTIFICACAO.
// #myModal      = leitor de QR Code por câmera (botão #myBtn)
// #checkToken   = token enviado ao beneficiário
// #checkBday    = nascimento + CPF (usado quando não há dispositivo Intelbras)
const SEL_IDENTIFICACAO = [
  '.jconfirm-box:visible',
  '#myModal:visible',
  '#checkToken:visible',
  '#checkBday:visible',
].join(', ')

// Identificação + o loader: "a ASSIM está no meio de alguma coisa".
const SEL_ASSIM_OCUPADA = '#loadModal:visible, ' + SEL_IDENTIFICACAO

// Onde a ASSIM escreve o nome do beneficiário quando o encontra. É o marco
// positivo de "a consulta terminou" — melhor do que esperar a tela ficar quieta,
// que é indistinguível de "a tela ainda nem começou".
const SEL_NOME_BENEFICIARIO = '#indemp'

// Prova de que a identificação foi concluída: `aplicarCodigoBiofacialFormulario`
// grava o código devolvido pela API em `input[name=autBiofacial]`.
const SEL_CODIGO_IDENTIFICACAO = 'input[name="autBiofacial"]'

async function visivel(page, seletor) {
  return page.locator(seletor).first().isVisible().catch(() => false)
}

/**
 * O modal do token está na tela?
 *
 * Exige o CAMPO, não só a caixa: um `#checkToken` que a ASSIM deixou no DOM
 * inerte ainda pode responder `:visible`, e usá-lo como sinal suspenderia o
 * prazo do robô à toa. Se o input está visível, há alguém digitando (ou por
 * digitar) um token de verdade.
 */
async function tokenNaTela(page) {
  return page.locator(`${SEL_MODAL_TOKEN}:visible input[type="text"], ` +
                      `${SEL_MODAL_TOKEN}:visible input:not([type])`)
    .first().isVisible().catch(() => false)
}

/**
 * Os três campos da carteirinha, ou null se a página já não responde.
 *
 * Existe porque `limpa_carteira()` da ASSIM é o efeito colateral de fechar o
 * modal no "x" E de errar o CPF/nascimento: nos dois casos os campos voltam
 * vazios, e seguir em frente assim produz a recusa "Beneficiario nao
 * confirmado" no envio. Lido em dois lugares (depois do preenchimento e no fim
 * da confirmação), então mora aqui.
 */
async function lerCarteirinha(page) {
  return page.evaluate(() => {
    const f = document.forms.autorizador
    if (!f) return null
    return [f.associado1.value, f.associado2.value, f.associado3.value]
  }).catch(() => null)
}

function carteirinhaVazia(cartao) {
  return !cartao || cartao.some(v => !String(v || '').trim())
}

/**
 * Espera a tela parar de estar ocupada.
 *
 * Ganhou teto. Antes era `while (true)` sem prazo: um modal que não fechasse
 * deixava a tarefa — e portanto o worker inteiro — parada para sempre.
 */
async function aguardarTelaLivre(page, timeoutMs = 45000) {
  const limite = Date.now() + timeoutMs

  while (Date.now() < limite) {
    const ocupada = await page.locator(`
      ${SEL_LOADER}:visible,
      ${SEL_ALERTA_JQUERY}:visible,
      .modal:visible,
      [role="dialog"]:visible,
      img[src*="Load_Assim"]:visible,
      .loading:visible,
      .spinner:visible,
      [class*="loader"]:visible
    `).count().catch(() => 0)

    if (ocupada === 0) return true

    await delay(500)
  }

  return false
}

// =========================
// NASCIMENTO + CPF (#checkBday)
// =========================
//
// POR QUE ISTO EXISTE
// Quando o credenciado não tem dispositivo Intelbras — o caso desta clínica — a
// ASSIM cai em `abrirModal()` e pede NASCIMENTO + CPF em `#checkBday`. Até a
// versão 1.1.6 isso era inteiramente da recepção: o robô esperava e saía da
// frente. Agora ele preenche, porque os dois campos já vêm na tarefa
// (robo_buscar_tarefa, migration 20260902130000) e são os mesmos que aparecem no
// card do paciente na /solicitar.
//
// O QUE ESTA FUNÇÃO NÃO FAZ
// Não opera o QR (#myModal), não digita token (#checkToken) e não responde aos
// avisos com botão (.jconfirm-box). O gatilho é `#checkBday` e só ele: nos outros
// caminhos ela sai por 'sem_modal' sem tocar em nada, e a etapa humana segue como
// sempre foi.
//
// POR QUE ELA NUNCA LANÇA
// Devolve veredito ('preenchido' | 'sem_dados' | 'sem_modal' | 'recusado') para
// quem chama decidir. Um throw aqui dentro chegaria a worker.js:325 e fecharia a
// aba — que é o certo para 'recusado', mas seria desastroso para 'sem_modal', o
// caso mais comum de todos.
//
// A ARMADILHA QUE GOVERNA O DESENHO
// Errar o CPF/nascimento faz o portal rodar `limpa_carteira()`, que apaga
// associado1/2/3. Ou seja: um preenchimento errado não só falha, ele destrói o
// estado do formulário. Daí três regras:
//   - dado incompleto NÃO é digitado (meio CPF é pior que nenhum);
//   - o que foi digitado é RELIDO antes de clicar em Confirmar;
//   - recusa não é repetida — o dado do TiTa pode simplesmente divergir do
//     cadastro da ASSIM, e insistir só gasta outra limpa_carteira().

/**
 * @returns {Promise<'preenchido'|'sem_dados'|'sem_modal'|'recusado'>}
 */
async function preencherNascimentoCpf(page, cfg, api, tarefa, alertas) {
  const tetoModal = Number(cfg.modal_bday_ms) || 10000

  // ---- 1. O modal é este mesmo? ----
  // Prazo curto de propósito: este tempo é somado a TODA tarefa que não passa
  // pelo #checkBday (biofacial, QR, token). Não é lugar de ser generoso.
  const abriu = await page.locator(`${SEL_MODAL_BENEFICIARIO}:visible`)
    .first().waitFor({ state: 'visible', timeout: tetoModal })
    .then(() => true).catch(() => false)

  if (!abriu) return 'sem_modal'

  // ---- 2. Temos o dado? ----
  // Normaliza primeiro, decide depois. A migration já entrega o CPF com 11
  // dígitos, mas quem lê aqui não pode depender disso: o robô 1.1.7 pode estar
  // falando com a RPC antiga, que não manda o campo nenhum.
  const cpf = String(tarefa.cpf ?? '').replace(/\D/g, '')
  const nasc = String(tarefa.data_nascimento ?? '').slice(0, 10)

  const faltando = []
  if (cpf.length !== 11) faltando.push('CPF')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nasc)) faltando.push('data de nascimento')

  if (faltando.length) {
    console.log(
      `📋 Modal de nascimento + CPF na tela, mas o cadastro não tem ${faltando.join(' e ')} — ` +
      'preenchimento fica para a recepção.'
    )
    await api.registrarLog(
      tarefa.id,
      `Sem ${faltando.join(' e ')} no cadastro: modal de identificacao deixado para a recepcao`
    )
    return 'sem_dados'
  }

  console.log('📋 Modal de nascimento + CPF — preenchendo com o cadastro do paciente')

  const modal = page.locator(`${SEL_MODAL_BENEFICIARIO}:visible`).first()

  // ---- 3. Achar os campos DENTRO do modal ----
  // Por tipo e ordem, não por `name`: assim "a ASSIM renomeou um id" não vira
  // "o robô digitou CPF no campo de data". O campo de data é o primeiro input
  // que não seja de botão; o do CPF é reconhecido pelo placeholder da própria
  // página ("digite apenas numeros"), com a ordem como reserva.
  const campoData = modal.locator(
    'input[type="date"], input[name*="nasc" i], input[id*="nasc" i]'
  ).first()

  const campoCpf = modal.locator(
    'input[placeholder*="numero" i], input[name*="cpf" i], input[id*="cpf" i]'
  ).first()

  const temData = await campoData.count().then(n => n > 0).catch(() => false)
  const temCpf = await campoCpf.count().then(n => n > 0).catch(() => false)

  if (!temData || !temCpf) {
    console.warn(
      '⚠️  Não localizei os campos de nascimento/CPF dentro do #checkBday. ' +
      'A ASSIM pode ter mudado o modal — deixando para a recepção.'
    )
    await api.registrarLog(
      tarefa.id,
      'Campos do modal de nascimento/CPF nao localizados: deixado para a recepcao'
    )
    return 'sem_dados'
  }

  // ---- 4. A data, no formato que o campo aceita ----
  // Decidido em runtime, não pelo print: `input[type=date]` só aceita
  // 'YYYY-MM-DD' via fill() (e digitar nele depende da ordem dos segmentos no
  // locale do Chromium); qualquer outro tipo quer a ordem brasileira.
  const tipoData = await campoData
    .evaluate(el => (el.type || '').toLowerCase()).catch(() => '')

  const [ano, mes, dia] = nasc.split('-')

  if (tipoData === 'date') {
    await campoData.fill(nasc)
    // fill() já dispara input/change, mas os handlers do portal são atributos
    // inline e re-disparar não custa nada — é o mesmo cinto do select de UF.
    await campoData.evaluate(el => {
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }).catch(() => {})
  } else {
    // Sem barras: se o campo tiver máscara, ela as insere sozinha, e digitar as
    // nossas produziria "12//2//2018".
    await humanType(page, await seletorDe(campoData), `${dia}${mes}${ano}`)
  }

  // ---- 5. O CPF ----
  await humanType(page, await seletorDe(campoCpf), cpf)

  // ---- 6. Conferir ANTES de confirmar ----
  // Data meio digitada enviada ao ConfirmBdayDate() é uma limpa_carteira() de
  // graça. Reler é mais barato que a recusa.
  const dataDigitada = String(await campoData.inputValue().catch(() => ''))
  const cpfDigitado = String(await campoCpf.inputValue().catch(() => '')).replace(/\D/g, '')

  const dataOk = tipoData === 'date'
    ? dataDigitada === nasc
    : dataDigitada.replace(/\D/g, '') === `${dia}${mes}${ano}`

  if (!dataOk || cpfDigitado !== cpf) {
    console.warn(
      `⚠️  O que entrou nos campos não confere (data="${dataDigitada}", ` +
      `cpf com ${cpfDigitado.length} dígitos) — não vou clicar em Confirmar.`
    )
    await api.registrarLog(
      tarefa.id,
      'Preenchimento do modal de nascimento/CPF nao confirmado na releitura: deixado para a recepcao'
    )
    return 'sem_dados'
  }

  // ---- 7. Confirmar ----
  // Sem o clique nada é validado: é o ConfirmBdayDate() que troca
  // #InformeOsDados por #EnviarDados. Preencher e não clicar não entregaria
  // nada — e, pior, deixaria o robô sem sinal para distinguir dado certo de
  // dado errado.
  const marcaAlerta = alertas.length

  await modal.locator('button, input[type="button"], input[type="submit"], a')
    .filter({ hasText: /confirmar/i }).first().click({ timeout: 5000 })
    .catch(async () => {
      // Fallback: alguns botões do portal são <input value="Confirmar">, que o
      // filtro por hasText não alcança.
      await modal.locator('input[value*="onfirmar" i]').first()
        .click({ timeout: 5000 }).catch(() => {})
    })

  console.log('   ✔️  Nascimento e CPF enviados; aguardando a ASSIM validar')

  // ---- 8. O desfecho ----
  // Lido no fonte real de `ConfirmBdayDate()` (custom/js/modal_confirm_ben.js,
  // conferido em 2026-09-02), e NÃO por suposição — o que desfez duas crenças:
  //
  // 1. A recusa NÃO roda `limpa_carteira()`. As linhas que zeravam
  //    associado1/2/3 estão COMENTADAS no portal; o que a recusa faz é limpar
  //    só #bday e #cpf, chamar trocaElement("InformeOsDados","EnviarDados") e
  //    alertar. O modal FICA ABERTO, esperando outra tentativa.
  //    Por isso a recusa aqui não derruba mais a tarefa: a tela continua
  //    perfeitamente utilizável e a recepção corrige à mão, como sempre fez.
  // 2. NÃO há limite de tentativas — nenhum contador, nenhum bloqueio do
  //    beneficiário. O risco de "trancar o paciente" não existe.
  //
  // A checagem da carteirinha continua aqui como rede: é barata e cobre o
  // caminho de fechar o modal no "x", que É `limpa_carteira()` de verdade.
  const limite = Date.now() + 15000
  while (Date.now() < limite) {
    const recusa = alertas.slice(marcaAlerta)
      .find(t => /incorret/i.test(t) && /cpf|nascimento/i.test(t))

    if (recusa) {
      await api.registrarLog(tarefa.id, `ASSIM recusou o CPF/nascimento: ${recusa}`)
      return 'recusado'
    }

    if (carteirinhaVazia(await lerCarteirinha(page))) {
      await api.registrarLog(
        tarefa.id,
        'ASSIM limpou a carteirinha depois do CPF/nascimento (dado recusado)'
      )
      return 'recusado'
    }

    if (!await visivel(page, SEL_MODAL_BENEFICIARIO)) return 'preenchido'

    await delay(500)
  }

  // Modal ainda de pé e nenhum alerta: não afirmar sucesso. A etapa humana
  // assume daqui, que é o comportamento de 1.1.6.
  console.warn('⚠️  A ASSIM não respondeu ao CPF/nascimento no prazo — seguindo com a recepção')
  return 'sem_dados'
}

/**
 * O seletor CSS de um locator, para poder usar `humanType`.
 *
 * `humanType` recebe seletor (page.focus + keyboard.type) porque foi extraído
 * quando tudo aqui era seletor solto. Em vez de duplicar a digitação humana para
 * aceitar locator, resolve-se o caminho do elemento uma vez.
 */
async function seletorDe(locator) {
  const id = await locator.evaluate(el => el.id).catch(() => '')
  if (id) return `#${id}`

  const name = await locator.evaluate(el => el.name).catch(() => '')
  if (name) return `${SEL_MODAL_BENEFICIARIO} [name="${name}"]`

  // Sem id nem name: marca o elemento para poder endereçá-lo.
  const marca = 'robo-campo-' + Math.random().toString(36).slice(2, 8)
  await locator.evaluate((el, m) => el.setAttribute('data-robo', m), marca).catch(() => {})
  return `[data-robo="${marca}"]`
}

// =========================
// CONFIRMAÇÃO DO BENEFICIÁRIO
// =========================
//
// POR QUE ISTO EXISTE
// A ASSIM passou a exigir validação de presença do beneficiário antes de aceitar
// o envio — a mesma mudança que trouxe a tela de login. Esta etapa é do HUMANO,
// e é o ponto do processo em que o robô tem que sair da frente e esperar.
//
// A CADEIA, lida no código do portal:
//   blur de associado3 → conferirCampos()
//     → dadosformChoiceCard.php  (acha o beneficiário; escreve o nome em #indemp)
//     → verificarIntervaloAtendimento()
//         → "ja identificado hoje no intervalo de 30 minutos" → alerta com botões
//         → "Credenciado nao possui dispositivo Intelbras"    → abrirModal()
//         → senão → validarPresenca()
//             → "aceita cadastrar biometria facial?" → alerta Sim/Não, e recomeça
//             → "confirmado presencialmente"         → alerta verde "Tudo certo!"
//             → dispositivo indisponível / erro 500  → abrirModal()
//   abrirModal() = #checkBday, que pede NASCIMENTO + CPF.
//   A recepção ainda pode escolher QR Code (#myModal) ou token (#checkToken).
//
// Ou seja: são várias rodadas. O botão "Confirmar identificacao" chama
// `validarPresenca()` DE NOVO, e entre uma rodada e outra há requisições de até
// 30 segundos com a tela quieta.
//
// TRÊS ARMADILHAS QUE JÁ CUSTARAM CARO AQUI
// 1. `#loadModal` nasce com display:block e vazio. Quem olhar `display` acha que
//    há um loader aberto o tempo todo; quem olhar só uma vez logo após o Tab
//    acha que a tela está livre e passa reto. Por isso tudo aqui usa `:visible`
//    do Playwright, que exige caixa.
// 2. SILÊNCIO NÃO É CRITÉRIO. A versão anterior desta função concluía a espera
//    quando a tela ficava 2,5s quieta — e em máquina real ela saiu antes de
//    QUALQUER modal aparecer, porque o intervalo entre o loader fechar e o
//    aviso de identificação surgir é maior que isso. O log registrou
//    "validação concluída pela recepção" sem que ninguém tivesse visto nada.
//    Agora a identificação é OBRIGATÓRIA: o robô espera ela APARECER, e só
//    então espera ela ser resolvida.
// 3. A geração anterior do RPA esperava aqui SEM PRAZO NENHUM (commit 966e3ea,
//    "funcionando com parada do modal"). Isso trava o worker inteiro quando a
//    recepção some. Aqui o prazo é largo — 15 min — mas existe.
//
// O QUE É DO ROBÔ E O QUE É DO HUMANO, desde 1.1.7
// O robô preenche o #checkBday (nascimento + CPF), porque tem esse dado no
// cadastro — ver preencherNascimentoCpf(). Não opera o QR, não digita token e não
// responde aos avisos com botão: isso continua sendo da recepção, com o
// beneficiário na frente.
//
// E o modal do TOKEN tem tratamento próprio: enquanto ele está na tela o prazo
// do robô fica SUSPENSO, e ao fim ele desiste sem fechar a aba. Quem fecha o
// token é o usuário, só.
async function aguardarConfirmacaoBeneficiario(page, cfg, api, tarefa, alertas = []) {
  const tetoConsulta = Number(cfg.beneficiario_consulta_ms) || 60000
  const tetoAparecer = Number(cfg.identificacao_aparecer_ms) || 90000
  // `confirmacao_beneficiario_ms` NÃO é mais lido: desde a 1.1.8 a espera pela
  // identificação também é sem prazo. Ver o bloco da etapa 3.
  //
  // Teto próprio do token, contado de quando ele aparece. Sobrevive porque sua
  // saída é SEGURA: devolve 'token_pendente' por retorno, sem lançar e sem
  // fechar a aba. Largo porque do outro lado há um pai procurando o SMS.
  const tetoToken = Number(cfg.token_ms) || 1800000
  const SILENCIO_MS = 6000

  const filaId = tarefa.id

  const marcaAlerta = alertas.length

  const contar = (seletor) => page.locator(seletor).count().catch(() => -1)
  const identificado = () => page.locator(SEL_CODIGO_IDENTIFICACAO)
    .inputValue().then(v => String(v || '').trim().length > 0).catch(() => false)

  // ---- 1. A ASSIM encontrou o beneficiário? ----
  const achou = await page.waitForFunction(() => {
    const el = document.getElementById('indemp')
    return !!el && el.innerHTML.trim().length > 0
  }, { timeout: tetoConsulta }).then(() => true).catch(() => false)

  if (!achou) {
    // Os caminhos de erro da ASSIM aqui usam alert() — que o Playwright dispensa
    // sozinho. Sem repassar o texto, o motivo real (carteirinha errada, campos
    // anteriores em branco) sumiria.
    const recusa = alertas.slice(marcaAlerta)[0]
    throw new Error(
      recusa
        ? `A ASSIM não aceitou a carteirinha: "${recusa}"`
        : 'A ASSIM não retornou os dados do beneficiário no prazo. ' +
          'Confira a carteirinha da solicitação.'
    )
  }

  console.log('👤 Beneficiário localizado na ASSIM')

  // ---- 2. Esperar a identificação APARECER ----
  // Este passo é o coração da correção: enquanto ela não sobe na tela, o robô
  // não tem o direito de continuar preenchendo.
  console.log('⏸️  Aguardando a ASSIM abrir a identificação do beneficiário...')

  const limiteAparecer = Date.now() + tetoAparecer
  // 10s: tempo de sobra para a cadeia de requisições da ASSIM responder, sem
  // deixar a recepção esperando à toa quando o Tab não pegou.
  const INTERVALO_INSISTIR = Number(cfg.insistir_blur_ms) || 10000
  let apareceu = false
  let insistencias = 0
  let proximaInsistencia = Date.now() + INTERVALO_INSISTIR

  while (Date.now() < limiteAparecer) {
    const n = await contar(SEL_IDENTIFICACAO)
    if (n === -1) throw new Error('A janela da ASSIM foi fechada durante a identificação do beneficiário.')
    if (n > 0) { apareceu = true; break }

    // Se a ASSIM já carimbou o código de identificação sem pedir nada (o
    // beneficiário se identificou há pouco no dispositivo), não há o que esperar.
    if (await identificado()) {
      console.log('✅ A ASSIM já tinha a identificação deste beneficiário')
      return 'automatica'
    }

    // Aconteceu em máquina real: a consulta rodou (o nome do beneficiário
    // apareceu) mas a identificação não subiu. Quem resolveu foi a recepção,
    // clicando de volta no campo da matrícula e dando outro Tab. É esse gesto
    // que está aqui — e só quando a ASSIM não está no meio de uma requisição,
    // para não disparar a consulta duas vezes.
    if (Date.now() >= proximaInsistencia && insistencias < 2) {
      proximaInsistencia = Date.now() + INTERVALO_INSISTIR
      if (await contar('#loadModal:visible') === 0) {
        insistencias++
        console.log(`↻ A ASSIM não abriu a identificação — repetindo o Tab da carteirinha (${insistencias}/2)`)
        await page.evaluate(() => {
          const campo = document.forms.autorizador?.associado3
          if (!campo) return
          campo.focus()
          campo.blur()
        }).catch(() => {})
      }
    }

    await delay(500)
  }

  if (!apareceu) {
    throw new Error(
      'A ASSIM não abriu a identificação do beneficiário. Sem ela o envio é ' +
      'recusado ("Beneficiario nao confirmado"). Confira a tela do portal.'
    )
  }

  // ---- 2b. Se o caminho foi o #checkBday, o robô preenche ----
  // Feito AQUI e não dentro do laço da etapa 3: ali seria re-disparado a cada
  // volta. A função sai por 'sem_modal' de graça quando o caminho é outro.
  const bday = await preencherNascimentoCpf(page, cfg, api, tarefa, alertas)

  if (bday === 'recusado') {
    // NÃO derruba a tarefa. Lendo o fonte de `ConfirmBdayDate()`, a recusa deixa
    // a tela intacta: limpa só os dois campos do modal e o deixa aberto para
    // outra tentativa (as linhas que zeravam a carteirinha estão comentadas no
    // portal). Lançar aqui fecharia a aba — pelo worker — de uma tela que a
    // recepção ainda pode usar, trocando um contratempo por uma tarefa perdida.
    //
    // Então o robô faz o que faria uma atendente: avisa e sai da frente. A etapa
    // 3 assume, e é a recepção que digita o dado certo com o beneficiário na
    // frente — exatamente o comportamento do 1.1.6.
    const recusa = alertas.slice(marcaAlerta)
      .find(t => /incorret/i.test(t) && /cpf|nascimento/i.test(t))

    console.warn(
      '⚠️  A ASSIM recusou o CPF/nascimento do cadastro' +
      (recusa ? ` ("${recusa}")` : '') + '. A recepção assume a partir daqui.'
    )
    await api.registrarLog(
      tarefa.id,
      'Cadastro diverge do registro da ASSIM: identificacao devolvida para a recepcao'
    )
  }

  // 'preenchido' NÃO pula a etapa 3: a ASSIM ainda pode subir o "Tudo certo!" ou
  // encadear outra rodada de validarPresenca(). A etapa 3 já sabe concluir por
  // autBiofacial ou silêncio — só que agora em segundos, não em minutos.

  // ---- 3. Esperar a recepção resolver ----
  console.log('🧍 IDENTIFICAÇÃO DO BENEFICIÁRIO NA TELA DA ASSIM — o robô está PARADO.')
  console.log('   Conclua na tela: QR Code no dispositivo, biometria facial, token ou nascimento + CPF.')
  console.log('   O preenchimento só continua depois disso. SEM PRAZO: esta janela não fecha sozinha.')
  await api.registrarLog(filaId, 'Aguardando a recepcao identificar o beneficiario na tela da ASSIM')

  const inicio = Date.now()
  let silencioDesde = null
  let ultimoLog = Date.now()
  let tokenDesde = null
  let avisouToken = false

  // Sem prazo desde a 1.1.8. Antes o laço morria em `confirmacao_beneficiario_ms`
  // (15 min) e o throw logo abaixo levava a janela junto — a recepção perdia a
  // tela no meio da leitura facial/QR. As saídas legítimas continuam todas aqui:
  // a aba fechada por uma pessoa, o código de identificação gravado, o silêncio
  // da tela e o teto do token (que devolve sem lançar).
  while (true) {
    const ocupada = await contar(SEL_ASSIM_OCUPADA)
    if (ocupada === -1) {
      throw new Error('A janela da ASSIM foi fechada durante a identificação do beneficiário.')
    }

    // O token é do usuário e tem teto próprio, contado de quando aparece.
    if (await tokenNaTela(page)) {
      if (tokenDesde === null) tokenDesde = Date.now()

      if (!avisouToken) {
        avisouToken = true
        console.log('🔑 TOKEN DO BENEFICIÁRIO NA TELA — o robô não fecha esta janela.')
        await api.registrarLog(
          filaId, 'Modal de token aberto: robo aguardando sem prazo e sem fechar a aba'
        )
      }

      // O teto do token não fere a regra da 1.1.8: ele devolve a tarefa por
      // RETORNO, sem lançar, e a aba fica de pé. Um token de ~60s que está na
      // tela há meia hora já morreu de qualquer forma.
      if (Date.now() - tokenDesde >= tetoToken) {
        console.warn(
          `⚠️  O token está aberto há ${Math.round(tetoToken / 60000)} min. ` +
          'Devolvendo a tarefa para a recepção — a aba fica aberta.'
        )
        return 'token_pendente'
      }

      silencioDesde = null
      await delay(700)
      continue
    }

    tokenDesde = null

    if (ocupada > 0) {
      silencioDesde = null
    } else {
      // Atalho: a ASSIM já gravou o código da identificação e não há mais nada
      // aberto. Acabou, sem esperar o silêncio inteiro.
      if (await identificado()) break

      if (silencioDesde === null) silencioDesde = Date.now()
      if (Date.now() - silencioDesde >= SILENCIO_MS) break
    }

    if (Date.now() - ultimoLog >= 15000) {
      ultimoLog = Date.now()
      console.log(
        `⌛ Ainda aguardando a recepção... (${Math.round((Date.now() - inicio) / 1000)}s). ` +
        'Sem prazo: a janela não fecha sozinha.'
      )
    }

    await delay(700)
  }

  // ---- 4. Sobrou tela utilizável? ----
  // Fechar o modal no "x", ou errar o CPF/nascimento, faz o portal rodar
  // `limpa_carteira()`. Seguir em frente nesse estado produz exatamente a recusa
  // "Beneficiario nao confirmado" no envio.
  if (carteirinhaVazia(await lerCarteirinha(page))) {
    throw new Error(
      'A identificação do beneficiário foi cancelada na tela da ASSIM — o portal ' +
      'limpou a carteirinha. Reabra a solicitação para tentar de novo.'
    )
  }

  console.log(
    (await identificado())
      ? '✅ Identificação concluída pela recepção'
      : '✅ Identificação encerrada pela recepção (sem código biofacial — ' +
        'a ASSIM pode recusar o envio)'
  )

  return 'manual'
}

function normalizarTexto(texto) {
  return texto
    .normalize('NFD')
    // \p{Diacritic} em vez da faixa ̀-ͯ escrita à mão: o arquivo fica
    // 100% ASCII neste ponto, então não depende de como o editor salva bytes.
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
}

// =========================
// AGUARDAR ENVIO REAL
// =========================

// Os dois desfechos que a ASSIM imprime no recibo. A tela é a MESMA nos dois
// casos — muda só esta linha e, na rejeição, o motivo ao lado do TUSS.
//
// Os marcadores são ASCII puro de propósito: a página vem sem charset declarado
// e todo acento chega quebrado ("STATUS DA AUTORIZAï¿½ï¿½O"). Casar por texto
// acentuado aqui seria casar por sorte.
const MARCAS_DESFECHO = [
  { marca: 'BENEFICIO PROCESSADO', resultado: 'sucesso'   },
  { marca: 'BENEFICIO REJEITADO',  resultado: 'rejeitado' },
]

/**
 * Espera o desfecho do envio feito pela recepcionista. SEM PRAZO.
 *
 * Passou a olhar os alertas da ASSIM. Antes só esperava o texto de sucesso: um
 * envio recusado pelo servidor ("Beneficiario nao confirmado. Tentar novamente")
 * era indistinguível de recepcionista que saiu para o almoço, e as duas coisas
 * viravam a mesma mensagem errada na fila.
 *
 * Passou também a reconhecer a REJEIÇÃO. Antes só existia "BENEFICIO
 * PROCESSADO": quando a ASSIM recusava, o robô não achava nada, queimava o
 * prazo inteiro e o timeout virava "a recepção não clicou em enviar" — mentira
 * que jogava fora a guia e o horário que estavam na tela.
 *
 * DESDE A 1.1.8 NÃO HÁ MAIS PRAZO NENHUM AQUI. Havia 120s (`envio_timeout_ms`),
 * e quando estouravam esta função devolvia 'timeout', o chamador LANÇAVA, o
 * worker chamava sessao.descartar() e o contexto do Chrome fechava: a janela
 * sumia na cara do operador, com o formulário preenchido dentro. Ninguém via
 * contagem alguma — a tela simplesmente desaparecia no meio do atendimento.
 *
 * A espera agora acaba de dois jeitos, e só: a ASSIM responde, ou uma PESSOA
 * fecha a aba. O prazo do servidor é ignorado de propósito — máquina com config
 * velha em cache não pode ressuscitar o fechamento automático.
 *
 * A espera continua depois de um ALERTA de recusa, de propósito: aquilo acontece
 * sem sair da tela e a recepcionista pode corrigir e reenviar. Já a rejeição é
 * outra página, com recibo — não há o que reenviar, então retorna na hora.
 *
 * @param {string[]} alertas array alimentado pelo handler de dialog da aba
 * @returns {Promise<{resultado: 'sucesso'|'rejeitado'|'aba_fechada', recusa: string|null}>}
 */
async function aguardarResultadoEnvio(page, alertas = []) {
  console.log('⏳ Aguardando o envio da recepção — SEM PRAZO. Esta janela não fecha sozinha.')

  const inicio = Date.now()
  let ultimoLog = Date.now()
  let lidos = alertas.length
  let recusa = null

  while (true) {
    // Mesmo padrão da identificação (`contar`): `isClosed()` sozinho não pega o
    // contexto derrubado por fora, e sem esta saída o laço giraria para sempre
    // numa página que já não existe.
    const viva = await page.locator('body').count().catch(() => -1)
    if (viva === -1 || page.isClosed()) {
      console.log('🚪 A janela da ASSIM foi fechada antes do envio')
      return { resultado: 'aba_fechada', recusa }
    }

    for (const { marca, resultado } of MARCAS_DESFECHO) {
      if (await visivel(page, `text=${marca}`)) {
        console.log(resultado === 'sucesso'
          ? '✅ SUCESSO CONFIRMADO'
          : '🚫 A ASSIM REJEITOU o benefício — lendo o motivo do recibo')
        return { resultado, recusa: null }
      }
    }

    while (lidos < alertas.length) {
      recusa = alertas[lidos++]
      console.log('⚠️  A ASSIM recusou o envio:', recusa)
    }

    // Espera infinita não pode ser espera muda: sem isto, ninguém que abre o log
    // consegue distinguir "parado esperando o clique" de "travado".
    if (Date.now() - ultimoLog >= 30000) {
      ultimoLog = Date.now()
      console.log(
        `⌛ Ainda aguardando o clique em enviar... (${Math.round((Date.now() - inicio) / 1000)}s). ` +
        'A aba só sai daqui pelo envio ou se alguém fechá-la.'
      )
    }

    await delay(1000)
  }
}

// =========================
// MODAL DE FORMA DE VALIDAÇÃO
// =========================
//
// Três defeitos da versão anterior, todos corrigidos aqui:
//
// 1. SUMIA. O modal é um <div> pendurado no document.body da página da ASSIM.
//    Qualquer navegação ou recarga o levava junto.
// 2. TRAVAVA O ROBÔ INTEIRO quando sumia. A escolha vivia numa Promise dentro
//    do page.evaluate; se o elemento morresse, o resolve() nunca vinha, não
//    havia timeout, e o laço do worker ficava preso naquela tarefa para sempre —
//    a recepção parava até alguém matar o node.exe no Gerenciador de Tarefas.
// 3. NÃO PEDIA CONFIRMAÇÃO. Um clique único já gravava, sem chance de corrigir.
//
// Agora: a escolha vive no processo Node (via exposeFunction, que sobrevive a
// navegação), um watchdog reinjeta o modal se a página o derrubar, o fechamento
// por clique fora e por Escape está bloqueado, a gravação exige dois passos, e
// há prazo — esgotado, a tarefa termina num estado visível e o robô volta a
// atender.

const OPCOES_VALIDACAO = [
  'Biometria',
  'QR Code',
  'Token',
  'Erro no Reconhecimento Facial',
  'Beneficiário recusou validação facial/QR Code',
  'Beneficiário sem celular',
]

const ID_MODAL = 'robo-modal-forma-validacao'
const FN_CONFIRMAR = '__roboConfirmarFormaValidacao'

function desenharModal({ opcoes, idModal, fnConfirmar }) {
  if (document.getElementById(idModal)) return

  const overlay = document.createElement('div')
  overlay.id = idModal
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.55)',
    zIndex: '2147483647', display: 'flex', alignItems: 'center',
    justifyContent: 'center', fontFamily: 'Arial, sans-serif',
  })

  // Clique fora NÃO fecha. O overlay engole o evento e não faz nada — a
  // recepcionista é obrigada a escolher e confirmar.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      e.stopPropagation()
      e.preventDefault()
      caixa.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' },
         { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
        { duration: 180 }
      )
    }
  }, true)

  const caixa = document.createElement('div')
  Object.assign(caixa.style, {
    width: '560px', maxWidth: 'calc(100% - 32px)', background: '#fff',
    borderRadius: '12px', padding: '24px',
    boxShadow: '0 24px 64px rgba(0,0,0,.35)',
  })

  const titulo = document.createElement('h2')
  titulo.textContent = 'Como a autorização foi validada?'
  Object.assign(titulo.style, { margin: '0 0 6px', fontSize: '20px', color: '#111' })

  const subtitulo = document.createElement('p')
  subtitulo.textContent = 'Selecione uma opção e confirme. Esta informação é obrigatória.'
  Object.assign(subtitulo.style, { margin: '0 0 18px', fontSize: '14px', color: '#555' })

  const lista = document.createElement('div')
  Object.assign(lista.style, { display: 'flex', flexDirection: 'column', gap: '8px' })

  let selecionada = null
  const botoes = []

  const pintar = () => {
    for (const b of botoes) {
      const ativa = b.dataset.opcao === selecionada
      b.style.background = ativa ? '#eff6ff' : '#fff'
      b.style.borderColor = ativa ? '#2563eb' : '#d1d5db'
      b.style.boxShadow = ativa ? 'inset 0 0 0 1px #2563eb' : 'none'
      b.style.fontWeight = ativa ? '600' : '400'
    }
    confirmar.disabled = !selecionada
    confirmar.style.background = selecionada ? '#2563eb' : '#cbd5e1'
    confirmar.style.cursor = selecionada ? 'pointer' : 'not-allowed'
  }

  for (const opcao of opcoes) {
    const botao = document.createElement('button')
    botao.type = 'button'
    botao.dataset.opcao = opcao
    botao.textContent = opcao
    Object.assign(botao.style, {
      padding: '12px 14px', border: '1px solid #d1d5db', borderRadius: '8px',
      background: '#fff', cursor: 'pointer', fontSize: '15px', textAlign: 'left',
      color: '#111',
    })
    botao.addEventListener('click', (e) => {
      e.stopPropagation()
      selecionada = opcao
      pintar()
    })
    botoes.push(botao)
    lista.appendChild(botao)
  }

  const rodape = document.createElement('div')
  Object.assign(rodape.style, {
    display: 'flex', justifyContent: 'flex-end', marginTop: '20px',
  })

  const confirmar = document.createElement('button')
  confirmar.type = 'button'
  confirmar.textContent = 'Confirmar'
  confirmar.disabled = true
  Object.assign(confirmar.style, {
    padding: '12px 28px', border: 'none', borderRadius: '8px',
    color: '#fff', fontSize: '15px', fontWeight: '600',
  })
  confirmar.addEventListener('click', (e) => {
    e.stopPropagation()
    if (!selecionada) return
    confirmar.disabled = true
    confirmar.textContent = 'Salvando...'
    // A resposta vai para o processo Node. Se a página morrer depois disto, a
    // escolha já está a salvo fora do navegador.
    window[fnConfirmar](selecionada)
    overlay.remove()
  })

  rodape.appendChild(confirmar)
  caixa.append(titulo, subtitulo, lista, rodape)
  overlay.appendChild(caixa)
  document.body.appendChild(overlay)

  pintar()

  // Escape não fecha.
  const barrarEscape = (e) => {
    if (e.key === 'Escape' && document.getElementById(idModal)) {
      e.stopPropagation()
      e.preventDefault()
    }
  }
  document.addEventListener('keydown', barrarEscape, true)
}

async function pedirFormaValidacao(page, timeoutMs) {
  let resolver
  const escolhido = new Promise(res => { resolver = res })

  // exposeFunction sobrevive a navegações da página — é o que tira a escolha de
  // dentro do DOM da ASSIM e a coloca no processo Node.
  try {
    await page.exposeFunction(FN_CONFIRMAR, (opcao) => resolver(opcao))
  } catch (e) {
    if (!/already registered/i.test(e.message)) throw e
  }

  const injetar = () => page.evaluate(desenharModal, {
    opcoes: OPCOES_VALIDACAO,
    idModal: ID_MODAL,
    fnConfirmar: FN_CONFIRMAR,
  }).catch(() => {})

  await injetar()

  let respondido = false
  const watchdog = setInterval(async () => {
    if (respondido) return
    try {
      const existe = await page.evaluate(
        (id) => !!document.getElementById(id), ID_MODAL
      )
      if (!existe) {
        console.log('🔁 Modal de validação desapareceu (a página navegou) — reinjetando')
        await injetar()
      }
    } catch (e) {
      // Página fechada pela recepcionista: nada a fazer aqui, o timeout resolve.
    }
  }, 1500)

  const prazo = new Promise(res => setTimeout(() => res(null), timeoutMs))

  try {
    const resposta = await Promise.race([escolhido, prazo])
    respondido = true

    if (resposta) {
      console.log('✅ Forma de validação:', resposta)
    } else {
      const prazoLegivel = timeoutMs >= 60000
        ? `${Math.round(timeoutMs / 60000)} min`
        : `${Math.round(timeoutMs / 1000)} s`
      console.warn(
        `⚠️  Ninguém respondeu o modal em ${prazoLegivel}. ` +
        'Encerrando a tarefa sem a forma de validação para não travar a fila.'
      )
    }

    return resposta

  } finally {
    clearInterval(watchdog)
    await page.evaluate((id) => document.getElementById(id)?.remove(), ID_MODAL).catch(() => {})
  }
}

// =========================
// CAPTURA DA TELA DE CONFIRMAÇÃO
// =========================

/**
 * Lê o recibo que a ASSIM devolve depois do envio.
 *
 * A tela é a mesma no aceite e na recusa — guia, data/hora, associado e
 * matrícula estão lá nos dois casos. O que muda é a linha do desfecho
 * ("BENEFICIO PROCESSADO" / "BENEFICIO REJEITADO") e, na recusa, o motivo
 * colado no TUSS: "TUSS 1 22070384 - (1013) CADASTRO DO BENEFICIARIO COM
 * PROBLEMAS".
 *
 * Guia sem zeros à esquerda, para casar com autorizacoes_assim.guia.
 * Data montada direto dos dígitos, sem passar por `new Date()`, para não sofrer
 * conversão de fuso do processo Node — grava exatamente o horário da ASSIM.
 *
 * Roda dentro de page.evaluate: nada aqui pode referenciar constante de fora.
 */
function lerConfirmacao() {
  const txt = (document.body && document.body.innerText) || ''

  const guiaMatch =
    txt.match(/Documento:\s*[A-Za-z0-9]+\s*\/\s*0*(\d+)/i) ||
    txt.match(/Documento:[^\n]*?\/\s*0*(\d{3,})/i)

  const dataMatch = txt.match(/Data:\s*(\d{2})\/(\d{2})\/(\d{2})\s*-\s*(\d{2}):(\d{2}):(\d{2})/)

  let dataConfirmacao = null
  if (dataMatch) {
    const [, dd, mm, yy, hh, mi, ss] = dataMatch
    dataConfirmacao = `20${yy}-${mm}-${dd}T${hh}:${mi}:${ss}`
  }

  // Marcadores ASCII: a página vem sem charset e os acentos chegam quebrados.
  const situacao =
    /BENEFICIO\s+REJEITADO/i.test(txt)  ? 'rejeitado'  :
    /BENEFICIO\s+PROCESSADO/i.test(txt) ? 'processado' : null

  // Só na recusa. No aceite a linha do TUSS não carrega motivo nenhum, e um
  // valor aqui só serviria para poluir status_assim.
  let motivoGlosa = null
  if (situacao === 'rejeitado') {
    const linhas = txt.split('\n').map(l => l.trim())

    // Formato observado: "(1013) CADASTRO DO BENEFICIARIO COM PROBLEMAS".
    // Vira "1013-CADASTRO ...", que é o formato que o robô do relatório já usa
    // em status_assim ("1601-REINCIDENCIA NO ATEN") — uma coluna, um
    // vocabulário, venha de onde vier.
    const comCodigo = linhas.find(l => /TUSS/i.test(l) && /\(\s*\d{3,5}\s*\)/.test(l))
    const m = comCodigo && comCodigo.match(/\(\s*(\d{3,5})\s*\)\s*(.+)$/)
    if (m) motivoGlosa = (m[1] + '-' + m[2].trim()).slice(0, 120)

    // Recusa cujo motivo venha sem o código entre parênteses: fica o texto.
    if (!motivoGlosa) {
      const alt = linhas.find(l => /^TUSS\b/i.test(l) && /\s-\s/.test(l))
      const m2 = alt && alt.match(/^TUSS\b.*?\s-\s(.+)$/i)
      if (m2) motivoGlosa = m2[1].trim().slice(0, 120)
    }
  }

  // Perícia para quando a guia não é capturada. A versão anterior gravava 500
  // caracteres crus do innerText em error_message — o que arrasta nome e
  // identificadores do beneficiário para uma coluna lida por muita gente.
  // Aqui só entram as linhas que servem ao diagnóstico.
  const linhasUteis = txt
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && /documento|data:|guia|autoriza|benefici|\d{4,}/i.test(l))
    .slice(0, 6)
    .join(' | ')
    .slice(0, 300)

  return {
    numeroGuia: guiaMatch ? guiaMatch[1] : null,
    dataConfirmacao,
    linhasUteis,
    situacao,
    motivoGlosa,
  }
}

// =========================
// FUNÇÃO PRINCIPAL
// =========================

/**
 * @param {object}   opcoes
 * @param {object}   opcoes.page      página já autenticada na ASSIM
 * @param {object}   opcoes.tarefa    linha da fila devolvida por robo_buscar_tarefa
 * @param {object}   opcoes.cfg       robo_obter_config_assim
 * @param {object}   opcoes.api       instância de Api
 * @param {Function} opcoes.cancelado () => Promise<boolean>
 * @param {string[]} opcoes.alertas   alertas que a ASSIM emitiu nesta aba
 * @returns {Promise<'sucesso'|'sem_guia'|'glosa'|'devolvida'>}
 *
 * 'devolvida' = o robô desistiu de esperar mas NÃO fechou nada: o modal de token
 * ficou aberto e a tarefa voltou para a recepção. Volta por retorno, e não por
 * throw, exatamente para o worker não descartar a aba.
 */
async function executarRpa({ page, tarefa, cfg, api, cancelado, alertas = [], aba = null }) {
  if (!cancelado) cancelado = async () => false

  let concluiu = false

  try {
    console.log('🚀 Iniciando RPA...')
    console.log('Paciente:', tarefa.paciente_nome)

    // A página já chegou no formulário e o assim.js já esperou os scripts do
    // portal existirem. Esta pausa é o cinto: a ASSIM ainda faz coisas depois
    // que as funções aparecem, e digitar em cima disso foi o que deixou o
    // primeiro Tab sem efeito em máquina real. Ajustável pelo servidor.
    const esperaInicial = Number(cfg.espera_pagina_ms) || 2000
    if (esperaInicial > 0) {
      console.log(`⏱️  Deixando o portal assentar (${esperaInicial}ms)`)
      await delay(esperaInicial)
    }

    await page.selectOption('select[name="operacao"]', { label: cfg.tipo_operacao })
    await page.selectOption('select[name="natureza"]',  { label: cfg.natureza })
    await page.selectOption('select[name="servico"]',   { label: cfg.tipo_servico })

    if (await cancelado()) throw new Error('Execução cancelada')

    if (!tarefa.empresa || !tarefa.matricula || !tarefa.dep) {
      throw new Error('Dados do associado incompletos')
    }

    await humanType(page, 'input[name="associado1"]', tarefa.empresa)
    await humanType(page, 'input[name="associado2"]', tarefa.matricula)
    await humanType(page, 'input[name="associado3"]', tarefa.dep)

    // O blur do último campo da carteirinha dispara a busca do beneficiário e,
    // desde a mudança do portal, a confirmação de presença. Nada pode ser
    // digitado por cima disso.
    await page.press('input[name="associado3"]', 'Tab')

    const identificacao = await aguardarConfirmacaoBeneficiario(page, cfg, api, tarefa, alertas)

    // O token continua na tela e o robô desistiu de esperar. Encerra a tarefa
    // AQUI, por retorno normal: nada é lançado, então o worker toma o ramo de
    // sucesso e NÃO chama sessao.descartar() — a aba fica de pé com o token
    // intacto, para o responsável concluir, e o robô volta a atender.
    //
    // Status 'erro' porque não houve guia: o card na /solicitar não pode ficar
    // verde. A mensagem é a honesta, e diz que a aba continua aberta — senão a
    // recepção procura uma janela que acha que o robô fechou.
    if (identificacao === 'token_pendente') {
      await api.concluirTarefa(tarefa.id, 'erro', {
        erro: 'Token do beneficiario ficou aberto na tela sem ser concluido. ' +
              'A tarefa voltou para a recepcao e a ABA NAO FOI FECHADA: conclua ' +
              'o token na janela da ASSIM e solicite de novo.',
      })
      concluiu = true
      console.log('🔑 RPA devolvido à recepção — aba preservada com o token aberto')
      return 'devolvida'
    }

    await aguardarTelaLivre(page)

    await humanType(page, 'input[name="findexec"]', String(cfg.executor))
    await aguardarTelaLivre(page)

    await page.selectOption('select[name="exec"]', { label: cfg.executor_label })

    await humanType(page, 'input[name="procura"]', String(cfg.solicitante))
    await aguardarTelaLivre(page)

    await page.click('input[name="butproc"]')

    if (!tarefa.crm) throw new Error('CRM não informado')
    await page.fill('input[name="crmsolic"]', tarefa.crm)

    if (!tarefa.nome_medico) throw new Error('Nome do médico não informado')
    await page.fill('input[name="findsolic"]', normalizarTexto(tarefa.nome_medico))

    // UF do CRM solicitante. O portal fica em RJ por padrão; se o médico é de
    // outro estado (ex.: SP) a guia é rejeitada. Localiza o <select> de UF pelas
    // próprias opções (contém RJ e SP), sem depender do name exato do campo.
    const ufMedico = (tarefa.crm_uf || 'RJ').toUpperCase()
    const ufSelecionada = await page.evaluate((uf) => {
      const setUf = (sel) => {
        const opt = Array.from(sel.options).find(o =>
          (o.value || '').trim().toUpperCase() === uf ||
          (o.textContent || '').trim().toUpperCase() === uf)
        if (!opt) return null
        sel.value = opt.value
        sel.dispatchEvent(new Event('input',  { bubbles: true }))
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        return sel.name || '(sem name)'
      }
      const ufcrm = document.querySelector('select[name="ufcrm"]')
      if (ufcrm) { const r = setUf(ufcrm); if (r) return r }
      for (const sel of Array.from(document.querySelectorAll('select'))) {
        const up = Array.from(sel.options).map(o => (o.value || o.textContent || '').trim().toUpperCase())
        if (up.includes('RJ') && up.includes('SP')) { const r = setUf(sel); if (r) return r }
      }
      return null
    }, ufMedico)

    if (ufSelecionada) console.log(`✅ UF do CRM = ${ufMedico} (campo: ${ufSelecionada})`)
    else console.warn(`⚠️ Campo de UF não localizado; mantido o default (UF alvo: ${ufMedico})`)

    if (!tarefa.tuss) throw new Error('TUSS não informado')
    await humanType(page, 'input[name="ttuss1"]', tarefa.tuss)

    await page.selectOption('select[name="tipoDeConsulta"]', { label: cfg.tipo_consulta })
    await page.selectOption('select[name="tipoDeSaida"]',    { label: cfg.tipo_saida })

    // Último aviso antes de devolver a tela para a recepção: se a ASSIM ainda
    // mostra "Informe os Dados", ela não considera o beneficiário confirmado e
    // vai recusar o envio. Melhor deixar isso no log agora do que descobrir
    // depois pelo timeout.
    if (await visivel(page, SEL_ENVIO_BLOQUEADO)) {
      console.warn('⚠️  A ASSIM ainda não liberou o envio (beneficiário não confirmado)')
      await api.registrarLog(tarefa.id, 'ASSIM nao liberou o envio: beneficiario nao confirmado')
    }

    // ===== Aqui o robô para. Quem envia é a recepcionista. =====
    //
    // A partir daqui a aba é INTOCÁVEL enquanto o operador não resolver: a flag
    // segura a poda (assim.js), que fecharia esta janela ao passar do TTL de 30
    // min — e uma espera sem prazo passa desse TTL por definição.
    console.log('📤 Aguardando envio manual...')
    if (aba) aba.aguardandoOperador = true

    let resultado, recusa
    try {
      ;({ resultado, recusa } = await aguardarResultadoEnvio(page, alertas))
    } finally {
      if (aba) aba.aguardandoOperador = false
    }

    // A janela foi fechada por uma pessoa antes do envio. Encerra AQUI por
    // retorno normal, nunca por throw: é o throw que faz o worker chamar
    // sessao.descartar(). Mesmo desenho do 'token_pendente' acima.
    if (resultado === 'aba_fechada') {
      await api.concluirTarefa(tarefa.id, 'erro', {
        erro: recusa
          ? `A ASSIM recusou o envio ("${recusa}") e a janela foi fechada antes de ` +
            'reenviar. A solicitacao NAO foi enviada: corrija e solicite de novo.'
          : 'A janela da ASSIM foi fechada antes do clique em enviar. A solicitacao ' +
            'NAO foi enviada e nada foi autorizado: solicite de novo.',
      })
      concluiu = true
      console.log('🚪 RPA encerrado — a janela foi fechada antes do envio')
      return 'envio_nao_ocorrido'
    }

    console.log('📄 Aguardando tela final...')
    await page.waitForLoadState('networkidle').catch(() => {})
    await delay(2000)

    const {
      numeroGuia, dataConfirmacao, linhasUteis, situacao, motivoGlosa,
    } = await page.evaluate(lerConfirmacao)

    // A rejeição é um DESFECHO, não uma falha: a solicitação foi processada e o
    // convênio recusou. Tratá-la como erro (o que acontecia até aqui) jogava
    // fora a guia e o horário que estão na tela, não abria o modal de forma de
    // validação e deixava o paciente marcado como 'erro' na /solicitar.
    const rejeitado = resultado === 'rejeitado' || situacao === 'rejeitado'

    if (numeroGuia) console.log('🧾 Guia capturada:', numeroGuia)
    else if (!rejeitado) console.warn("⚠️ Guia não capturada da tela — registrando como 'concluido_sem_guia'")
    else console.warn('⚠️ Guia não capturada do recibo de rejeição')

    if (dataConfirmacao) console.log('🕒 Data/hora da confirmação:', dataConfirmacao)
    else console.warn('⚠️ Data/hora da confirmação não capturada')

    if (rejeitado) {
      console.log('🚫 Motivo da glosa:', motivoGlosa || '(não identificado no recibo)')
      await api.registrarLog(
        tarefa.id,
        'ASSIM rejeitou: ' + (motivoGlosa || 'motivo nao identificado no recibo')
      )
    }

    const forma = await pedirFormaValidacao(page, Number(cfg.modal_timeout_ms) || 600000)

    // Sem guia capturada a autorização até aconteceu na ASSIM, mas o vínculo não
    // existe. 'concluido' pintaria o card de verde e esconderia a lacuna;
    // 'concluido_sem_guia' a deixa visível e reprocessável no mesmo dia.
    const status = rejeitado
      ? 'glosa'
      : (numeroGuia ? 'concluido' : 'concluido_sem_guia')

    const problemas = []
    if (!numeroGuia) {
      problemas.push(
        (rejeitado ? 'Guia da rejeição não capturada.' : 'Guia não capturada.') +
        ` Trecho lido: ${linhasUteis || '(vazio)'}`
      )
    }
    if (!forma) problemas.push('Forma de validação não informada (modal expirou sem resposta).')

    await api.concluirTarefa(tarefa.id, status, {
      numeroAutorizacao: numeroGuia,
      formaAutorizacao: forma,
      horarioAutorizacao: dataConfirmacao,
      // O motivo vai para status_assim, a mesma coluna que o robô do relatório
      // preenche mais tarde — e no mesmo formato. Aqui ele chega horas antes.
      statusAssim: rejeitado ? motivoGlosa : null,
      erro: problemas.length ? problemas.join(' ') : null,
    })

    concluiu = true

    // Nada é lançado aqui: erro faria o worker fechar a aba (sessao.descartar),
    // e é dessa tela que a recepção tira o print para abrir a contestação.
    console.log(rejeitado ? '🚫 RPA finalizado — glosa registrada' : '✅ RPA finalizado')
    return rejeitado ? 'glosa' : (numeroGuia ? 'sucesso' : 'sem_guia')

  } catch (erro) {
    console.error('❌ Erro no RPA:', erro.message)

    if (!concluiu) {
      await api.concluirTarefa(tarefa.id, 'erro', { erro: erro.message.slice(0, 500) })
        .catch(e => console.error('⚠️  não foi possível marcar erro:', e.message))
    }

    throw erro
  }
}

module.exports = executarRpa
module.exports.OPCOES_VALIDACAO = OPCOES_VALIDACAO
module.exports.pedirFormaValidacao = pedirFormaValidacao
module.exports.lerConfirmacao = lerConfirmacao
module.exports.aguardarTelaLivre = aguardarTelaLivre
module.exports.aguardarConfirmacaoBeneficiario = aguardarConfirmacaoBeneficiario
module.exports.preencherNascimentoCpf = preencherNascimentoCpf
module.exports.SEL_MODAL_TOKEN = SEL_MODAL_TOKEN
module.exports.aguardarResultadoEnvio = aguardarResultadoEnvio
