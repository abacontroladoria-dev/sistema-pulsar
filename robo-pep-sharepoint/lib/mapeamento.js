/**
 * Do caminho no SharePoint para o que ele significa no PEP.
 *
 * A estrutura foi montada pelo administrador do site (30/09/2026):
 *
 *   Prestador de Serviço - <Nome> (<RAZÃO SOCIAL>)
 *   ├── 1. Planejamento - Prestador de Serviço   → planilha .xlsx
 *   ├── 2. Geral
 *   │   ├── 1. Supervisão Técnica ABA do Caso    → STC
 *   │   └── 2. Estudo Técnico de Caso            → ETC
 *   └── 3. Pacientes
 *       └── <Paciente>
 *           ├── 1. Treinamento de Aplicadores ABA        → TAP
 *           ├── 2. Treinamento e Orientação Parental     → TOP
 *           ├── 3. Plano Individualizado Comportamental  → PIC
 *           ├── 4. Relatório de Fechamento Técnico       → RT
 *           ├── 5. Orientação Escolar                    → OE
 *           ├── 6. Avaliações Gerais                     (fora do PEP)
 *           └── 7. Protocolo de Conduta                  (fora do PEP)
 *
 * A chave de cada pasta é o NÚMERO no começo do nome, não o texto: "3. Plano
 * Individualizado Comportamental (PIC)" pode ganhar um acento ou perder o
 * "(PIC)" sem mudar o que ela é. Renomear para outro número é que muda.
 *
 * Nada aqui fala com a rede nem com o banco. Entra a árvore, sai a
 * classificação — é o que os testes cobrem.
 */

const SECAO = { 1: 'planejamento', 2: 'geral', 3: 'pacientes' }
const ITEM_GERAL = { 1: 'STC', 2: 'ETC' }
const ITEM_PACIENTE = { 1: 'TAP', 2: 'TOP', 3: 'PIC', 4: 'RT', 5: 'OE', 6: null, 7: null }

const RE_PRESTADOR = /^prestador\s+de\s+servi[cç]o\s*[-–—]\s*(.+?)\s*(?:\(([^()]+)\))?\s*$/i

/** "3. Pacientes" → 3. Aceita "3 - Pacientes", "3) Pacientes", "03. Pacientes". */
function numeroDaPasta(nome) {
  const m = String(nome ?? '').trim().match(/^0*(\d{1,2})\s*[.)\-–]/)
  return m ? Number(m[1]) : null
}

function lerPastaPrestador(nome) {
  const m = String(nome ?? '').trim().match(RE_PRESTADOR)
  if (!m) return null
  return { nomeCurto: m[1].trim(), razaoSocial: m[2] ? m[2].trim() : null }
}

/**
 * Competência do arquivo.
 *
 * 1º o nome, se trouxer o mês no padrão do PRD §13.6 (`…-MMAAAA`, com ou sem
 * separador: 082026, 08-2026, 08_2026). 2º a data de envio, no fuso de
 * Brasília — um arquivo subido às 22h do dia 31 é do mês 31, não do 1º.
 * A pessoa confirma ou corrige na tela; isto é só a sugestão.
 */
function competenciaDoArquivo(nomeArquivo, criadoEmIso) {
  const base = String(nomeArquivo ?? '').replace(/\.[^.]+$/, '')
  const m = base.match(/(?:^|[^\d])(0[1-9]|1[0-2])[-_. ]?(20\d{2})$/)
  if (m) return { competencia: `${m[2]}-${m[1]}`, fonte: 'nome' }

  if (criadoEmIso) {
    const d = new Date(criadoEmIso)
    if (!Number.isNaN(d.getTime())) {
      const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
      }).formatToParts(d)
      const ano = partes.find(p => p.type === 'year').value
      const mes = partes.find(p => p.type === 'month').value
      return { competencia: `${ano}-${mes}`, fonte: 'envio' }
    }
  }
  return { competencia: null, fonte: null }
}

/**
 * Sobe da pasta/arquivo até a raiz da biblioteca e devolve os nós do caminho,
 * do mais alto para o mais baixo (sem a raiz). `null` quando a cadeia quebra —
 * pai desconhecido, o que numa árvore montada pelo delta só acontece se o
 * delta veio incompleto.
 */
function caminhoAteRaiz(arvore, id, raizId) {
  const nos = []
  const vistos = new Set()
  let atual = arvore.get(id)
  // A raiz da biblioteca não é guardada na árvore (o delta a devolve só com a
  // faceta `root`): o caminho termina quando o PAI do nó é a raiz.
  while (atual) {
    if (vistos.has(atual.id)) return null // ciclo: nunca deveria existir
    vistos.add(atual.id)
    nos.push(atual)
    if (atual.paiId === raizId) return nos.reverse()
    if (!atual.paiId) return null
    atual = arvore.get(atual.paiId)
  }
  return null
}

