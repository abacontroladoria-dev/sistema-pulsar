/**
 * =========================
 * SESSÃO ASSIM
 * =========================
 *
 * Resolve o problema relatado: "toda vez que clico em autorização ele pede
 * usuário e senha, mas indo direto no site eu só logo uma vez".
 *
 * CAUSA
 * rpa.js criava `browser.newContext()` por tarefa. Contexto do Playwright é
 * sessão limpa — cookies zerados. Cada autorização chegava à ASSIM como
 * visitante desconhecido, e quem pagava era a recepcionista, digitando a senha
 * do portal a cada paciente.
 *
 * POR QUE NÃO BASTA "USAR UM CONTEXTO SÓ"
 * Porque o contexto por tarefa não era desperdício: era proteção. O
 * `js/acesso.js` da ASSIM roda `limitarAba()`, que usa
 * `BroadcastChannel("autenticacao")` + `sessionStorage.tabid` para detectar
 * segunda aba do domínio e mandar a intrusa para `bloqueio.php`. Os dois
 * mecanismos são isolados por contexto — um contexto por tarefa nunca dispara o
 * guarda. Juntar tudo num contexto só seria entregar o robô ao bloqueio.
 *
 * Medido em 2026-08-13: na tela de login o guarda não dispara, porque
 * `multAbas` é lido sem nunca ser declarado e o `!multAbas` estoura
 * ReferenceError dentro do handler. Nas telas internas não há como saber sem
 * credencial — e não se projeta sobre palpite.
 *
 * SOLUÇÃO
 * Separar sessão de contexto. Loga UMA vez num contexto temporário, colhe o
 * `PHPSESSID`, joga o contexto fora. Cada tarefa segue no seu próprio contexto,
 * mas nasce com o cookie injetado — já autenticada. Login uma vez, isolamento
 * intacto.
 *
 * De brinde, os contextos passam a ser FECHADOS. Hoje eles vazam: rpa.js deixa
 * página e contexto abertos de propósito (para impressão) e nunca os recolhe,
 * então quarenta autorizações no dia viram quarenta processos de Chrome.
 *
 * -------------------------------------------------------------------------
 * AJUSTES DE 2026-08-13, DEPOIS DO PRIMEIRO DIA EM MÁQUINA REAL
 * -------------------------------------------------------------------------
 *
 * 1. A JANELA DO LOGIN NÃO É MAIS DESCARTADA. Ela abria, logava e fechava, e a
 *    tarefa abria outra em seguida: duas janelas para uma autorização. É a
 *    "tela piscando" que apareceu no teste. O login já cai em
 *    `formularionChoiceCard.php`, então essa janela é adotada como a aba da
 *    primeira tarefa. Uma janela, um contexto, sem pisca.
 *
 * 2. SÓ O `PHPSESSID` É TRANSPLANTADO. Antes iam todos os cookies do domínio,
 *    e o portal também emite `cookie[sequencial]` — um contador de transação.
 *    Medido no portal: injetando apenas o PHPSESSID, a ASSIM emite um
 *    sequencial novo para cada contexto e o formulário abre normalmente.
 *    Carregar o sequencial velho de um contexto para outro não tem ganho e é
 *    candidato ao "Sessão da ASSIM caiu" que apareceu na segunda tarefa.
 *
 * 3. `input[name="senha"]` NÃO SIGNIFICA "ESTOU NA TELA DE LOGIN". A página do
 *    formulário carrega a senha do posto num campo hidden com esse mesmo nome
 *    (verificado). Quem identifica a tela de login é `form[name="entrar"]`.
 *
 * -------------------------------------------------------------------------
 * 1.1.8 — O GUARDA DE ABA DEIXOU DE SER SÓ DO TOKEN
 * -------------------------------------------------------------------------
 *
 * `temTokenAberto` protegia uma etapa humana só. A 1.1.8 tirou o prazo da
 * espera pelo clique em "enviar" (ver rpa.js), e uma espera sem prazo passa do
 * `aba_ttl_minutos` (30 min) por definição: sem guarda, `podar()` fecharia a
 * janela com o formulário preenchido dentro — o mesmo defeito que a 1.1.8 veio
 * consertar, só que meia hora depois.
 *
 * Entrou `abaEmUso()`: token na tela OU `aguardandoOperador` (flag posta pelo
 * rpa.js). `podar()` e `descartar()` consultam ela. A aba aguardando operador
 * não tem prazo de graça — o `gracaMs` existe para um token de ~60s que já
 * morreu, mas um formulário preenchido continua válido depois de horas.
 *
 * `fecharTudo()` continua furando tudo, de propósito: restart, atualização e
 * erro fatal fecham mesmo, porque contexto órfão do Chrome é pior.
 */

