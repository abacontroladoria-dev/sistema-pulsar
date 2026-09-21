import type { SupabaseClient } from '@supabase/supabase-js'
import { FichaRepository, type PatchFicha } from '../repositories/ficha.repository'
import { PacienteRepository, type PacienteCadastro } from '../repositories/paciente.repository'
import {
  CAMPOS_FICHA,
  type CampoFicha,
  type CampoResolvido,
  type ContactIntake,
  type FichaPaciente,
  type OrigemCampo,
  type TherapyShift,
} from '../types/central.types'

// ============================================================================
// FichaService
//
// Monta a ficha do paciente que o painel mostra, e recebe o que a Maia coleta.
//
// A REGRA QUE ESTE ARQUIVO EXISTE PARA IMPOR:
//
//   O CADASTRO VENCE. SEMPRE, CAMPO A CAMPO.
//
// Quatro dos cinco campos coletáveis existem em `public.pacientes` para quem já
// é da clínica. Quando existem, o que a Maia ouviu no WhatsApp NÃO os
// substitui — nem quando ela ouviu mais recentemente, nem quando parece mais
// específico.
//
// A razão é assimétrica e vale a pena estar escrita: um plano de saúde errado
// no painel não fica errado só no painel. Ele é lido por quem vai pedir uma
// autorização, e uma autorização pedida ao convênio errado volta como glosa
// semanas depois, quando ninguém lembra de onde o dado veio. O TiTa é o sistema
// onde alguém digitou aquilo com o documento na mão; a conversa é onde uma mãe
// escreveu "acho que é Amil" às onze da noite.
//
// O inverso não tem esse custo: um campo que o cadastro não tem e a Maia
// descobriu é informação nova sobre alguém que ainda não é paciente.
// ============================================================================

// Quantos anos, no máximo, uma data de nascimento pode ter. Não é sobre
// impedir valor absurdo — é sobre pegar o ANO TROCADO, que é o erro real. A
// clínica atende crianças, então "1919" é tão errado quanto "2029", e sem este
// teto entraria calado: 1919 é uma data perfeitamente válida.
const IDADE_MAXIMA_ANOS = 120

export class FichaService {
  constructor(
    private readonly ficha:     FichaRepository,
    private readonly pacientes: PacienteRepository,
  ) {}

  // ------------------------------------------------------------------------
  // A ficha pronta para a tela: cadastro + coleta, resolvidos campo a campo.
  // ------------------------------------------------------------------------
  async montar(orgId: string, contactId: string): Promise<FichaPaciente> {
    const titaId = await this.pacientes.titaIdDoContato(orgId, contactId)

    // As duas leituras são independentes, e um contato vinculado normalmente não
    // tem linha de coleta — mas pode ter, se foi vinculado DEPOIS de a Maia já
    // ter perguntado alguma coisa. Esse caso é justamente onde o merge importa.
    const [cadastro, coleta] = await Promise.all([
      titaId != null ? this.pacientes.porTitaId(titaId) : Promise.resolve(null),
      this.ficha.buscar(orgId, contactId),
    ])

    const campos = resolverCampos(cadastro, coleta)

    return {
      contact_id: contactId,
      vinculado:  titaId != null,
      campos,
      idade:      idadeEmAnos(campos.birth_date.valor),
      faltantes:  CAMPOS_FICHA.filter((c) => campos[c].valor === null),
      sincronizado_em: cadastro?.sincronizado_em ?? null,
    }
  }

  // ------------------------------------------------------------------------
  // Registra o que a Maia (ou o atendente) descobriu.
  //
  // Devolve o que foi de fato gravado e o que foi RECUSADO, com o motivo em
  // português. O motivo não é para o log: ele volta ao modelo como resultado da
  // ferramenta e vira a próxima pergunta dela ("não entendi a data, você pode
  // me dizer o ano?"). Uma recusa genérica faria a Maia repetir a mesma
  // pergunta e cair no detector de laço do orquestrador.
  // ------------------------------------------------------------------------
  async registrar(
    orgId: string,
    contactId: string,
    entrada: PatchFicha,
    fonte: Exclude<OrigemCampo, 'cadastro'>,
  ): Promise<{ gravados: CampoFicha[]; recusados: { campo: CampoFicha; motivo: string }[] }> {
    const patch: PatchFicha = {}
    const recusados: { campo: CampoFicha; motivo: string }[] = []

    for (const campo of CAMPOS_FICHA) {
      const bruto = entrada[campo]
      // `undefined` é "não mexe"; `null` vindo do modelo é "ainda não sei", que
      // também é não mexer. Só o atendente apaga, e ele o faz por outra rota.
      if (bruto === undefined || bruto === null) continue

      const texto = String(bruto).trim()
      if (texto === '') continue

      if (campo === 'birth_date') {
        const data = normalizarData(texto)
        if (!data.ok) { recusados.push({ campo, motivo: data.motivo }); continue }
        patch.birth_date = data.valor
        continue
      }

      if (campo === 'shift') {
        const turno = normalizarTurno(texto)
        if (!turno) {
          recusados.push({
            campo,
            motivo: 'Turno não reconhecido. Pergunte se é de manhã, à tarde, o dia todo, ou se tanto faz.',
          })
          continue
        }
        patch.shift = turno
        continue
      }

      patch[campo] = texto
    }

    if (Object.keys(patch).length === 0) {
      return { gravados: [], recusados }
    }

    await this.ficha.aplicar(orgId, contactId, patch, fonte)
    return { gravados: Object.keys(patch) as CampoFicha[], recusados }
  }

