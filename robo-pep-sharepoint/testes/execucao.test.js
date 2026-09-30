const test = require('node:test')
const assert = require('node:assert/strict')
const { executar } = require('../lib/execucao')
const { item, prestador, planilhaBuffer } = require('./fixtures')

const RAIZ = 'RAIZ'

/** Graph falso: devolve o que o teste mandar, conta chamadas como o real. */
function graphFalso({ deltas, arquivos = {} }) {
  let n = 0
  return {
    metricas: { chamadas: 0, bytes: 0, esperas429: 0 },
    pedidos: [],
    async obterToken() { return 'tok' },
    async biblioteca() { this.metricas.chamadas += 2; return { driveId: 'DRIVE', nome: 'Documentos', raizId: RAIZ } },
    async delta(driveId, deltaLink) {
      this.metricas.chamadas++
      this.pedidos.push(deltaLink)
      const d = deltas[Math.min(n++, deltas.length - 1)]
      const r = typeof d === 'function' ? d(deltaLink) : d
      return { itens: r.itens, deltaLink: `link-${n}`, completo: !deltaLink }
    },
    async listarPasta() { throw new Error('não usado') },
    async baixar(driveId, id) { this.metricas.chamadas++; return arquivos[id] },
  }
}

/** Api falsa: guarda o que o banco receberia. */
function apiFalsa(estadoInicial = {}) {
  return {
    metricas: { chamadas: 0, ms: 0, bytesEnviados: 0 },
    etapas: [],
    lotes: [],
    fim: null,
    async iniciarExecucao() { this.metricas.chamadas++; return { execucao_id: 'EXEC', delta_link: null, drive_id: null, pastas: [], ...estadoInicial } },
    async etapa(id, etapa, status) { this.metricas.chamadas++; this.etapas.push(`${etapa}:${status}`) },
    async registrarLote(a) { this.metricas.chamadas++; this.lotes.push(a); return { ms_banco: 12, sugeridos: a.arquivos.length } },
    async finalizarExecucao(id, f) { this.metricas.chamadas++; this.fim = f },
  }
}

test('carga completa: evidências e planilha vão ao banco num lote só', async () => {
  const e = prestador(RAIZ)
  const pac = e.porPaciente['Beltrano Exemplo da Silva']
  const tap = item({ nome: 'TAP-01-092026.pdf', pai: pac.subs[1].id })
  const ignorado = item({ nome: 'aval.pdf', pai: pac.subs[6].id })
  const plan = item({ nome: 'Planejamento Documentos Técnicos - Fulana.xlsx', pai: e.plan.id })
  const buf = await planilhaBuffer({ planejamento: [['Beltrano Exemplo da Silva', '52998224725', 'Plano Individualizado Comportamental (PIC)', 'Mai/2026']] })
  const graph = graphFalso({ deltas: [{ itens: [...e.itens, tap, ignorado, plan] }], arquivos: { [plan.id]: buf } })
  const api = apiFalsa()

  const r = await executar({ graph, api, config: { siteId: 'S', versao: 't' }, gatilho: 'demo' })

  assert.equal(r.status, 'concluido')
  assert.equal(api.lotes.length, 1)
  const lote = api.lotes[0]
  assert.equal(lote.completo, true)
  assert.equal(lote.final, true)
  assert.equal(lote.deltaLink, 'link-1')
  const evid = lote.arquivos.filter(a => a.tipo === 'evidencia')
  assert.deepEqual(evid.map(a => [a.sigla, a.competencia, a.competencia_fonte]), [['TAP', '2026-09', 'nome']])
  // o registro da execução leva TUDO o que foi lido: evidência, ignorado e planilha
  assert.deepEqual(lote.arquivos.map(a => a.tipo).sort(), ['evidencia', 'ignorado', 'planilha'])
  const ign = lote.arquivos.find(a => a.tipo === 'ignorado')
  assert.equal(ign.motivo, 'pasta_fora_do_pep')
  assert.equal(ign.competencia, null)
  const pl = lote.arquivos.find(a => a.tipo === 'planilha')
  assert.equal(pl.detalhe.usada, true)
  assert.equal(pl.detalhe.cnpj_valido, true)
  assert.deepEqual(pl.detalhe.pacientes, [{ nome: 'Beltrano Exemplo da Silva', cpfValido: true, cpfInformado: true }])
  assert.ok(!JSON.stringify(pl.detalhe).includes('52998224725'), 'o detalhe da planilha não leva CPF')
  assert.deepEqual(pl.detalhe.planejamento, [{ paciente: 'Beltrano Exemplo da Silva', documento: 'Plano Individualizado Comportamental (PIC)', sigla: 'PIC', competencia: '2026-05' }])
  // as pastas levam o link para abrir no SharePoint
  assert.ok(lote.pastas.every(x => typeof x.web_url === 'string' && x.web_url.startsWith('https://')))
  assert.equal(lote.planilhas.length, 1)
  assert.equal(lote.planilhas[0].cnpj, '11222333000181')
  assert.ok(lote.arquivosRemovidos.includes(ignorado.id), 'arquivo em pasta 6 sai do PEP')
  assert.equal(lote.pastas.length, e.itens.length)
  const papeis = Object.fromEntries(lote.pastas.filter(p => p.papel).map(p => [p.id, p.papel]))
  assert.equal(papeis[e.prestador.id], 'prestador')
  assert.equal(papeis[pac.pasta.id], 'paciente')
  assert.equal(Object.keys(papeis).length, 2, 'só prestador e paciente têm papel')
  assert.equal(lote.pastas.find(p => p.id === pac.pasta.id).prestador_pasta_id, e.prestador.id)
  // linha do tempo: cada etapa iniciou e concluiu
  for (const et of ['autenticar', 'listar', 'classificar', 'planilhas', 'enviar']) {
    assert.ok(api.etapas.includes(`${et}:iniciada`) && api.etapas.includes(`${et}:concluida`), et)
  }
  assert.equal(api.fim.status, 'concluido')
  assert.equal(api.fim.metricas.ms_banco, 12)
})