const { delay, humanType } = require('./humano')

// Identifica a tela de login sem ambiguidade. `input[name="senha"]` não serve:
// existe também como hidden na página do formulário.
const SEL_TELA_LOGIN = 'form[name="entrar"]'

// Presença deste <select> é a prova de que a página do formulário abriu
// autenticada — ele não existe na tela de login.
const SEL_FORMULARIO = 'select[name="operacao"]'

// Funções de que o preenchimento depende. `showDigitado` e `disableBtn` vêm de
// custom/js/show_hide_via.js; as demais são inline na página. O `onblur` da
// carteirinha é `showDigitado(); conferirCampos();` — se `showDigitado` ainda
// não existe, o handler estoura ReferenceError e `conferirCampos` NUNCA roda:
// o robô digita, dá Tab, e a ASSIM não faz nada.
const FUNCOES_DO_FORMULARIO = [
  'conferirCampos', 'showDigitado', 'disableBtn', 'montaCarteira',
  'verificarIntervaloAtendimento', 'validarPresenca', 'abrirModal', 'callLoader',
]

/**
 * Só devolve a página quando o portal está de fato utilizável.
 *
 * `domcontentloaded` chega antes dos scripts externos. Medido em 2026-08-13
 * nesta rede: o formulário e as funções aparecem ~58ms depois do DOM, mas o
 * `readyState` só vira `complete` 390ms depois — e numa máquina de recepção,
 * com rede pior, essa distância é maior. Digitar nesse intervalo é o que
 * produz "preencheu, deu Tab, e o modal de identificação não abriu".
 *
 * O critério é positivo (as funções existem, o jquery-confirm existe), não um
 * tempo fixo: `$.alert` é quem desenha o aviso de identificação, então sem ele
 * a etapa mais importante do fluxo simplesmente não acontece.
 */
async function aguardarPortalPronto(page, timeoutMs = 30000) {
  try {
    await page.waitForFunction((nomes) => {
      if (typeof window.jQuery !== 'function') return false
      if (typeof window.jQuery.alert !== 'function') return false
      return nomes.every(n => typeof window[n] === 'function')
    }, FUNCOES_DO_FORMULARIO, { timeout: timeoutMs })

    // Depois das funções, o resto: imagens e scripts de terceiros. Não é
    // condição de correção, então falha aqui não impede nada.
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {})
  } catch (e) {
    console.warn(
      '⚠️  O portal da ASSIM não terminou de carregar os scripts do formulário. ' +
      'Seguindo assim mesmo — se a identificação do beneficiário não abrir, é por isso.'
    )
  }
}

/**
 * Captura os alertas da ASSIM: registra, mostra na tela e dispensa.
 *
 * O Playwright dispensa `alert()` sozinho e em silêncio. Isso era inofensivo
 * enquanto a recepção não precisava interagir com o portal. Deixou de ser: a
 * validação de presença do beneficiário é feita por ela, e os avisos dessa
 * etapa — "CPF ou Data de Nascimento estão incorretos! Tente novamente!" — são
 * `alert()`. Sem isto, ela erra o CPF e a tela simplesmente não responde.
 *
 * O aviso vira uma tarja na própria página: não bloqueia, some sozinho, e o
 * texto vai junto para o log da fila quando a tarefa termina mal.
 */