  // Um contato com vínculo TiTa não precisa de coleta: o cadastro já tem os
  // campos, e perguntar de novo a quem já é da clínica soa como se a clínica não
  // soubesse quem ele é. É isto que o worker consulta para decidir se a
  // ferramenta sequer chega ao modelo.
  async deveColetar(orgId: string, contactId: string): Promise<boolean> {
    const titaId = await this.pacientes.titaIdDoContato(orgId, contactId)
    if (titaId != null) return false

    const coleta = await this.ficha.buscar(orgId, contactId)
    return !coleta?.coleta_concluida
  }
}

export function createFichaService(supabase: SupabaseClient): FichaService {
  return new FichaService(new FichaRepository(supabase), new PacienteRepository(supabase))
}

// ----------------------------------------------------------------------------
// O merge, campo a campo
// ----------------------------------------------------------------------------

// De-para entre o campo da ficha e a coluna do cadastro. `shift` não aparece: é
// o único dos cinco que NÃO existe no TiTa, e por isso o único que sempre vem
// da conversa, inclusive para paciente antigo.
const DO_CADASTRO: Partial<Record<CampoFicha, keyof PacienteCadastro>> = {
  patient_name:  'nome',
  birth_date:    'data_nascimento',
  guardian_name: 'responsavel_nome',
  health_plan:   'convenio_nome',
}

export function resolverCampos(
  cadastro: PacienteCadastro | null,
  coleta:   ContactIntake | null,
): Record<CampoFicha, CampoResolvido> {
  const saida = {} as Record<CampoFicha, CampoResolvido>

  for (const campo of CAMPOS_FICHA) {
    const coluna = DO_CADASTRO[campo]
    const doCadastro = coluna && cadastro ? cadastro[coluna] : null

    // String vazia no cadastro conta como ausente. O TiTa tem campos em branco,
    // e tratá-los como preenchidos esconderia o buraco atrás de um valor que a
    // tela renderiza como nada.
    if (doCadastro != null && String(doCadastro).trim() !== '') {
      saida[campo] = { valor: String(doCadastro).trim(), origem: 'cadastro' }
      continue
    }

    const daColeta = coleta ? coleta[campo as keyof ContactIntake] : null
    if (daColeta != null && String(daColeta).trim() !== '') {
      saida[campo] = {
        valor:  String(daColeta).trim(),
        origem: coleta?.fontes?.[campo] ?? 'ia',
      }
      continue
    }

    saida[campo] = { valor: null, origem: null }
  }

  return saida
}

// ----------------------------------------------------------------------------
// Idade: derivada, nunca guardada
// ----------------------------------------------------------------------------

