/**
 * Uma execução do robô, do começo ao fim. As etapas são as mesmas que o
 * painel /admin/robo-sharepoint desenha na linha do tempo:
 *
 *   autenticar → listar → classificar → planilhas → enviar
 *
 * `api` é opcional: sem ela (demo --sem-banco) a execução roda inteira, só
 * não grava nada — útil para ver o robô agindo antes da migration existir.
 *
 * O que sai para log/terminal é CONTAGEM. Nome de paciente e CPF só viajam
 * no corpo do lote para o banco, que é quem precisa deles para reconhecer.
 */

const { classificarArquivo, classificarPasta, competenciaDoArquivo, pastasDePrestador } = require('./mapeamento')
const { lerPlanilhaPlanejamento } = require('./planilha')

const TAMANHO_LOTE = 1000
const PAUSA_ENTRE_PARTES_MS = 300
const ETAPAS = ['autenticar', 'listar', 'classificar', 'planilhas', 'enviar']

/** Nó da árvore a partir de um driveItem do Graph. */
function noDoItem(item) {
  return { id: item.id, nome: item.name, paiId: item.parentReference?.id ?? null, pasta: !!item.folder }
}

function montarArvore(pastasSalvas) {
  const arvore = new Map()
  for (const p of pastasSalvas ?? []) arvore.set(p.id, { id: p.id, nome: p.nome, paiId: p.pai_id, pasta: true })
  return arvore
}

/**
 * Aplica o delta na árvore guardada. Devolve `reestruturou=true` quando uma
 * pasta que já existia foi renomeada ou movida: aí os arquivos dentro dela
 * mudaram de caminho sem aparecer no delta, e a única leitura honesta é a
 * completa.
 */
function aplicarDelta(arvore, itens) {
  let reestruturou = false
  const pastasMudadas = []
  const pastasRemovidas = []
  const arquivos = []
  const arquivosRemovidos = []

  for (const item of itens) {
    if (item.root) continue
    if (item.deleted) {
      if (arvore.has(item.id)) { arvore.delete(item.id); pastasRemovidas.push(item.id) }
      else arquivosRemovidos.push(item.id)
      continue
    }
    if (item.folder) {
      const antes = arvore.get(item.id)
      const no = noDoItem(item)
      if (antes && (antes.nome !== no.nome || antes.paiId !== no.paiId)) reestruturou = true
      if (!antes || antes.nome !== no.nome || antes.paiId !== no.paiId) pastasMudadas.push(no)
      arvore.set(item.id, no)
    } else if (item.file) {
      arquivos.push(item)
    }
  }
  return { reestruturou, pastasMudadas, pastasRemovidas, arquivos, arquivosRemovidos }
}

async function cronometrar(nome, contexto, fn) {
  const { api, execucaoId, observador } = contexto
  observador?.etapaIniciada?.(nome)
  if (api && execucaoId) await api.etapa(execucaoId, nome, 'iniciada')
  const t0 = Date.now()
  try {
    const { resultado, detalhe } = await fn()
    const ms = Date.now() - t0
    contexto.etapas.push({ etapa: nome, status: 'concluida', duracao_ms: ms, detalhe })
    observador?.etapaConcluida?.(nome, ms, detalhe)
    if (api && execucaoId) await api.etapa(execucaoId, nome, 'concluida', ms, detalhe)
    return resultado
  } catch (e) {
    const ms = Date.now() - t0
    contexto.etapas.push({ etapa: nome, status: 'erro', duracao_ms: ms, detalhe: { erro: e.message } })
    observador?.etapaFalhou?.(nome, ms, e)
    if (api && execucaoId) await api.etapa(execucaoId, nome, 'erro', ms, { erro: e.message.slice(0, 300) })
    throw e
  }
}

/**
 * @param {object} p
 * @param {import('./graph').Graph} p.graph
 * @param {import('./api').Api|null} p.api
 * @param {{siteId:string, somentePastaId?:string|null, versao:string, credencial?:object}} p.config
 * @param {'agenda'|'manual'|'demo'|'inventario'} p.gatilho
 * @param {boolean} [p.simular]  resolve tudo no banco e devolve as contagens sem gravar
 * @param {object} [p.observador]
 */