function ligarCapturaDeAlertas(page, alertas) {
  page.on('dialog', async (dialogo) => {
    const texto = dialogo.message()
    alertas.push(texto)
    console.log('💬 ASSIM alertou:', texto)

    await dialogo.dismiss().catch(() => {})

    // Só depois de dispensar: com o diálogo aberto a página fica bloqueada.
    await page.evaluate((msg) => {
      const ID = 'robo-aviso-assim'
      document.getElementById(ID)?.remove()

      const tarja = document.createElement('div')
      tarja.id = ID
      tarja.textContent = msg
      Object.assign(tarja.style, {
        position: 'fixed', top: '0', left: '0', right: '0',
        zIndex: '2147483646', background: '#b91c1c', color: '#fff',
        font: '600 15px/1.4 Arial, sans-serif', padding: '14px 18px',
        textAlign: 'center', boxShadow: '0 4px 16px rgba(0,0,0,.35)',
      })
      document.body.appendChild(tarja)

      setTimeout(() => tarja.remove(), 12000)
    }, texto).catch(() => { /* página navegou ou fechou: o log já tem o texto */ })
  })
}

class SessaoAssim {
  constructor(browser) {
    this.browser = browser
    this.cookies = null
    this.logadoEm = null
    /** @type {{ctx: any, page: any, criadoEm: number, filaId: string|null, alertas: any[]}[]} */
    this.abas = []
    // Janela do login, já parada no formulário, esperando ser adotada pela
    // tarefa que provocou o login. Ver item 1 do cabeçalho.
    this.reserva = null
  }

  trocarBrowser(browser) {
    this.browser = browser
    // Browser novo = contextos antigos morreram com ele. A sessão (cookie)
    // continua valendo: ela é do servidor da ASSIM, não do processo local.
    this.abas = []
    this.reserva = null
  }

  // =========================
  // LOGIN
  // =========================

  /**
   * Garante que temos um PHPSESSID autenticado em memória.
   * Faz login só quando não há cookie ou quando `forcar` é pedido (sessão caiu).
   */
  async garantirSessao(cfg, { forcar = false } = {}) {
    if (this.cookies && !forcar) return this.cookies

    console.log(forcar ? '🔑 Sessão da ASSIM caiu — refazendo login...' : '🔑 Fazendo login na ASSIM...')

    // Reserva anterior não adotada (relogin no meio de uma retentativa): fechar,
    // senão vaza um contexto por relogin.
    await this.descartarReserva()

    const ctx = await this.browser.newContext()
    const page = await ctx.newPage()
    const alertas = []

    // valida() usa alert() quando falta campo. Sem capturar, um login recusado
    // viraria espera por uma navegação que nunca acontece. A mesma captura
    // continua valendo depois, porque esta janela vira a aba da tarefa.
    ligarCapturaDeAlertas(page, alertas)

    let deuCerto = false

    try {
      await page.goto(cfg.login_url, { waitUntil: 'domcontentloaded', timeout: 45000 })

      if (await page.locator(SEL_TELA_LOGIN).count() === 0) {
        throw new Error(
          'Tela de login da ASSIM não encontrada (form[name="entrar"] ausente). ' +
          'O portal pode ter mudado outra vez — confira robo_config.assim_login_url.'
        )
      }

      if (!cfg.senha) {
        throw new Error(
          'Senha da ASSIM não veio do servidor. Cadastre-a no Vault: ' +
          'supabase/snippets/robo_provisionar.sql, bloco 1.'
        )
      }

      // O campo "Código" não tem `name` e não é enviado — ele só espelha para o
      // <select> via onkeyup. Preenchemos os dois: o select é o que valida()
      // exige, e o código deixa a tela coerente para quem estiver olhando.
      const campoCodigo = page.locator('form[name="entrar"] input[type="text"]').first()
      if (await campoCodigo.count()) {
        await campoCodigo.fill('')
        await humanType(page, 'form[name="entrar"] input[type="text"]', String(cfg.id_hospital))
      }

      await page.selectOption('select[name="id_hospital"]', String(cfg.id_hospital))
      await humanType(page, 'input[name="senha"]', cfg.senha)

      // O botão é type=button com onclick="valida()", não submit. valida()
      // confere id_hospital e senha e só então chama form.submit().
      await Promise.all([
        page.waitForLoadState('domcontentloaded').catch(() => {}),
        page.locator('form[name="entrar"] input[type="button"]').first().click(),
      ])

      await delay(1500)

      if (alertas.length) {
        throw new Error('ASSIM recusou o login (alert): ' + alertas.join(' | '))
      }

      if (page.url().includes('bloqueio.php')) {
        throw new Error(
          'ASSIM respondeu bloqueio.php no login — o portal considerou que já há ' +
          'outra sessão/aba ativa. Feche as janelas abertas do autorizador e tente de novo.'
        )
      }

      // O login cai em formularionChoiceCard.php, mas SEM os parâmetros da deep
      // link — e sem eles o <select name="operacao"> não existe (medido). Então
      // esta navegação não é só prova de sessão: é ela que monta o formulário.
      await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 45000 })

