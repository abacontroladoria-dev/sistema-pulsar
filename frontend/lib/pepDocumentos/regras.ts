// Conferências FIXAS do conteúdo (sem IA). Cada uma devolve achados com o
// trecho que prova. Fonte dos critérios: as réguas recebidas em 14/10/2026
// ("OE e ETC.pdf" e "AUDITORIA DE PREENCHIMENTO E QUALIDADE DO PIC.docx") —
// a parte delas que dá para conferir sem interpretar o texto:
//
//   • resíduos do modelo: "[nome]", "inserir", "colocar o nome do paciente",
//     "xx horas", "Fulano", "incluir gráfico", linhas "______", "//____";
//   • campos vazios: "Data:", "Paciente:", "Horário de início:" sem valor;
//   • datas inválidas (31/02), no futuro, fora do mês do arquivo;
//   • horários incoerentes (término antes do início);
//   • documento de outro tipo na pasta (o PIC que era outra coisa);
//   • paciente citado diferente do da pasta; outro paciente do analista citado;
//   • documento quase vazio; seção sem conteúdo.
//
// O que exige julgamento ("texto genérico", "objetivo mensurável",
// "coerência entre seções") fica para a IA, e nunca passa de "atenção".
//
// Regra do "errado": só o que dá para provar com o trecho. Na dúvida,
// "atenção" — a pessoa olha.

import { nomesCompativeis } from '@/lib/roboSharepoint/padraoNome'
import { mascararContatos } from './anonimizar'
import type { Achado, ContextoDocumento, Nivel } from './tipos'
import {
  RE_HORA, RE_INTERVALO, cortar, datasDaLinha, linhasDe, minutos, normalizar, rotuloValor,
  secaoDaLinha, semAcento, tituloNumerado, valorVazio,
} from './texto'

const MAX_ACHADOS = 40

/** Itens com registro de um encontro num dia: a data dele cai no mês do arquivo. */
const SIGLAS_DO_MES = new Set(['STC', 'ETC', 'TAP', 'TOP', 'OE'])
/** As réguas OE e ETC pedem data e horário de início/término. */
const SIGLAS_COM_HORARIO = new Set(['OE', 'ETC'])
/**
 * TAP é material de treinamento PARA o aplicador: traz instruções ("preencha
 * a data…"), roteiros com colchetes ("Primeiro [tarefa]") e folhas de
 * registro em branco para a sessão. Nele, isso é conteúdo, não sobra do
 * modelo (medido em 14/10/2026): resíduos não contam e lacuna/campo vazio
 * ficam só em "atenção".
 */
const SIGLAS_FORMULARIO = new Set(['TAP'])

/** "Abril/2026", "Setembro 2026", "10/2024", "Maio de 2026": mês e ano — válido em campo de data. */
const MES_ANO = /^(\d{1,2}\s*\/\s*\d{4}|[a-z]+\s*(\/|de)?\s*\d{4})\.?$/

/**
 * Título de cada documento, sem acento e minúsculo. `titulo` é o nome por
 * extenso; `sigla` a sigla solta. Para reconhecer o PRÓPRIO documento vale
 * qualquer um dos dois no começo do texto; para dizer que é OUTRO documento,
 * só o nome por extenso nas duas primeiras linhas — "etc." e "top" aparecem
 * em qualquer texto, e um PIC traz "Supervisão técnica: Fulana" no cabeçalho.
 */
const TITULOS: Record<string, { titulo: RegExp; sigla: RegExp; nome: string }> = {
  STC: { titulo: /supervisao tecnica aba|supervisao tecnica do caso/, sigla: /supervisao tecnica|\bstc\b/, nome: 'Supervisão Técnica (STC)' },
  ETC: { titulo: /estudo tecnico de caso/, sigla: /estudo tecnico|\betc\b/, nome: 'Estudo Técnico de Caso (ETC)' },
  TAP: { titulo: /treinamento (de |dos )?aplicadores|manual de treinamento|treinamento e aplicacao/, sigla: /\btap\b/, nome: 'Treinamento de Aplicadores (TAP)' },
  TOP: { titulo: /orientacao parental/, sigla: /treinamento e orientacao|\btop\b/, nome: 'Treinamento e Orientação Parental (TOP)' },
  PIC: { titulo: /plano (individualizado|de intervencao)/, sigla: /\bpic\b/, nome: 'Plano Individualizado Comportamental (PIC)' },
  RT: { titulo: /relatorio (de )?fechamento|fechamento tecnico/, sigla: /\brt\b|relatorio tecnico/, nome: 'Relatório de Fechamento Técnico (RT)' },
  OE: { titulo: /orientacao escolar/, sigla: /\boe\b/, nome: 'Orientação Escolar (OE)' },
}

