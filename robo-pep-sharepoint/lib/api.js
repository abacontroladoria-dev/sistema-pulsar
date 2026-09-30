/**
 * Único ponto de contato com o Pulsar. Quatro RPCs `robo_pep_*`, nada de
 * acesso direto a tabela e nada de `service_role`.
 *
 * Mesmo desenho do robo-autorizador/api.js: a anon key (pública, já está no
 * bundle do frontend) vai no header; quem autoriza de fato é o token desta
 * máquina, no CORPO do POST — corpo não entra em log de acesso. O token é
 * validado no banco por hash (`robo_autenticar`) e pode ser revogado sozinho.
 *
 * Cada chamada é cronometrada: o painel mostra quantas foram e quanto tempo o
 * banco gastou, que é a prova de que o robô não pesa no Pulsar.
 */

const TENTATIVAS_MAX = 4

function erroFatal(mensagem) {
  return Object.assign(new Error(mensagem), { fatal: true })
}

class Api {
  constructor(url, anon, token, { fetchImpl = fetch } = {}) {
    if (!url) throw erroFatal('SUPABASE_URL não definida')
    if (!anon) throw erroFatal('SUPABASE_ANON_KEY não definida')
    if (!token) throw erroFatal('MACHINE_TOKEN não definido')
    this.base = url.replace(/\/+$/, '') + '/rest/v1/rpc/'
    this.anon = anon
    this.token = token
    this.fetch = fetchImpl
    // msMaximo = a chamada mais demorada da execução. É o número que responde
    // "o robô segurou o banco por quanto tempo, no pior momento?".
    this.metricas = { chamadas: 0, ms: 0, msMaximo: 0, bytesEnviados: 0 }
  }

  async chamar(funcao, argumentos = {}, { tentativas = TENTATIVAS_MAX, timeoutMs = 30000 } = {}) {
    const corpo = JSON.stringify({ p_token: this.token, ...argumentos })
    let ultimoErro
    for (let i = 1; i <= tentativas; i++) {
      const t0 = Date.now()
      let resposta
      try {
        this.metricas.chamadas++
        this.metricas.bytesEnviados += corpo.length
        resposta = await this.fetch(this.base + funcao, {
          method: 'POST',
          // A anon legada é um JWT e vai também no Authorization, como nos
          // outros robôs. A chave nova (sb_publishable_…) não é JWT: só apikey.
          headers: {
            apikey: this.anon,
            ...(this.anon.startsWith('eyJ') ? { Authorization: 'Bearer ' + this.anon } : {}),
            'Content-Type': 'application/json',
          },
          body: corpo,
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (e) {
        this.metricas.ms += Date.now() - t0
        ultimoErro = new Error(`${funcao}: falha de rede — ${e.message}`)
        await esperar(i)
        continue
      }
      const gasto = Date.now() - t0
      this.metricas.ms += gasto
      this.metricas.msMaximo = Math.max(this.metricas.msMaximo, gasto)

      if (resposta.ok) {
        const texto = await resposta.text()
        return texto ? JSON.parse(texto) : null
      }
      const detalhe = (await resposta.text().catch(() => '')).slice(0, 300)
      if (resposta.status < 500) {
        if (/token invalido/i.test(detalhe)) {
          throw erroFatal(`Token da máquina recusado (${funcao}). Revogado ou trocado? Gere outro com supabase/snippets/*_cadastrar_maquina_robo_pep.sql`)
        }
        throw new Error(`${funcao}: HTTP ${resposta.status} — ${detalhe}`)
      }
      ultimoErro = new Error(`${funcao}: HTTP ${resposta.status} — ${detalhe}`)
      // Tempo-limite do banco (57014): repetir só repetiria a carga. Falha na
      // hora, e a execução fica registrada como erro para alguém olhar.
      if (/57014|statement timeout/i.test(detalhe)) throw ultimoErro
      await esperar(i)
    }
    throw ultimoErro
  }

  /** Abre a execução e devolve o estado guardado (deltaLink e árvore de pastas). */
  iniciarExecucao({ gatilho, modo, versao, escopoPastaId, credencial, solicitadoPorNome }) {
    return this.chamar('robo_pep_iniciar_execucao', {
      p_gatilho: gatilho,
      p_modo: modo,
      p_versao: versao,
      p_escopo_pasta_id: escopoPastaId ?? null,
      p_certificado: credencial ?? null,
      p_solicitado_por_nome: solicitadoPorNome ?? null,
    })
  }

  /**
   * Uma etapa da linha do tempo do painel. Best-effort: se falhar, o robô
   * segue — perder um marco visual não justifica abortar a leitura.
   */
  async etapa(execucaoId, etapa, status, duracaoMs = null, detalhe = null) {
    try {
      await this.chamar('robo_pep_registrar_etapa', {
        p_execucao_id: execucaoId, p_etapa: etapa, p_status: status,
        p_duracao_ms: duracaoMs, p_detalhe: detalhe,
      }, { tentativas: 1, timeoutMs: 8000 })
    } catch (e) {
      console.error(`⚠️  etapa "${etapa}" não registrada: ${e.message}`)
    }
  }

  /** O lote. `final=true` na última parte: é quando o banco marca o que sumiu. */
  registrarLote(args) {
    return this.chamar('robo_pep_registrar_lote', {
      p_execucao_id: args.execucaoId,
      p_drive_id: args.driveId ?? null,
      p_delta_link: args.deltaLink ?? null,
      p_completo: !!args.completo,
      p_final: !!args.final,
      p_pastas: args.pastas ?? [],
      p_pastas_removidas: args.pastasRemovidas ?? [],
      p_arquivos: args.arquivos ?? [],
      p_arquivos_removidos: args.arquivosRemovidos ?? [],
      p_planilhas: args.planilhas ?? [],
      p_simular: !!args.simular,
    }, { timeoutMs: 60000 })
  }

  finalizarExecucao(execucaoId, { status, erro, metricas }) {
    return this.chamar('robo_pep_finalizar_execucao', {
      p_execucao_id: execucaoId, p_status: status,
      p_erro: erro ? String(erro).slice(0, 1000) : null,
      p_metricas: metricas ?? {},
    })
  }
}

const esperar = (tentativa) => new Promise(r => setTimeout(r, Math.min(1000 * 2 ** (tentativa - 1), 8000)))

module.exports = { Api }
