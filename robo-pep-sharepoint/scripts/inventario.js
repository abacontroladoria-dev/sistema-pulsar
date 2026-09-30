/**
 * Inventário só de leitura (etapa 1 do plano).
 *
 *   node --env-file=C:\Users\Maquina001\.pulsar-sharepoint\robo.env scripts/inventario.js [--sem-banco]
 *
 * Lê o site inteiro, classifica, lê as planilhas e — se o banco estiver
 * ligado — pede ao Pulsar para reconhecer tudo em modo SIMULAÇÃO (nada é
 * gravado além do registro da execução). Escreve um relatório AGREGADO:
 * contagens e percentuais, nenhum nome, nenhum CPF, nenhum caminho.
 *
 * Só rodar depois do termo de confidencialidade (condição do administrador).
 */

const fs = require('fs')
const path = require('path')
const { carregarConfig } = require('../lib/config')
const { criarAutenticador } = require('../lib/auth')
const { Graph } = require('../lib/graph')
const { Api } = require('../lib/api')
const { executar } = require('../lib/execucao')

const semBanco = process.argv.includes('--sem-banco')
const SAIDA = path.join(__dirname, '..', '..', 'docs', 'INVENTARIO_SHAREPOINT_PEP.md')

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '—')
const seg = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)} s`)

function tabela(obj, rotuloChave, rotuloValor) {
  const linhas = Object.entries(obj ?? {}).sort((a, b) => b[1] - a[1])
  if (!linhas.length) return '_nenhum_\n'
  return `| ${rotuloChave} | ${rotuloValor} |\n|---|---|\n` + linhas.map(([k, v]) => `| \`${k}\` | ${v} |`).join('\n') + '\n'
}

;(async () => {
  const config = carregarConfig()
  if (config.somentePastaId) throw new Error('Inventário lê o site inteiro: remova SHAREPOINT_SOMENTE_PASTA')
  const auth = criarAutenticador(config)
  const graph = new Graph(() => auth.obterToken())
  const api = semBanco ? null : new Api(config.supabaseUrl, config.supabaseAnon, config.machineToken)

  const r = await executar({
    graph, api, config: { ...config, credencial: auth.credencial }, gatilho: 'inventario', simular: true,
    observador: { etapaConcluida: (n, ms) => console.log(`✔ ${n} ${seg(ms)}`) },
  })

  const det = Object.fromEntries(r.etapas.map(e => [e.etapa, e.detalhe ?? {}]))
  const c = det.classificar ?? {}
  const p = det.planilhas ?? {}
  const l = det.listar ?? {}
  const b = r.resultadoLote ?? {}

  const md = `# Inventário do SharePoint → PEP

Gerado em ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC pelo \`robo-pep-sharepoint/scripts/inventario.js\` (só leitura${semBanco ? ', sem cruzar com o Pulsar' : ', cruzamento com o Pulsar em modo simulação'}).
Relatório agregado: não contém nome, CPF nem caminho de nenhum paciente ou prestador.

## Estrutura

| Medida | Valor |
|---|---|
| Pastas no site | ${l.pastas ?? '—'} |
| Pastas de prestador | ${c.pastas_prestador ?? '—'} |
| Pastas de prestador fora do padrão de nome | ${c.pastas_prestador_fora_padrao ?? '—'} |
| Arquivos de evidência (em pasta de item do PEP) | ${c.evidencias ?? 0} |
| Planilhas de planejamento | ${c.planilhas ?? 0} |
| Arquivos ignorados (pastas 6/7, soltos) | ${c.ignorados ?? 0} |
| Arquivos fora do padrão | ${c.fora_padrao ?? 0} |

## Planilhas de planejamento

| Medida | Valor |
|---|---|
| Lidas | ${p.lidas ?? 0} |
| Ilegíveis | ${p.ilegiveis ?? 0} |
| Com CNPJ ausente ou inválido | ${p.cnpjs_invalidos ?? 0} |
| Pacientes listados nas abas "Pacientes" | ${p.pacientes_nas_planilhas ?? 0} |
| CPFs com dígito verificador inválido | ${p.cpfs_invalidos ?? 0} (${pct(p.cpfs_invalidos ?? 0, p.pacientes_nas_planilhas ?? 0)}) |

${semBanco ? '' : `## Cruzamento com o Pulsar (simulação)

| Medida | Valor |
|---|---|
| Prestadores reconhecidos pelo CNPJ | ${b.prestadores_reconhecidos ?? '—'} de ${b.prestadores_total ?? '—'} (${pct(b.prestadores_reconhecidos ?? 0, b.prestadores_total ?? 0)}) |
| Pastas de paciente reconhecidas (3 sinais) | ${b.pacientes_reconhecidos ?? '—'} de ${b.pacientes_total ?? '—'} (${pct(b.pacientes_reconhecidos ?? 0, b.pacientes_total ?? 0)}) |
| Evidências que virariam sugestão | ${b.sugeridos ?? '—'} |
| Evidências que iriam para "não reconheci" | ${b.nao_reconhecidos ?? '—'} |

### Motivos de não reconhecimento

${tabela(b.motivos, 'Motivo', 'Quantidade')}
`}
## Tempo e custo desta leitura

| Etapa | Tempo |
|---|---|
${r.etapas.map(e => `| ${e.etapa} | ${seg(e.duracao_ms)} |`).join('\n')}
| **Total** | **${seg(r.metricas.duracao_ms)}** |

- Microsoft Graph: ${r.metricas.chamadas_graph} chamadas, ${(r.metricas.bytes_graph / 1024).toFixed(0)} KB, ${r.metricas.esperas_graph} esperas por limite.
- Pulsar: ${r.metricas.chamadas_banco} chamadas, ${r.metricas.ms_banco ?? '—'} ms dentro do banco.
- Esta é a leitura COMPLETA (pior caso). As execuções agendadas leem só o que mudou.
`
  fs.writeFileSync(SAIDA, md)
  console.log(`\nRelatório: ${SAIDA}`)
})().catch(e => { console.error('✖', e.message); process.exitCode = 1 })