/** Campos que, vazios, são erro (não um título de bloco). Chave normalizada, começo. */
const CAMPOS_ESSENCIAIS = [
  'data', 'horario', 'hora de inicio', 'hora de termino', 'inicio', 'termino',
  'paciente', 'nome do paciente', 'nome da crianca', 'crianca', 'responsavel', 'escola',
  'cargo', 'funcao', 'psicologo', 'psicologa', 'representante', 'analista', 'coordenador', 'coordenadora',
  'coordenacao', 'supervisao tecnica', 'supervisor', 'supervisora', 'financiadora', 'convenio',
  'idade', 'diagnostico', 'periodo de vigencia', 'vigencia',
]
// "Equipe responsável:" costuma ser título de bloco (Coordenação, Supervisão
// técnica vêm embaixo) — medido em 14/10/2026 nos PICs reais: não entra aqui.

/** Rótulos de data que NÃO são do encontro (não precisam cair no mês). */
const DATA_QUE_NAO_E_DO_ENCONTRO = /nascimento|diagnost|medicac|laudo|admiss|vigenc|inicio|validade|emiss|prox/

/** Valores que são o próprio modelo: "Paciente: nome do paciente". */
const VALOR_GENERICO = new Set([
  'paciente', 'nome', 'nome do paciente', 'nome da crianca', 'crianca', 'responsavel', 'escola',
  'fulano', 'fulano de tal', 'ciclano', 'beltrano', 'xxx', 'xx', 'x', 'a definir', 'nome completo',
])

type Padrao = { re: RegExp; nivel: Nivel; codigo: string; titulo: string }

/** Resíduos do modelo e instruções ao profissional. Testados na linha sem acento e minúscula. */
const RESIDUOS: Padrao[] = [
  // Calibrado em 14/10/2026 com os documentos reais: só é "errado" o que tem a
  // cara do modelo. "[nome]" é modelo; "Estou [ação]" num exemplo de avaliação
  // (VB-MAPP) não é. "Colocar o nome" é modelo; "colocar a roupa" (autocuidado)
  // não é. "Procurando preencher a ficha" (orientação à escola) não é.
  { re: /\[\s*(nome|data|paciente|crianca|mes|ano|idade|escola|responsavel|terapeuta|profissional|coordenador|inserir|preencher|descrever|listar|x+|\.{3}|_+)[^\]\n]{0,30}\]/, nivel: 'errado', codigo: 'texto_do_modelo', titulo: 'Texto do modelo entre colchetes' },
  { re: /\[(?!\s*(?:sic|\d+)\s*\])[^\]\n]{2,40}\]/, nivel: 'atencao', codigo: 'possivel_instrucao', titulo: 'Texto entre colchetes: confira se é do modelo' },
  { re: /\b(inserir|insira)\b/, nivel: 'errado', codigo: 'texto_do_modelo', titulo: 'Instrução do modelo não apagada' },
  { re: /\bcolocar (o|a|os|as) (nome|data|mes|ano|numero|periodo|dia|horario|resultado|grafico|idade|diagnostico)\b/, nivel: 'errado', codigo: 'texto_do_modelo', titulo: 'Instrução do modelo não apagada' },
  { re: /^(preencha|preencher|digite|digitar)\b|\((preencha|preencher|digite)\b/, nivel: 'atencao', codigo: 'possivel_instrucao', titulo: 'Parece instrução do modelo' },
  { re: /\blistar comportamentos\b|\bdescrever resumidamente\b|\bincluir (o )?grafico\b/, nivel: 'errado', codigo: 'texto_do_modelo', titulo: 'Instrução do modelo não apagada' },
  { re: /\bx{2,}\b/, nivel: 'errado', codigo: 'texto_do_modelo', titulo: 'Marcação "xx" do modelo' },
  { re: /\b(fulano|ciclano|beltrano)\b/, nivel: 'errado', codigo: 'texto_do_modelo', titulo: 'Nome genérico do modelo' },
  { re: /\b(texto de exemplo|exemplo de preenchimento)\b/, nivel: 'errado', codigo: 'texto_do_modelo', titulo: 'Texto de exemplo do modelo' },
  { re: /^(listar|descrever|informar|relatar|citar|indicar|especificar|descreva|liste|informe)\b/, nivel: 'atencao', codigo: 'possivel_instrucao', titulo: 'Parece instrução do modelo' },
  { re: /(?<!por )\b(ex\.|exemplo)\s*:/, nivel: 'atencao', codigo: 'possivel_instrucao', titulo: 'Parece exemplo do modelo' },
]