      if (await page.locator(SEL_FORMULARIO).count() === 0) {
        const aindaNoLogin = await page.locator(SEL_TELA_LOGIN).count() > 0
        throw new Error(
          aindaNoLogin
            ? 'Login não foi aceito: o portal voltou para a tela de senha. Confira a senha no Vault.'
            : `Após o login, a tela do formulário não apareceu (URL: ${page.url()}).`
        )
      }

      await aguardarPortalPronto(page)

      // Só o cookie de sessão. Ver item 2 do cabeçalho: o `cookie[sequencial]`
      // é reemitido pelo portal em cada contexto, e reaproveitar o antigo não
      // ajuda em nada.
      const todos = await ctx.cookies()
      this.cookies = todos.filter(c => c.name === 'PHPSESSID')

      if (this.cookies.length === 0) {
        throw new Error('Login aparentemente OK, mas nenhum PHPSESSID foi emitido.')
      }

      this.logadoEm = Date.now()
      deuCerto = true

      // A janela fica de pé, já no formulário, para a tarefa adotá-la.
      this.reserva = { ctx, page, criadoEm: Date.now(), filaId: null, alertas }

      console.log('✅ Login na ASSIM concluído — sessão guardada em memória')

      return this.cookies

    } finally {
      // Fecha só quando o login FALHOU. No caminho bom a janela é aproveitada.
      if (!deuCerto) await ctx.close().catch(() => {})
    }
  }

  /** Fecha a janela de login que ninguém adotou. */
  async descartarReserva() {
    if (!this.reserva) return
    const r = this.reserva
    this.reserva = null
    await r.ctx.close().catch(() => {})
  }

  // =========================
  // PÁGINA POR TAREFA
  // =========================

  /**
   * Abre uma página já autenticada, no formulário da ASSIM, em contexto próprio.
   * Relogar e repetir é tratado aqui — quem chama recebe uma página pronta.
   */
  async abrirFormulario(cfg) {
    await this.garantirSessao(cfg)

    // Acabamos de logar: a janela do login já está no formulário. Adotar em vez
    // de abrir outra economiza um contexto e acaba com a tela piscando.
    if (this.reserva) {
      const registro = this.reserva
      this.reserva = null
      registro.criadoEm = Date.now()
      this.abas.push(registro)
      return registro
    }

    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      const ctx = await this.browser.newContext()
      await ctx.addCookies(this.cookies)

      const page = await ctx.newPage()

      // Os alertas da ASSIM viajam com a aba. Antes eles só iam para o console e
      // o motivo real da recusa se perdia — a tarefa era gravada como
      // "usuário não clicou em enviar", que era falso.
      const alertas = []
      ligarCapturaDeAlertas(page, alertas)

      try {
        await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 45000 })

        if (page.url().includes('bloqueio.php')) {
          throw Object.assign(new Error('ASSIM respondeu bloqueio.php'), { sessaoRuim: false })
        }

        if (await page.locator(SEL_FORMULARIO).count() > 0) {
          await aguardarPortalPronto(page)
          const registro = { ctx, page, criadoEm: Date.now(), filaId: null, alertas }
          this.abas.push(registro)
          return registro
        }

        // Voltou para a tela de login: o cookie de sessão morreu.
        if (await page.locator(SEL_TELA_LOGIN).count() > 0) {
          throw Object.assign(new Error('Sessão da ASSIM expirou'), { sessaoRuim: true })
        }

        // Nem formulário nem login: dizer QUAL tela veio, senão o diagnóstico
        // vira adivinhação no dia em que a ASSIM mexer no portal outra vez.
        throw Object.assign(
          new Error(
            `A ASSIM abriu uma tela inesperada (URL: ${page.url().slice(0, 120)}, ` +
            `título: "${(await page.title().catch(() => '?')).slice(0, 60)}")`
          ),
          { sessaoRuim: true }
        )

      } catch (erro) {
        await ctx.close().catch(() => {})

        if (tentativa === 2 || !erro.sessaoRuim) throw erro

        await this.garantirSessao(cfg, { forcar: true })

        // O relogin deixou uma reserva pronta: usa ela na segunda tentativa.
        if (this.reserva) {
          const registro = this.reserva
          this.reserva = null
          registro.criadoEm = Date.now()
          this.abas.push(registro)
          return registro
        }
      }
    }
  }

  // =========================
  // POOL DE ABAS
  // =========================

  /**
   * Fecha contextos excedentes e vencidos.
   *
   * As abas são deixadas abertas de propósito, para a recepcionista imprimir a
   * guia. O que não pode é acumular sem limite: cada aba é um processo do
   * Chrome (50–200 MB), e hoje elas nunca são recolhidas.
   *
   * Fecha o CONTEXTO, não só a página — é o contexto que vaza hoje.
   */
  /**
   * A aba tem o modal de token aberto?
   *
   * POR QUE ISTO GOVERNA O FECHAMENTO DE ABA
   * `#checkToken` mostra um token que a ASSIM mandou para o celular do
   * responsável, com contagem de ~60s. Fechar o contexto enquanto ele está na
   * tela queima o token: a operadora só reenvia depois de espera, e quem paga é
   * a recepção com o beneficiário na frente. É o único elemento do portal que
   * bloqueia o housekeeping.
   *
   * Exige o CAMPO visível, não só a caixa: um `#checkToken` que a ASSIM deixou
   * inerte no DOM ainda responde `:visible`, e isso bloquearia a poda para
   * sempre por causa de um modal que ninguém está usando.
   *
   * Falha (página morta, contexto já fechado) responde `false`: travar o
   * housekeeping é pior do que deixar de proteger uma aba que já não existe.
   */
  async temTokenAberto(registro) {
    if (!registro?.page || registro.page.isClosed()) return false

    return registro.page.locator(
      '#checkToken:visible input[type="text"], #checkToken:visible input:not([type])'
    ).first().isVisible({ timeout: 1000 }).catch(() => false)
  }

  /**
   * A aba tem alguém do outro lado no meio de uma etapa?
   *
   * Duas situações, e as duas proíbem o fechamento automático:
   *
   * 1. O modal de token está na tela (acima).
   * 2. `aguardandoOperador` — o robô preencheu o formulário e está parado
   *    esperando a recepcionista clicar em "enviar". A flag é posta e tirada
   *    pelo rpa.js.
   *
   * A (2) existe porque desde a 1.1.8 essa espera NÃO TEM PRAZO, e uma espera
   * sem prazo passa do `aba_ttl_minutos` (30 min) por definição: sem este
   * guarda, a poda fecharia a janela com o formulário preenchido dentro — o
   * mesmo defeito que a 1.1.8 veio consertar, só que meia hora depois.
   */
  async abaEmUso(registro) {
    if (!registro) return false
    if (registro.aguardandoOperador) return true
    return this.temTokenAberto(registro)
  }

  async podar(cfg) {
    const teto = Math.max(1, Number(cfg.max_abas_abertas) || 3)
    const ttlMs = Math.max(1, Number(cfg.aba_ttl_minutos) || 30) * 60000
    const agora = Date.now()

    // Prazo de graça para a aba com token aberto. Não é "nunca fechar": um token
    // de ~60s que está na tela há 4x o TTL morreu de qualquer jeito, e a essa
    // altura proteger a aba só vaza memória na máquina da recepção.
    const gracaMs = ttlMs * 4

    const vencidas = this.abas.filter(a => agora - a.criadoEm > ttlMs)
    const excedentes = this.abas
      .filter(a => !vencidas.includes(a))
      .slice(0, Math.max(0, this.abas.length - vencidas.length - teto))

    let fechadas = 0
    let protegidas = 0

    for (const aba of [...vencidas, ...excedentes]) {
      // A aba parada esperando o clique em "enviar" NÃO tem prazo de graça: o
      // `gracaMs` faz sentido para um token de ~60s que já morreu, mas o
      // formulário preenchido na tela continua válido depois de horas, e quem
      // decide o destino dele é a pessoa. Só `fecharTudo()` a leva.
      if (aba.aguardandoOperador) {
        protegidas++
        continue
      }

      if (agora - aba.criadoEm <= gracaMs && await this.temTokenAberto(aba)) {
        protegidas++
        continue
      }

      await aba.ctx.close().catch(() => {})
      this.abas = this.abas.filter(a => a !== aba)
      fechadas++
    }

    if (fechadas) {
      console.log(
        `🧹 ${fechadas} aba(s) fechada(s) ` +
        `(vencidas: ${vencidas.length}, excedentes: ${excedentes.length}, ` +
        `teto de ${teto}) — restam ${this.abas.length}`
      )
    }

    // Logado sempre que acontece: proteção silenciosa viraria "por que o robô
    // está com 9 abas abertas?" sem resposta.
    if (protegidas) {
      console.log(
        `🔒 ${protegidas} aba(s) mantida(s): token do beneficiário na tela ou ` +
        'envio aguardando a recepção. Só o usuário fecha.'
      )
    }
  }

  /**
   * Descarta uma aba imediatamente (execução que deu errado, nada a imprimir).
   *
   * Com exceções, e elas são o motivo deste comentário: aba EM USO não é
   * fechada — token do beneficiário na tela, ou envio parado esperando a
   * recepção (ver abaEmUso). Uma execução que falhou realmente não tem nada
   * para imprimir, mas nesses dois casos existe alguém do outro lado no meio de
   * uma etapa que não se refaz de graça. A aba perde o vínculo com a tarefa e
   * fica para o usuário.
   *
   * `{ forcar: true }` ignora o guarda — para quem realmente precisa fechar
   * (encerramento do processo, erro fatal).
   */
  async descartar(registro, { forcar = false } = {}) {
    if (!registro) return

    if (!forcar && await this.abaEmUso(registro)) {
      console.warn(
        '🔒 Aba mantida aberta: há uma etapa em andamento na tela (token do ' +
        'beneficiário ou envio aguardando a recepção). Só o usuário fecha.'
      )
      registro.filaId = null
      return
    }

    await registro.ctx.close().catch(() => {})
    this.abas = this.abas.filter(a => a !== registro)
  }

  /**
   * Fecha tudo, inclusive aba com token aberto — de propósito.
   *
   * Só é chamada quando o processo está indo embora (restart pedido pelo painel,
   * atualização aplicada, erro fatal). Ali, deixar contexto órfão do Chrome para
   * trás é pior que perder um token: na próxima subida ninguém sabe que aquela
   * janela existe, e ela fica consumindo memória sem dono. Por isso fecha o
   * contexto direto, sem passar pelo guarda de `descartar()`.
   */
  async fecharTudo() {
    await this.descartarReserva()
    for (const aba of this.abas) {
      await aba.ctx.close().catch(() => {})
    }
    this.abas = []
  }
}

module.exports = { SessaoAssim }
