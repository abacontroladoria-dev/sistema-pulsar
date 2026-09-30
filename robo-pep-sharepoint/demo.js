/**
 * Modo demonstração: uma execução, no terminal, etapa por etapa, com cronômetro.
 *
 *   node --env-file=C:\Users\Maquina001\.pulsar-sharepoint\robo.env demo.js [opções]
 *
 *   --sem-banco   lê o SharePoint e classifica, mas não fala com o Pulsar
 *                 (serve antes de a migration estar aplicada)
 *   --completa    relê o site inteiro, ignorando o "só o que mudou"
 *   --simular     manda ao banco, que reconhece tudo e devolve as contagens
 *                 SEM gravar sugestões (é o que o inventário usa)
 *
 * Com o banco ligado, a mesma execução aparece ao vivo em /admin/robo-sharepoint.
 *
 * Só contagens na tela. Nome e CPF não são impressos — nem em homologação,
 * para o hábito ser o mesmo nos dois modos.
 */

const { carregarConfig } = require('./lib/config')
const { criarAutenticador } = require('./lib/auth')
const { Graph } = require('./lib/graph')
const { Api } = require('./lib/api')
const { executar } = require('./lib/execucao')

const args = new Set(process.argv.slice(2))
const semBanco = args.has('--sem-banco')
const simular = args.has('--simular')
const completa = args.has('--completa')

const cor = (c, s) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s)
const verde = s => cor(32, s)
const vermelho = s => cor(31, s)
const cinza = s => cor(90, s)
const negrito = s => cor(1, s)

const NOMES = {
  autenticar: 'Autenticar no Microsoft (certificado)',
  listar: 'Listar o SharePoint',
  classificar: 'Classificar pastas e arquivos',
  planilhas: 'Ler planilhas de planejamento',
  enviar: semBanco ? 'Enviar ao Pulsar (desligado: --sem-banco)' : 'Enviar ao Pulsar e reconhecer',
}

let relogio = null
const observador = {
  inicio({ execucaoId, modo, gatilho }) {
    console.log(negrito(`\nRobô SharePoint → PEP`) + cinza(`  modo ${modo} · gatilho ${gatilho}${execucaoId ? ` · execução ${execucaoId.slice(0, 8)}` : ''}`))
    console.log(cinza('─'.repeat(64)))
  },
  etapaIniciada(nome) {
    const t0 = Date.now()
    process.stdout.write(`  ⏳ ${NOMES[nome] ?? nome}`)
    if (process.stdout.isTTY) {
      relogio = setInterval(() => {
        process.stdout.write(`\r  ⏳ ${NOMES[nome] ?? nome} ${cinza(((Date.now() - t0) / 1000).toFixed(1) + ' s')}`)
      }, 100)
    }
  },
  etapaConcluida(nome, ms, detalhe) {
    clearInterval(relogio)
    process.stdout.write(`\r  ${verde('✔')} ${(NOMES[nome] ?? nome).padEnd(46)} ${negrito((ms / 1000).toFixed(2).padStart(6) + ' s')}\n`)
    if (detalhe) {
      const partes = Object.entries(detalhe).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
      if (partes.length) console.log(cinza(`      ${partes.join(' · ')}`))
    }
  },
  etapaFalhou(nome, ms, e) {
    clearInterval(relogio)
    process.stdout.write(`\r  ${vermelho('✖')} ${(NOMES[nome] ?? nome).padEnd(46)} ${(ms / 1000).toFixed(2).padStart(6)} s\n`)
    console.log(vermelho(`      ${e.message}`))
  },
  evento(texto) { console.log(cinza(`      • ${texto}`)) },
  fim(m, erro) {
    console.log(cinza('─'.repeat(64)))
    console.log(`  ${erro ? vermelho('Falhou') : verde('Concluído')} em ${negrito((m.duracao_ms / 1000).toFixed(2) + ' s')}`)
    console.log(cinza(`  Microsoft Graph: ${m.chamadas_graph} chamadas, ${(m.bytes_graph / 1024).toFixed(0)} KB`))
    console.log(cinza(`  Pulsar: ${m.chamadas_banco} chamadas, ${m.ms_banco ?? '—'} ms dentro do banco, ${m.ms_rede_banco} ms de ida e volta`))
  },
}

;(async () => {
  const config = carregarConfig()
  const auth = criarAutenticador(config)
  const graph = new Graph(() => auth.obterToken())
  const api = semBanco ? null : new Api(config.supabaseUrl, config.supabaseAnon, config.machineToken)
  console.log(cinza(`certificado "${auth.credencial.assunto}" · vence em ${auth.credencial.diasRestantes} dias`))
  try {
    await executar({ graph, api, config: { ...config, credencial: auth.credencial, forcarCompleta: completa }, gatilho: 'demo', simular, observador })
  } catch {
    process.exitCode = 1
  }
})().catch(e => { console.error(vermelho(e.message)); process.exitCode = 1 })