class Coletor {
  achados: Achado[] = []
  private vistos = new Set<string>()
  add(a: Omit<Achado, 'origem'>) {
    // O trecho fica gravado e aparece na tela: sem CPF, telefone ou e-mail.
    const trecho = a.trecho ? mascararContatos(a.trecho) : undefined
    const chave = `${a.codigo}|${trecho ?? ''}`
    if (this.vistos.has(chave) || this.achados.length >= MAX_ACHADOS) return
    this.vistos.add(chave)
    this.achados.push({ ...a, trecho, descricao: a.descricao ? mascararContatos(a.descricao) : undefined, origem: 'regra' })
  }
}

function ehCampoEssencial(chave: string) {
  return CAMPOS_ESSENCIAIS.some(c => chave === c || chave.startsWith(`${c} `))
}

/** Nome do valor de um rótulo, sem complemento: "João Silva, 5 anos" → "João Silva". */
function nomeDoValor(v: string) {
  return v.split(/[,;(]|\s[-–—]\s|\d/)[0].trim()
}

export function conferirTexto(texto: string, ctx: ContextoDocumento): Achado[] {
  const c = new Coletor()
  const linhas = linhasDe(texto)
  const sigla = ctx.sigla.toUpperCase()
  const hoje = ctx.hoje ?? new Date().toISOString().slice(0, 10)
  const normal = normalizar(texto)
  const naoEspacos = texto.replace(/\s/g, '').length
  const formulario = SIGLAS_FORMULARIO.has(sigla)

  // ── Tamanho ────────────────────────────────────────────────────────────────
  if (naoEspacos < 200) {
    c.add({ codigo: 'documento_quase_vazio', familia: 'preenchimento', nivel: 'errado', titulo: 'Documento praticamente vazio',
      descricao: `Só ${naoEspacos} caracteres de texto.` })
  } else if (naoEspacos < 400) {
    c.add({ codigo: 'documento_curto', familia: 'preenchimento', nivel: 'atencao', titulo: 'Documento muito curto',
      descricao: `Só ${naoEspacos} caracteres de texto: confira se está completo.` })
  }

  // ── Tipo do documento ────────────────────────────────────────────────────────
  if (!ctx.reprogramacao && TITULOS[sigla]) {
    const inicio = normalizar(texto.slice(0, 800))
    const cabecalho = normalizar(linhas.slice(0, 2).join(' '))
    const proprio = TITULOS[sigla]
    if (!proprio.titulo.test(inicio) && !proprio.sigla.test(inicio)) {
      const outro = Object.entries(TITULOS).find(([s, t]) => s !== sigla && t.titulo.test(cabecalho))
      if (outro) {
        c.add({ codigo: 'documento_de_outro_tipo', familia: 'coerencia', nivel: 'errado',
          titulo: `Parece ser ${outro[1].nome}, não ${TITULOS[sigla].nome}`,
          descricao: 'O título do documento é de outro item do PEP: confira se o arquivo está na pasta certa.',
          trecho: cortar(linhas.slice(0, 3).join(' · ')) })
      } else {
        c.add({ codigo: 'titulo_nao_identificado', familia: 'coerencia', nivel: 'atencao',
          titulo: `Não achei o título de ${TITULOS[sigla].nome}`,
          descricao: 'O começo do documento não diz que documento é: confira se é o modelo certo.',
          trecho: cortar(linhas.slice(0, 2).join(' · ')) })
      }
    }
  }

  // ── Linha a linha ────────────────────────────────────────────────────────────
  let viuData = false
  let viuHora = false
  let horaInicio: { min: number; linha: string } | null = null
  let horaFim: { min: number; linha: string } | null = null
  const valoresPaciente: { valor: string; linha: string; secao?: string }[] = []

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]
    const baixa = semAcento(linha).toLowerCase()
    const secao = secaoDaLinha(linhas, i)
    const rv = rotuloValor(linha)

    // Lacunas do modelo: "Data: //____", "______ às ______". Linha só de
    // sublinhado é a linha da assinatura — não conta.
    // "Assinatura do coordenador: ______" é o lugar da assinatura (à mão ou
    // digital): não é campo do modelo esquecido.
    // "______ Fulana de Tal" é a linha da assinatura com o nome embaixo/ao lado.
    // "Nome do Responsável Legal: ____" fica no bloco de assinaturas e costuma
    // ser preenchido à mão: atenção (a régua do PIC confere só o coordenador).
    if (/_{3,}/.test(linha) && !/^[_\s]+$/.test(linha) && !/^assinatura\b/.test(baixa) && !/^_{3,}\s*[\p{L}]/u.test(linha)) {
      const blocoAssinatura = /^nome do responsavel|^responsavel legal/.test(baixa)
      c.add({ codigo: 'lacuna_do_modelo', familia: 'preenchimento', nivel: formulario || blocoAssinatura ? 'atencao' : 'errado', titulo: 'Campo do modelo sem preencher', trecho: cortar(linha), secao })
    }

    // Resíduos: só na parte do valor quando a linha é "Rótulo: valor" —
    // "Nome do paciente: João" é rótulo, não resíduo.
    const alvo = rv ? normalizarParaResiduo(rv.valor) : baixa
    for (const p of formulario ? [] : RESIDUOS) {
      if (p.re.test(alvo)) {
        c.add({ codigo: p.codigo, familia: 'preenchimento', nivel: p.nivel, titulo: p.titulo, trecho: cortar(linha), secao })
        break
      }
    }

    if (rv) {
      const vazio = valorVazio(rv.valor)
      if (vazio) {
        // Valor pode estar na linha de baixo ("Objetivos:" + lista). Só é
        // campo vazio quando a seguinte é outro rótulo, um título, ou o fim.
        const prox = linhas[i + 1]
        const proxEhCampo = !prox || !!rotuloValor(prox) || !!tituloNumerado(prox)
        if (proxEhCampo) {
          const essencial = ehCampoEssencial(rv.chave) && !formulario
          c.add({
            codigo: essencial ? 'campo_vazio' : 'campo_possivelmente_vazio', familia: 'preenchimento',
            nivel: essencial ? 'errado' : 'atencao',
            titulo: essencial ? `Campo sem preenchimento: ${rv.rotulo}` : `Pode estar sem preenchimento: ${rv.rotulo}`,
            trecho: cortar(linha), secao,
          })
        }
      } else if (VALOR_GENERICO.has(normalizar(rv.valor))) {
        c.add({ codigo: 'texto_do_modelo', familia: 'preenchimento', nivel: 'errado',
          titulo: `Campo com o texto do modelo: ${rv.rotulo}`, trecho: cortar(linha), secao })
      }

      if (/^(nome (completo )?(do|da) )?(paciente|crianca|aprendiz|cliente|beneficiario)$/.test(rv.chave) && !vazio) {
        valoresPaciente.push({ valor: nomeDoValor(rv.valor), linha, secao })
      }

      if (/^(psicolog[oa]|analista|terapeuta|profissional)( do comportamento)?( responsavel)?$/.test(rv.chave) && !vazio && ctx.prestadorNome) {
        const nome = nomeDoValor(rv.valor)
        if (nome.split(' ').length >= 2 && !nomesCompativeis(nome, ctx.prestadorNome)) {
          c.add({ codigo: 'profissional_diferente', familia: 'coerencia', nivel: 'atencao',
            titulo: 'Profissional citado não é o analista da pasta',
            descricao: `Cita “${nome}”; a pasta é de ${ctx.prestadorNome}.`, trecho: cortar(linha), secao })
        }
      }

      // Horário em linhas separadas: "Horário de início: 14:00".
      if (/(inicio|entrada)$/.test(rv.chave) || /^hora(rio)? de inicio/.test(rv.chave)) {
        const h = rv.valor.match(RE_HORA)
        const m = h ? minutos(h[1], h[2]) : null
        if (m != null) horaInicio = { min: m, linha }
      }
      if (/(termino|fim|saida)$/.test(rv.chave) || /^hora(rio)? de termino/.test(rv.chave)) {
        const h = rv.valor.match(RE_HORA)
        const m = h ? minutos(h[1], h[2]) : null
        if (m != null) horaFim = { min: m, linha }
      }
    }

    // Datas.
    const datas = datasDaLinha(linha)
    if (datas.length) viuData = true
    const rotuloData = rv && /^data\b/.test(rv.chave) ? rv : null
    for (const d of datas) {
      if (!d.iso) {
        c.add({ codigo: 'data_invalida', familia: 'preenchimento', nivel: 'errado', titulo: `Data que não existe: ${d.texto}`, trecho: cortar(linha), secao })
        continue
      }
      if (rotuloData && !DATA_QUE_NAO_E_DO_ENCONTRO.test(rotuloData.chave)) {
        if (d.iso > somaDias(hoje, 1)) {
          c.add({ codigo: 'data_futura', familia: 'coerencia', nivel: 'atencao', titulo: `Data no futuro: ${d.texto}`, trecho: cortar(linha), secao })
        } else if (SIGLAS_DO_MES.has(sigla) && ctx.competencia && d.iso.slice(0, 7) !== ctx.competencia) {
          c.add({ codigo: 'data_fora_do_mes', familia: 'coerencia', nivel: 'atencao',
            titulo: `Data fora do mês do arquivo (${mesBR(ctx.competencia)})`, descricao: `O documento diz ${d.texto}.`, trecho: cortar(linha), secao })
        }
      }
    }
    if (rotuloData && !valorVazio(rotuloData.valor) && datas.length === 0 && /\d/.test(rotuloData.valor)
        && !MES_ANO.test(semAcento(rotuloData.valor).toLowerCase().trim())) {
      // "10/07/20219" é data quebrada (errado); "2026" sozinho é incompleta (atenção).
      const quebrada = /\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d+/.test(rotuloData.valor)
      c.add({
        codigo: quebrada ? 'data_invalida' : 'data_incompleta', familia: 'preenchimento', nivel: quebrada ? 'errado' : 'atencao',
        titulo: quebrada ? 'Data em formato inválido' : 'Data incompleta', trecho: cortar(linha), secao,
      })
    }

    // Horários "14h às 15h".
    for (const m of linha.matchAll(RE_INTERVALO)) {
      viuHora = true
      const ini = minutos(m[1], m[2])
      const fim = minutos(m[3], m[4])
      if (ini == null || fim == null) {
        c.add({ codigo: 'horario_invalido', familia: 'preenchimento', nivel: 'errado', titulo: 'Horário que não existe', trecho: cortar(linha), secao })
      } else if (fim <= ini) {
        c.add({ codigo: 'horario_incoerente', familia: 'preenchimento', nivel: 'errado', titulo: 'Horário de término antes do início', trecho: cortar(linha), secao })
      } else if (fim - ini > 240) {
        c.add({ codigo: 'duracao_longa', familia: 'preenchimento', nivel: 'atencao', titulo: `Encontro de ${Math.round((fim - ini) / 60)} h: confira o horário`, trecho: cortar(linha), secao })
      }
    }
    if (!viuHora && RE_HORA.test(linha) && rv && /hora|inicio|termino/.test(rv.chave)) viuHora = true
  }

  if (horaInicio && horaFim && horaFim.min <= horaInicio.min) {
    c.add({ codigo: 'horario_incoerente', familia: 'preenchimento', nivel: 'errado', titulo: 'Horário de término antes do início',
      trecho: cortar(`${horaInicio.linha} · ${horaFim.linha}`) })
  }
  if (SIGLAS_DO_MES.has(sigla) && !viuData) {
    c.add({ codigo: 'data_nao_encontrada', familia: 'preenchimento', nivel: 'atencao', titulo: 'Nenhuma data no documento',
      descricao: 'O registro do encontro deveria trazer a data.' })
  }
  if (SIGLAS_COM_HORARIO.has(sigla) && !viuHora) {
    c.add({ codigo: 'horario_nao_encontrado', familia: 'preenchimento', nivel: 'atencao', titulo: 'Nenhum horário no documento',
      descricao: 'A régua pede horário de início e de término.' })
  }

  // ── Seções numeradas sem conteúdo ───────────────────────────────────────────
  for (let i = 0; i < linhas.length; i++) {
    const t = tituloNumerado(linhas[i])
    if (!t) continue
    const prox = linhas[i + 1]
    const tProx = prox ? tituloNumerado(prox) : null
    if (!prox || (tProx && tProx.nivel <= t.nivel)) {
      c.add({ codigo: 'secao_vazia', familia: 'preenchimento', nivel: 'atencao', titulo: `Seção sem conteúdo: ${cortar(linhas[i], 60)}`, trecho: cortar(linhas[i]) })
    }
  }

  // ── Paciente ────────────────────────────────────────────────────────────────
  if (ctx.tipoRegistro === 'POR_PACIENTE' && (ctx.pacienteNome || ctx.pastaPaciente)) {
    const daPasta = (n: string) => nomesCompativeis(n, ctx.pacienteNome) || nomesCompativeis(n, ctx.pastaPaciente)
    for (const v of valoresPaciente) {
      if (!v.valor || VALOR_GENERICO.has(normalizar(v.valor))) continue
      if (!daPasta(v.valor)) {
        c.add({ codigo: 'paciente_diferente', familia: 'coerencia', nivel: 'errado',
          titulo: 'O documento é de outro paciente',
          descricao: `Cita “${v.valor}”, mas está na pasta de ${ctx.pacienteNome ?? ctx.pastaPaciente}.`, trecho: cortar(v.linha), secao: v.secao })
      }
    }
    const primeiro = (n: string | null) => normalizar(n).split(' ')[0] ?? ''
    const nomes = [primeiro(ctx.pacienteNome), primeiro(ctx.pastaPaciente)].filter(p => p.length >= 3)
    const palavras = new Set(normal.split(' '))
    if (valoresPaciente.length === 0 && nomes.length && !nomes.some(n => palavras.has(n))) {
      c.add({ codigo: 'paciente_nao_citado', familia: 'coerencia', nivel: 'atencao',
        titulo: 'O nome do paciente não aparece no documento',
        descricao: `Procurei por “${ctx.pacienteNome ?? ctx.pastaPaciente}”.` })
    }
    // Outro paciente do mesmo analista citado pelo nome completo: sobra de cópia.
    for (const outro of ctx.outrosPacientes ?? []) {
      const p = normalizar(outro).split(' ').filter(t => t.length >= 2)
      if (p.length < 2 || daPasta(outro)) continue
      const re = new RegExp(`\\b${p[0]}\\b(?: \\S+){0,3} \\b${p[p.length - 1]}\\b`)
      if (re.test(normal)) {
        const idx = linhas.findIndex(l => re.test(normalizar(l)))
        c.add({ codigo: 'cita_outro_paciente', familia: 'coerencia', nivel: 'atencao',
          titulo: 'Cita outro paciente do mesmo analista',
          descricao: `Aparece “${outro}”: pode ser sobra de cópia de outro documento.`,
          trecho: idx >= 0 ? cortar(linhas[idx]) : undefined })
      }
    }
  }

  return c.achados
}

/** Resíduos são testados sem acento e em minúsculas. */
function normalizarParaResiduo(s: string) {
  return semAcento(s).toLowerCase()
}

function somaDias(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const mesBR = (c: string) => c.split('-').reverse().join('/')