// Sem date-fns de propósito: `differenceInYears` resolveria, mas este módulo é
// importado pelo worker (server-only) e por testes que rodam sem bundler, e a
// conta é de três linhas. Comparar mês e dia é o que evita o erro clássico de
// dividir por 365.25 e devolver 7 para quem faz 7 amanhã.
export function idadeEmAnos(nascimento: string | null, hoje = new Date()): number | null {
  if (!nascimento) return null

  const d = new Date(`${nascimento}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null

  let anos = hoje.getFullYear() - d.getFullYear()
  const mes = hoje.getMonth() - d.getMonth()
  if (mes < 0 || (mes === 0 && hoje.getDate() < d.getDate())) anos--

  if (anos < 0 || anos > IDADE_MAXIMA_ANOS) return null
  return anos
}

// ----------------------------------------------------------------------------
// Normalização da data de nascimento
//
// A Maia recebe o que uma mãe digita no WhatsApp, e isso não é um date picker:
// "12/03/2019", "12 de março de 2019", "12-03-19", "2019-03-12". A coluna é
// `date`, então a conversão tem que acontecer AQUI — onde a falha ainda pode
// virar uma nova pergunta no mesmo turno — e não na renderização, onde não há
// mais ninguém para perguntar.
//
// DIA VEM ANTES DO MÊS. É o formato brasileiro, e o erro de inverter é
// silencioso: 03/12 e 12/03 são ambos válidos, e a criança ganha um aniversário
// errado que ninguém confere. Só há uma exceção, e ela é inequívoca: quando o
// primeiro número tem quatro dígitos, é ISO.
// ----------------------------------------------------------------------------

const MESES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
}

type Normalizacao = { ok: true; valor: string } | { ok: false; motivo: string }

export function normalizarData(bruto: string, hoje = new Date()): Normalizacao {
  const texto = bruto.trim().toLowerCase()

  let ano: number | undefined
  let mes: number | undefined
  let dia: number | undefined

  const iso = texto.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  const br  = texto.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  // "12 de março de 2019" e "12 de marco 2019". O `de` é opcional dos dois lados
  // porque as pessoas escrevem dos dois jeitos.
  const ext = texto.match(/^(\d{1,2})\s*(?:de\s+)?([a-zà-ú]+)\s*(?:de\s+)?(\d{4})$/)

  if (iso) {
    ano = Number(iso[1]); mes = Number(iso[2]); dia = Number(iso[3])
  } else if (br) {
    dia = Number(br[1]); mes = Number(br[2]); ano = Number(br[3])
  } else if (ext) {
    dia = Number(ext[1])
    mes = MESES[semAcento(ext[2])]
    ano = Number(ext[3])
    if (!mes) {
      return { ok: false, motivo: `Não reconheci o mês "${ext[2]}". Peça a data em números, como 12/03/2019.` }
    }
  } else {
    return {
      ok: false,
      motivo: 'Não entendi a data de nascimento. Peça no formato dia/mês/ano, por exemplo 12/03/2019.',
    }
  }

  // Ano de dois dígitos. "19" para uma criança é 2019, não 1919 — e assumir o
  // século errado produziria uma data válida com 100 anos de erro. A regra: o
  // que cair no futuro pertence ao século passado.
  if (ano < 100) {
    const seculo = Math.floor(hoje.getFullYear() / 100) * 100
    ano = ano + seculo > hoje.getFullYear() ? ano + seculo - 100 : ano + seculo
  }

  if (mes! < 1 || mes! > 12 || dia! < 1 || dia! > 31) {
    return { ok: false, motivo: 'Essa data não existe. Confirme o dia e o mês com o responsável.' }
  }

  // Um `Date` construído com 30/02 não falha: ele ROLA para 02/03. Comparar as
  // partes de volta é o que pega isso — sem esta checagem, "30/02/2019" entraria
  // no banco como 02/03/2019, que é uma data plausível e errada.
  const d = new Date(Date.UTC(ano, mes! - 1, dia!))
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes! - 1 || d.getUTCDate() !== dia!) {
    return { ok: false, motivo: 'Essa data não existe nesse mês. Confirme o dia com o responsável.' }
  }

  if (d.getTime() > hoje.getTime()) {
    return { ok: false, motivo: 'Essa data está no futuro. Confirme o ano de nascimento com o responsável.' }
  }

  const limite = new Date(hoje)
  limite.setFullYear(limite.getFullYear() - IDADE_MAXIMA_ANOS)
  if (d.getTime() < limite.getTime()) {
    return { ok: false, motivo: 'Esse ano de nascimento não parece certo. Confirme com o responsável.' }
  }

  const pad = (n: number) => String(n).padStart(2, '0')
  return { ok: true, valor: `${ano}-${pad(mes!)}-${pad(dia!)}` }
}

// ----------------------------------------------------------------------------
// Normalização do turno
//
// O enum tem quatro valores e o responsável tem cem jeitos de dizê-los. O
// modelo recebe o enum no schema e normalmente devolve um deles — mas `strict`
// pode ser desligado, e a mesma função serve ao PATCH do atendente.
//
// 'indiferente' é um valor, não a ausência de um: "tanto faz" é uma resposta, e
// tratá-la como vazio faria a Maia perguntar de novo no turno seguinte.
// ----------------------------------------------------------------------------
export function normalizarTurno(bruto: string): TherapyShift | null {
  const t = semAcento(bruto.trim().toLowerCase())

  if (/(manha|matutino|cedo|antes do almoco)/.test(t)) return 'manha'
  if (/(tarde|vespertino|depois do almoco)/.test(t))   return 'tarde'
  if (/(integral|dia todo|dia inteiro|ambos|os dois)/.test(t)) return 'integral'
  if (/(indiferente|tanto faz|qualquer|nao importa|flexivel)/.test(t)) return 'indiferente'

  return null
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}