test('incremental: usa o deltaLink guardado e a árvore do banco', async () => {
  const e = prestador(RAIZ)
  const pac = e.porPaciente['Beltrano Exemplo da Silva']
  const pastasSalvas = e.itens.map(i => ({ id: i.id, nome: i.name, pai_id: i.parentReference.id }))
  const novo = item({ nome: 'relatorio.pdf', pai: pac.subs[4].id })
  const graph = graphFalso({ deltas: [{ itens: [novo] }] })
  const api = apiFalsa({ delta_link: 'LINK-ANTIGO', drive_id: 'DRIVE', pastas: pastasSalvas })

  await executar({ graph, api, config: { siteId: 'S', versao: 't' }, gatilho: 'agenda' })

  assert.deepEqual(graph.pedidos, ['LINK-ANTIGO'])
  const lote = api.lotes[0]
  assert.equal(lote.completo, false)
  assert.equal(lote.pastas.length, 0, 'nada de pasta nova: não reenvia a árvore')
  assert.equal(lote.arquivos[0].sigla, 'RT')
})

test('forcarCompleta ignora o deltaLink guardado', async () => {
  const e = prestador(RAIZ)
  const pastasSalvas = e.itens.map(i => ({ id: i.id, nome: i.name, pai_id: i.parentReference.id }))
  const graph = graphFalso({ deltas: [{ itens: e.itens }] })
  const api = apiFalsa({ delta_link: 'LINK-ANTIGO', drive_id: 'DRIVE', pastas: pastasSalvas })
  await executar({ graph, api, config: { siteId: 'S', versao: 't', forcarCompleta: true }, gatilho: 'demo' })
  assert.deepEqual(graph.pedidos, [null])
  assert.equal(api.lotes[0].completo, true)
})

test('pasta renomeada força leitura completa', async () => {
  const e = prestador(RAIZ)
  const pastasSalvas = e.itens.map(i => ({ id: i.id, nome: i.name, pai_id: i.parentReference.id }))
  const renomeada = { ...e.pacs, name: '3. Pacientes (ativos)' }
  const graph = graphFalso({ deltas: [{ itens: [renomeada] }, { itens: [...e.itens.filter(i => i.id !== e.pacs.id), renomeada] }] })
  const api = apiFalsa({ delta_link: 'LINK-ANTIGO', drive_id: 'DRIVE', pastas: pastasSalvas })

  await executar({ graph, api, config: { siteId: 'S', versao: 't' }, gatilho: 'agenda' })

  assert.deepEqual(graph.pedidos, ['LINK-ANTIGO', null])
  assert.equal(api.lotes[0].completo, true)
})

test('arquivo apagado no SharePoint vai como removido', async () => {
  const e = prestador(RAIZ)
  const pastasSalvas = e.itens.map(i => ({ id: i.id, nome: i.name, pai_id: i.parentReference.id }))
  const graph = graphFalso({ deltas: [{ itens: [{ id: 'F-APAGADO', deleted: { state: 'deleted' }, parentReference: {} }] }] })
  const api = apiFalsa({ delta_link: 'L', drive_id: 'DRIVE', pastas: pastasSalvas })

  await executar({ graph, api, config: { siteId: 'S', versao: 't' }, gatilho: 'agenda' })
  assert.deepEqual(api.lotes[0].arquivosRemovidos, ['F-APAGADO'])
})

