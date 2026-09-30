/**
 * Cliente mínimo do Microsoft Graph — só GET. O app nem tem permissão de
 * escrita, mas o código também não tem como pedir: não existe método aqui que
 * faça outra coisa além de ler.
 *
 * Duas formas de listar:
 *   delta()        produção. A 1ª chamada devolve a biblioteca inteira; as
 *                  seguintes, só o que mudou desde o `deltaLink` guardado no
 *                  banco (inclusive o que foi apagado).
 *   listarPasta()  homologação. Percorre só a pasta de teste, sem tocar nas
 *                  pastas dos prestadores reais.
 *
 * Todo número que interessa ao painel (chamadas, bytes, tempo) é contado aqui.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0'
const CAMPOS = 'id,name,parentReference,file,folder,deleted,createdDateTime,lastModifiedDateTime,createdBy,lastModifiedBy,webUrl,size,eTag,root'
const TAMANHO_MAX_PLANILHA = 10 * 1024 * 1024
const TENTATIVAS = 5

class ErroGraph extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status }
}

class Graph {
  constructor(obterToken, { fetchImpl = fetch } = {}) {
    this.obterToken = obterToken
    this.fetch = fetchImpl
    this.metricas = { chamadas: 0, bytes: 0, esperas429: 0 }
  }

  async requisitar(url, { binario = false } = {}) {
    const alvo = url.startsWith('http') ? url : GRAPH + url
    let ultimo
    for (let i = 1; i <= TENTATIVAS; i++) {
      const token = await this.obterToken()
      let r
      try {
        this.metricas.chamadas++
        r = await this.fetch(alvo, {
          headers: { Authorization: `Bearer ${token}`, Accept: binario ? '*/*' : 'application/json' },
          signal: AbortSignal.timeout(60000),
        })
      } catch (e) {
        ultimo = new ErroGraph(0, `falha de rede no Graph — ${e.message}`)
        await esperar(1000 * 2 ** (i - 1))
        continue
      }

      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer())
        this.metricas.bytes += buf.length
        return binario ? buf : JSON.parse(buf.toString('utf8'))
      }

      // 429/503/504: o SharePoint pede para esperar e diz quanto (Retry-After).
      // Respeitar é obrigação — insistir antes do prazo só estende o bloqueio.
      if (r.status === 429 || r.status === 503 || r.status === 504) {
        this.metricas.esperas429++
        const s = Number(r.headers.get('retry-after'))
        await esperar(Number.isFinite(s) && s > 0 ? Math.min(s, 120) * 1000 : 2000 * i)
        ultimo = new ErroGraph(r.status, `Graph HTTP ${r.status}`)
        continue
      }

      const corpo = (await r.text().catch(() => '')).slice(0, 300)
      throw new ErroGraph(r.status, `Graph HTTP ${r.status} em ${alvo.replace(GRAPH, '').split('?')[0]} — ${corpo}`)
    }
    throw ultimo
  }

  /** Biblioteca padrão do site ("Documentos Compartilhados") e a pasta raiz dela. */
  async biblioteca(siteId) {
    const drive = await this.requisitar(`/sites/${encodeURIComponent(siteId)}/drive?$select=id,name,webUrl`)
    const raiz = await this.requisitar(`/drives/${drive.id}/root?$select=id,name`)
    return { driveId: drive.id, nome: drive.name, raizId: raiz.id }
  }

  /**
   * @param {string|null} deltaLink  o do banco; null = carga completa
   * @returns {{itens: object[], deltaLink: string, completo: boolean}}
   *
   * 410 Gone = o SharePoint descartou o histórico daquele token. A resposta
   * correta é refazer a carga completa e avisar o banco que ela é completa
   * (quem não vier nela deixou de existir).
   */
  async delta(driveId, deltaLink) {
    let url = deltaLink || `/drives/${driveId}/root/delta?$select=${CAMPOS}`
    let completo = !deltaLink
    const itens = []
    for (;;) {
      let pagina
      try {
        pagina = await this.requisitar(url)
      } catch (e) {
        if (e.status === 410 && !completo) {
          url = `/drives/${driveId}/root/delta?$select=${CAMPOS}`
          completo = true
          itens.length = 0
          continue
        }
        throw e
      }
      itens.push(...(pagina.value ?? []))
      if (pagina['@odata.nextLink']) { url = pagina['@odata.nextLink']; continue }
      if (pagina['@odata.deltaLink']) return { itens, deltaLink: pagina['@odata.deltaLink'], completo }
      throw new ErroGraph(0, 'delta terminou sem deltaLink')
    }
  }

  /** Árvore inteira abaixo de uma pasta (inclui a própria pasta). */
  async listarPasta(driveId, pastaId) {
    const raiz = await this.requisitar(`/drives/${driveId}/items/${pastaId}?$select=${CAMPOS}`)
    const itens = [raiz]
    const fila = [raiz.id]
    while (fila.length) {
      const id = fila.shift()
      let url = `/drives/${driveId}/items/${id}/children?$select=${CAMPOS}&$top=200`
      while (url) {
        const pagina = await this.requisitar(url)
        for (const f of pagina.value ?? []) {
          itens.push(f)
          if (f.folder) fila.push(f.id)
        }
        url = pagina['@odata.nextLink'] ?? null
      }
    }
    return itens
  }

  /** Conteúdo de um arquivo, em memória. Recusa acima de 10 MB. */
  async baixar(driveId, itemId, tamanho) {
    if (tamanho && tamanho > TAMANHO_MAX_PLANILHA) {
      throw new ErroGraph(0, `arquivo grande demais para ser planilha (${tamanho} bytes)`)
    }
    return this.requisitar(`/drives/${driveId}/items/${itemId}/content`, { binario: true })
  }
}

const esperar = (ms) => new Promise(r => setTimeout(r, ms))

module.exports = { Graph, ErroGraph }