async function executar({ graph, api, config, gatilho, simular = false, observador = null, solicitadoPorNome = null }) {
  const inicio = Date.now()
  const modo = simular ? 'simulacao' : (config.somentePastaId ? 'homologacao' : 'producao')
  const ctx = { api, execucaoId: null, observador, etapas: [] }

  const estado = api
    ? await api.iniciarExecucao({
      gatilho, modo, versao: config.versao, escopoPastaId: config.somentePastaId,
      credencial: config.credencial ?? null, solicitadoPorNome,
    })
    : { execucao_id: null, delta_link: null, drive_id: null, pastas: [] }
  ctx.execucaoId = estado?.execucao_id ?? null
  observador?.inicio?.({ execucaoId: ctx.execucaoId, modo, gatilho })

  const contagens = {}
  let resultadoLote = null

  try {
    await cronometrar('autenticar', ctx, async () => {
      await graph.obterToken()
      return { detalhe: { certificado_dias_restantes: config.credencial?.diasRestantes ?? null } }
    })

    const listagem = await cronometrar('listar', ctx, async () => {
      const bib = await graph.biblioteca(config.siteId)
      let arvore
      let itens
      let deltaLink = null
      let completo

      if (config.somentePastaId) {
        // Homologação: só a pasta de teste; a árvore começa vazia e o estado
        // do delta de produção não é tocado.
        arvore = new Map()
        itens = await graph.listarPasta(bib.driveId, config.somentePastaId)
        completo = true
      } else {
        const mesmoDrive = estado?.drive_id && estado.drive_id === bib.driveId
        arvore = mesmoDrive ? montarArvore(estado.pastas) : new Map()
        const d = await graph.delta(bib.driveId, mesmoDrive ? estado.delta_link : null)
        itens = d.itens; deltaLink = d.deltaLink; completo = d.completo
        if (d.completo) arvore = new Map()
      }

      let aplicado = aplicarDelta(arvore, itens)
      if (aplicado.reestruturou && !completo) {
        observador?.evento?.('pasta renomeada ou movida — refazendo a leitura completa')
        arvore = new Map()
        const d = await graph.delta(bib.driveId, null)
        itens = d.itens; deltaLink = d.deltaLink; completo = true
        aplicado = aplicarDelta(arvore, itens)
      }

      const pastas = completo ? [...arvore.values()] : aplicado.pastasMudadas
      return {
        resultado: { bib, arvore, deltaLink, completo, ...aplicado, pastas },
        detalhe: {
          leitura: completo ? 'completa' : 'somente_mudancas',
          itens_recebidos: itens.length,
          pastas: arvore.size,
          arquivos_novos_ou_alterados: aplicado.arquivos.length,
          removidos: aplicado.arquivosRemovidos.length + aplicado.pastasRemovidas.length,
          chamadas_graph: graph.metricas.chamadas,
        },
      }
    })

    const { bib, arvore } = listagem
    // Na homologação a raiz da biblioteca não entra na listagem; a pasta de
    // teste fica pendurada nela, então o caminho sobe até `bib.raizId`.
    const classificados = await cronometrar('classificar', ctx, async () => {
      // O arquivo entra na árvore só durante a classificação (o caminho sobe a
      // partir dele); a árvore guardada no banco é só de pastas.
      for (const a of listagem.arquivos) arvore.set(a.id, noDoItem(a))
      const lista = listagem.arquivos.map(a => ({ item: a, c: classificarArquivo(arvore, bib.raizId, { id: a.id, nome: a.name }) }))
      for (const a of listagem.arquivos) arvore.delete(a.id)
      const porTipo = {}
      for (const { c } of lista) porTipo[c.tipo] = (porTipo[c.tipo] ?? 0) + 1
      Object.assign(contagens, { por_tipo: porTipo })
      const prestadores = pastasDePrestador(arvore, bib.raizId)
      return {
        resultado: lista,
        detalhe: {
          evidencias: porTipo.evidencia ?? 0,
          planilhas: porTipo.planilha ?? 0,
          ignorados: porTipo.ignorado ?? 0,
          fora_padrao: porTipo.fora_padrao ?? 0,
          pastas_prestador: prestadores.length,
          pastas_prestador_fora_padrao: prestadores.filter(p => !p.padrao).length,
        },
      }
    })

    const planilhas = await cronometrar('planilhas', ctx, async () => {
      // Uma planilha por prestador: se houver mais de uma na pasta, vale a
      // modificada por último, e o banco recebe o aviso.
      const porPrestador = new Map()
      for (const { item, c } of classificados) {
        if (c.tipo !== 'planilha') continue
        const atual = porPrestador.get(c.prestadorPastaId)
        const ts = Date.parse(item.lastModifiedDateTime ?? 0)
        if (!atual || ts > atual.ts) porPrestador.set(c.prestadorPastaId, { item, c, ts, varias: !!atual })
        else atual.varias = true
      }
      const saida = []
      let falhas = 0
      for (const { item, c, varias } of porPrestador.values()) {
        const base = {
          prestador_pasta_id: c.prestadorPastaId, sp_id: item.id, nome: item.name,
          web_url: item.webUrl ?? null, modificado_em: item.lastModifiedDateTime ?? null,
        }
        try {
          const buf = await graph.baixar(bib.driveId, item.id, item.size)
          const lida = await lerPlanilhaPlanejamento(buf)
          if (varias) lida.avisos.push('varias_planilhas')
          saida.push({
            ...base, razao_social: lida.razaoSocial, cnpj: lida.cnpj, cnpj_informado: lida.cnpjInformado,
            pacientes: lida.pacientes, planejamento: lida.planejamento, avisos: lida.avisos,
          })
        } catch (e) {
          falhas++
          saida.push({ ...base, pacientes: [], planejamento: [], avisos: ['planilha_ilegivel'], erro: e.message.slice(0, 200) })
        }
      }
      return {
        resultado: saida,
        detalhe: {
          lidas: saida.length - falhas,
          ilegiveis: falhas,
          pacientes_nas_planilhas: saida.reduce((s, p) => s + p.pacientes.length, 0),
          cpfs_invalidos: saida.reduce((s, p) => s + p.pacientes.filter(x => x.cpfInformado && !x.cpfValido).length, 0),
          cnpjs_invalidos: saida.filter(p => p.avisos?.includes('cnpj_invalido') || p.avisos?.includes('cnpj_ausente')).length,
        },
      }
    })

    resultadoLote = await cronometrar('enviar', ctx, async () => {
      const arquivos = classificados
        .filter(({ c }) => c.tipo === 'evidencia' || c.tipo === 'fora_padrao')
        .map(({ item, c }) => {
          const comp = competenciaDoArquivo(item.name, item.createdDateTime)
          return {
            sp_id: item.id,
            nome: item.name,
            caminho: c.caminho ?? null,
            web_url: item.webUrl ?? null,
            tamanho: item.size ?? null,
            e_tag: item.eTag ?? null,
            criado_em: item.createdDateTime ?? null,
            modificado_em: item.lastModifiedDateTime ?? null,
            criado_por: item.createdBy?.user?.displayName ?? null,
            modificado_por: item.lastModifiedBy?.user?.displayName ?? null,
            tipo: c.tipo,
            motivo: c.motivo ?? null,
            prestador_pasta_id: c.prestadorPastaId ?? null,
            paciente_pasta_id: c.pacientePastaId ?? null,
            sigla: c.sigla ?? null,
            competencia: comp.competencia,
            competencia_fonte: comp.fonte,
          }
        })
      // Arquivo que deixou de ser evidência (movido para a pasta 6/7, por
      // exemplo) conta como removido do ponto de vista do PEP.
      const deixaram = classificados.filter(({ c }) => c.tipo === 'ignorado' || c.tipo === 'planilha').map(({ item }) => item.id)
      const pastas = listagem.pastas.map(p => {
        const papel = classificarPasta(arvore, bib.raizId, p.id)
        return { id: p.id, nome: p.nome, pai_id: p.paiId, papel: papel.papel, prestador_pasta_id: papel.prestadorPastaId ?? null }
      })

      if (!api) {
        return {
          resultado: null,
          detalhe: { sem_banco: true, arquivos: arquivos.length, planilhas: planilhas.length, pastas: pastas.length },
        }
      }

      // Partes de até 1000 arquivos. A 1ª leva pastas e planilhas; a última
      // leva o deltaLink e `final`, que é quando o banco marca o que sumiu e
      // reconhece tudo. Entre uma parte e outra, uma pausa curta: o banco
      // atende os usuários no intervalo em vez de receber tudo de enfiada.
      //
      // Simulação vai numa parte só: cada parte simulada é desfeita ao fim da
      // chamada, então a última não enxergaria as anteriores.
      const tamanho = simular ? Math.max(arquivos.length, 1) : TAMANHO_LOTE
      const partes = []
      for (let i = 0; i < Math.max(arquivos.length, 1); i += tamanho) partes.push(arquivos.slice(i, i + tamanho))
      let r = null
      const somatorio = { ms_banco: 0 }
      for (let i = 0; i < partes.length; i++) {
        const primeira = i === 0
        const ultima = i === partes.length - 1
        if (!primeira) await new Promise(res => setTimeout(res, PAUSA_ENTRE_PARTES_MS))
        r = await api.registrarLote({
          execucaoId: ctx.execucaoId,
          driveId: bib.driveId,
          deltaLink: ultima ? listagem.deltaLink : null,
          completo: listagem.completo,
          final: ultima,
          pastas: primeira ? pastas : [],
          pastasRemovidas: primeira ? listagem.pastasRemovidas : [],
          arquivos: partes[i],
          arquivosRemovidos: primeira ? [...listagem.arquivosRemovidos, ...deixaram] : [],
          planilhas: primeira ? planilhas : [],
          simular,
        })
        somatorio.ms_banco += Number(r?.ms_banco ?? 0)
      }
      const total = { ...(r ?? {}), ms_banco: somatorio.ms_banco, partes: partes.length }
      return { resultado: total, detalhe: total }
    })

    const metricas = resumoMetricas({ inicio, graph, api, contagens, resultadoLote, etapas: ctx.etapas })
    if (api && ctx.execucaoId) await api.finalizarExecucao(ctx.execucaoId, { status: 'concluido', metricas })
    observador?.fim?.(metricas)
    return { execucaoId: ctx.execucaoId, status: 'concluido', metricas, etapas: ctx.etapas, resultadoLote }
  } catch (e) {
    const metricas = resumoMetricas({ inicio, graph, api, contagens, resultadoLote, etapas: ctx.etapas })
    if (api && ctx.execucaoId) {
      await api.finalizarExecucao(ctx.execucaoId, { status: 'erro', erro: e.message, metricas }).catch(() => {})
    }
    observador?.fim?.(metricas, e)
    throw e
  }
}

function resumoMetricas({ inicio, graph, api, contagens, resultadoLote, etapas }) {
  return {
    duracao_ms: Date.now() - inicio,
    etapas_ms: Object.fromEntries(etapas.map(e => [e.etapa, e.duracao_ms])),
    chamadas_graph: graph.metricas.chamadas,
    bytes_graph: graph.metricas.bytes,
    esperas_graph: graph.metricas.esperas429,
    chamadas_banco: api?.metricas.chamadas ?? 0,
    ms_rede_banco: api?.metricas.ms ?? 0,
    ms_maior_chamada_banco: api?.metricas.msMaximo ?? 0,
    bytes_enviados_banco: api?.metricas.bytesEnviados ?? 0,
    ms_banco: resultadoLote?.ms_banco ?? null,
    ...contagens,
  }
}

module.exports = { executar, aplicarDelta, montarArvore, ETAPAS }