test('mais de 1000 arquivos: partes, e só a última é final', async () => {
  const e = prestador(RAIZ)
  const sub = e.porPaciente['Beltrano Exemplo da Silva'].subs[1]
  const muitos = Array.from({ length: 2300 }, (_, i) => item({ nome: `a${i}.pdf`, pai: sub.id }))
  const graph = graphFalso({ deltas: [{ itens: [...e.itens, ...muitos] }] })
  const api = apiFalsa()

  const r = await executar({ graph, api, config: { siteId: 'S', versao: 't' }, gatilho: 'demo' })
  assert.deepEqual(api.lotes.map(l => [l.arquivos.length, l.final, !!l.deltaLink]), [[1000, false, false], [1000, false, false], [300, true, true]])
  assert.equal(api.lotes[0].pastas.length, e.itens.length)
  assert.equal(api.lotes[1].pastas.length, 0)
  assert.equal(r.metricas.ms_banco, 36)
})

test('simulação vai numa parte só (cada parte simulada é desfeita)', async () => {
  const e = prestador(RAIZ)
  const sub = e.porPaciente['Beltrano Exemplo da Silva'].subs[1]
  const muitos = Array.from({ length: 1500 }, (_, i) => item({ nome: `s${i}.pdf`, pai: sub.id }))
  const graph = graphFalso({ deltas: [{ itens: [...e.itens, ...muitos] }] })
  const api = apiFalsa()
  await executar({ graph, api, config: { siteId: 'S', versao: 't' }, gatilho: 'inventario', simular: true })
  assert.equal(api.lotes.length, 1)
  assert.equal(api.lotes[0].arquivos.length, 1500)
  assert.equal(api.lotes[0].simular, true)
})

test('duas planilhas na mesma pasta: vale a mais recente, a outra fica registrada como não usada', async () => {
  const e = prestador(RAIZ)
  const velha = item({ nome: 'Planejamento antigo.xlsx', pai: e.plan.id, criado: '2026-08-01T12:00:00Z' })
  const nova = item({ nome: 'Planejamento.xlsx', pai: e.plan.id, criado: '2026-09-20T12:00:00Z' })
  const buf = await planilhaBuffer()
  const graph = graphFalso({ deltas: [{ itens: [...e.itens, velha, nova] }], arquivos: { [velha.id]: buf, [nova.id]: buf } })
  const api = apiFalsa()
  await executar({ graph, api, config: { siteId: 'S', versao: 't' }, gatilho: 'demo' })
  const lote = api.lotes[0]
  assert.equal(lote.planilhas.length, 1)
  assert.equal(lote.planilhas[0].sp_id, nova.id)
  const reg = Object.fromEntries(lote.arquivos.filter(a => a.tipo === 'planilha').map(a => [a.sp_id, a.detalhe]))
  assert.equal(reg[nova.id].usada, true)
  assert.ok(reg[nova.id].avisos.includes('varias_planilhas'))
  assert.deepEqual(reg[velha.id], { usada: false, motivo: 'havia_planilha_mais_recente' })
})

test('planilha ilegível não derruba a execução', async () => {
  const e = prestador(RAIZ)
  const plan = item({ nome: 'Planejamento.xlsx', pai: e.plan.id })
  const graph = graphFalso({ deltas: [{ itens: [...e.itens, plan] }], arquivos: { [plan.id]: Buffer.from('não é xlsx') } })
  const api = apiFalsa()
  await executar({ graph, api, config: { siteId: 'S', versao: 't' }, gatilho: 'demo' })
  assert.deepEqual(api.lotes[0].planilhas[0].avisos, ['planilha_ilegivel'])
})

test('sem banco: roda inteira e não chama API', async () => {
  const e = prestador(RAIZ)
  const graph = graphFalso({ deltas: [{ itens: e.itens }] })
  const r = await executar({ graph, api: null, config: { siteId: 'S', versao: 't' }, gatilho: 'demo' })
  assert.equal(r.status, 'concluido')
  assert.equal(r.execucaoId, null)
})

test('falha no Graph: execução fecha como erro, com a etapa marcada', async () => {
  const graph = graphFalso({ deltas: [() => { throw new Error('Graph HTTP 403') }] })
  const api = apiFalsa()
  await assert.rejects(executar({ graph, api, config: { siteId: 'S', versao: 't' }, gatilho: 'agenda' }), /403/)
  assert.ok(api.etapas.includes('listar:erro'))
  assert.equal(api.fim.status, 'erro')
})