/**
 * Classifica um ARQUIVO.
 *
 * tipo:
 *   'evidencia'   — arquivo numa pasta de item do PEP
 *   'planilha'    — .xlsx na pasta de planejamento
 *   'ignorado'    — pasta 6/7 do paciente, ou arquivo solto fora de pasta de item
 *   'fora_padrao' — caminho que não segue a estrutura (vai para revisão)
 */
function classificarArquivo(arvore, raizId, arquivo) {
  const caminho = caminhoAteRaiz(arvore, arquivo.id, raizId)
  if (!caminho) return { tipo: 'fora_padrao', motivo: 'caminho_incompleto' }

  const pastas = caminho.slice(0, -1) // o último é o próprio arquivo
  const texto = caminho.map(n => n.nome).join('/')
  const base = { caminho: texto }

  if (pastas.length === 0) return { ...base, tipo: 'fora_padrao', motivo: 'arquivo_na_raiz' }

  const prestador = pastas[0]
  const lido = lerPastaPrestador(prestador.nome)
  if (!lido) return { ...base, tipo: 'fora_padrao', motivo: 'pasta_prestador_fora_padrao' }
  const comPrestador = { ...base, prestadorPastaId: prestador.id }

  if (pastas.length < 2) return { ...comPrestador, tipo: 'ignorado', motivo: 'arquivo_solto_no_prestador' }
  const secao = SECAO[numeroDaPasta(pastas[1].nome)]
  if (!secao) return { ...comPrestador, tipo: 'fora_padrao', motivo: 'secao_desconhecida' }

  if (secao === 'planejamento') {
    return /\.xlsx$/i.test(arquivo.nome)
      ? { ...comPrestador, tipo: 'planilha' }
      : { ...comPrestador, tipo: 'ignorado', motivo: 'nao_e_planilha' }
  }

  if (secao === 'geral') {
    if (pastas.length < 3) return { ...comPrestador, tipo: 'ignorado', motivo: 'arquivo_solto_no_geral' }
    const sigla = ITEM_GERAL[numeroDaPasta(pastas[2].nome)]
    if (!sigla) return { ...comPrestador, tipo: 'fora_padrao', motivo: 'item_geral_desconhecido' }
    return { ...comPrestador, tipo: 'evidencia', sigla }
  }

  // pacientes
  if (pastas.length < 3) return { ...comPrestador, tipo: 'ignorado', motivo: 'arquivo_solto_em_pacientes' }
  const paciente = pastas[2]
  const comPaciente = { ...comPrestador, pacientePastaId: paciente.id, pacientePastaNome: paciente.nome }
  if (pastas.length < 4) return { ...comPaciente, tipo: 'ignorado', motivo: 'arquivo_solto_no_paciente' }

  const numero = numeroDaPasta(pastas[3].nome)
  if (!(numero in ITEM_PACIENTE)) return { ...comPaciente, tipo: 'fora_padrao', motivo: 'item_paciente_desconhecido' }
  const sigla = ITEM_PACIENTE[numero]
  if (!sigla) return { ...comPaciente, tipo: 'ignorado', motivo: 'pasta_fora_do_pep' }
  return { ...comPaciente, tipo: 'evidencia', sigla }
}

/**
 * Papel de uma PASTA na estrutura: 'prestador' (nível 1), 'paciente' (dentro
 * de "3. Pacientes") ou null. As pastas de paciente importam mesmo vazias —
 * são elas que o banco reconhece (pasta → CPF → cadastro), e o arquivo que
 * chegar depois só herda o reconhecimento.
 */
function classificarPasta(arvore, raizId, id) {
  const caminho = caminhoAteRaiz(arvore, id, raizId)
  if (!caminho || !caminho.length) return { papel: null }
  const prestador = caminho[0]
  if (!lerPastaPrestador(prestador.nome)) return { papel: null }
  if (caminho.length === 1) return { papel: 'prestador', prestadorPastaId: prestador.id }
  if (caminho.length === 3 && SECAO[numeroDaPasta(caminho[1].nome)] === 'pacientes') {
    return { papel: 'paciente', prestadorPastaId: prestador.id }
  }
  return { papel: null, prestadorPastaId: prestador.id }
}

/**
 * Pastas de prestador na raiz, com o que o nome diz delas. Serve ao relatório
 * de inventário e para o banco conferir a razão social contra a planilha.
 */
function pastasDePrestador(arvore, raizId) {
  const lista = []
  for (const no of arvore.values()) {
    if (!no.pasta || no.paiId !== raizId) continue
    const lido = lerPastaPrestador(no.nome)
    lista.push({ id: no.id, nome: no.nome, padrao: !!lido, razaoSocial: lido?.razaoSocial ?? null })
  }
  return lista
}

module.exports = {
  numeroDaPasta,
  lerPastaPrestador,
  competenciaDoArquivo,
  caminhoAteRaiz,
  classificarArquivo,
  classificarPasta,
  pastasDePrestador,
  ITEM_PACIENTE,
  ITEM_GERAL,
}
