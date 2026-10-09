// Monta as etiquetas de um modelo de contrato a partir do cadastro — e diz o
// que FALTA. Puro: sem React, sem Supabase (a leitura é de
// services/contratos/documento.ts).
//
// Com qualquer pendência o documento NÃO é gerado: um contrato com «CPF» vazio
// iria para a assinatura assim mesmo. A tela mostra a lista para a equipe
// completar o cadastro.
//
// Quem é quem (mesma regra dos signatários, 20261008160000):
//   • CONTRATANTE / responsável financeiro = vínculo `financeiro`; sem ele,
//     `filiacao_1`.
//   • RESPONSÁVEL LEGAL (Neuro) = `filiacao_1` quando é outra pessoa. O
//     cadastro não tem marca de "responsável legal"; filiação 1 é o mais perto.
//   • AUTORIZANTE (Termo) = `filiacao_1`; SEGUNDO RESPONSÁVEL = `filiacao_2`.
// Nunca as colunas legadas pacientes.responsavel_*.

import { formatarCelular } from "@/lib/cadastros/profissionais"
import { dataBR, dataBRDeTimestamp } from "@/lib/contratos/status"
import type { TipoContrato } from "@/lib/contratos/status"
import type { Responsavel, TipoVinculoResponsavel } from "@/types/responsavel"
import { dataPorExtenso, quantidadeComExtenso, reais, valorPorExtenso } from "./extenso"

export type PacienteDoc = {
  nome: string
  nome_civil: string | null
  tem_nome_civil: boolean | null
  cpf: string | null
  rg: string | null
  data_nascimento: string | null
}

export type ResponsavelDoc = Pick<
  Responsavel,
  "id" | "nome" | "cpf" | "rg" | "data_nascimento" | "celular" | "email" |
  "cep" | "logradouro" | "numero" | "complemento" | "bairro" | "cidade" | "uf"
>

export type VinculoDoc = {
  tipo: TipoVinculoResponsavel
  parentesco: string | null
  responsavel: ResponsavelDoc
}

/** Os 5 campos de uso externo de imagem. Ausente/`false` = NÃO AUTORIZO. */
export type AutorizacoesImagem = {
  site?: boolean
  redes?: boolean
  impressos?: boolean
  ensino?: boolean
  /** Só no Termo: identificar o paciente pelo primeiro nome. */
  primeiro_nome?: boolean
}

export type ContratoDoc = {
  tipo: TipoContrato
  numero: string | null
  valor_total: number | null
  sessoes_max: number | null
  valor_sessao_avulsa: number | null
  autorizacoes_imagem: AutorizacoesImagem | null
}

/** O contrato de Terapias a que o Termo se vincula. */
export type VinculadoDoc = {
  numero: string | null
  data_inicio: string
  assinado_em: string | null
}

export type EntradaDocumento = {
  contrato: ContratoDoc
  paciente: PacienteDoc
  vinculos: VinculoDoc[]
  vinculado: VinculadoDoc | null
  /** "AAAA-MM-DD" (Brasília) — data do fecho "Rio de Janeiro, …". */
  hoje: string
}

export type Etiquetas = Record<string, string | boolean>

export type ResultadoDocumento =
  | { ok: true; modelo: ArquivoModelo; dados: Etiquetas }
  | { ok: false; pendencias: string[] }

/** Arquivos em lib/contratos/modelos/ (gerados por scripts/contratos/preparar-modelos.mjs). */
export const MODELOS = {
  avaliacao_neuropsicologica: "avaliacao_neuropsicologica_v1_10.docx",
  termo_uso_imagem: "termo_uso_imagem_v1_3.docx",
} as const satisfies Partial<Record<TipoContrato, string>>
export type ArquivoModelo = (typeof MODELOS)[keyof typeof MODELOS]

/** Tipos que já têm modelo de documento. */
export function temModelo(tipo: TipoContrato): tipo is keyof typeof MODELOS {
  return tipo in MODELOS
}

// ─── Formatação ──────────────────────────────────────────────────────────────

const so = (s: string | null | undefined) => (s ?? "").trim()
const digitos = (s: string | null | undefined) => so(s).replace(/\D/g, "")

export function formatarCpf(cpf: string | null): string {
  const d = digitos(cpf)
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : so(cpf)
}

export function formatarCep(cep: string | null): string {
  const d = digitos(cep)
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : so(cep)
}

function endereco(r: ResponsavelDoc): string {
  const rua = [so(r.logradouro), so(r.numero) && `nº ${so(r.numero)}`].filter(Boolean).join(", ")
  return [rua, so(r.complemento)].filter(Boolean).join(" – ")
}

function bairroCidadeUf(r: ResponsavelDoc): string {
  const cidadeUf = [so(r.cidade), so(r.uf).toUpperCase()].filter(Boolean).join("/")
  return [so(r.bairro), cidadeUf].filter(Boolean).join(", ")
}

/** Nome para contrato: o civil, quando o paciente usa nome social. */
export function nomeDoPaciente(p: PacienteDoc): string {
  return p.tem_nome_civil && so(p.nome_civil) ? so(p.nome_civil) : so(p.nome)
}

const CAIXA_MARCADA = "  X  "
const CAIXA_VAZIA = "     "
const caixa = (marcada: boolean | undefined) => (marcada ? CAIXA_MARCADA : CAIXA_VAZIA)

/**
 * "na qualidade de …" do Termo. Só parentescos que dizem a qualidade legal;
 * "Próprio paciente" e "Outro" não dizem, e viram pendência.
 */
export function qualidadeLegal(parentesco: string | null): string | null {
  if (!parentesco) return null
  if (parentesco === "Próprio paciente" || parentesco === "Outro") return null
  return parentesco.toLowerCase()
}

const NAO_SE_APLICA = "Não se aplica (o próprio CONTRATANTE)"

// ─── Montagem ────────────────────────────────────────────────────────────────

export function montarDadosDocumento(e: EntradaDocumento): ResultadoDocumento {
  const tipo = e.contrato.tipo
  if (!temModelo(tipo)) {
    return { ok: false, pendencias: ["Ainda não existe modelo de documento para este tipo de contrato."] }
  }
  const pend: string[] = []
  const exigir = (valor: string, rotulo: string) => {
    if (!valor) pend.push(rotulo)
    return valor
  }
  const vinculo = (t: TipoVinculoResponsavel) => e.vinculos.find((v) => v.tipo === t) ?? null

  const p = e.paciente
  const pac_nome = exigir(nomeDoPaciente(p), "Paciente sem nome")
  const pac_nascimento = exigir(dataBR(p.data_nascimento), "Paciente sem data de nascimento")
  const img = e.contrato.autorizacoes_imagem ?? {}

  const base: Etiquetas = {
    numero: exigir(so(e.contrato.numero), "Contrato sem número"),
    pac_nome,
    pac_nascimento,
    data_extenso: dataPorExtenso(e.hoje),
    img_site: caixa(img.site),
    img_redes: caixa(img.redes),
    img_impressos: caixa(img.impressos),
    img_ensino: caixa(img.ensino),
  }

  if (tipo === "avaliacao_neuropsicologica") {
    const ctrVinculo = vinculo("financeiro") ?? vinculo("filiacao_1")
    if (!ctrVinculo) {
      return {
        ok: false,
        pendencias: ["Sem responsável financeiro nem filiação 1 cadastrados (Cadastro → Filiação e responsáveis)."],
      }
    }
    const r = ctrVinculo.responsavel
    const quem = ctrVinculo.tipo === "financeiro" ? "Responsável financeiro" : "Filiação 1 (contratante)"
    const ctr: Etiquetas = {
      ctr_nome: exigir(so(r.nome), `${quem} sem nome`),
      ctr_cpf: exigir(formatarCpf(r.cpf), `${quem} sem CPF`),
      ctr_rg: exigir(so(r.rg), `${quem} sem RG`),
      ctr_nascimento: exigir(dataBR(r.data_nascimento), `${quem} sem data de nascimento`),
      ctr_endereco: exigir(endereco(r), `${quem} sem endereço`),
      ctr_bairro_cidade_uf: exigir(
        so(r.bairro) && so(r.cidade) && so(r.uf) ? bairroCidadeUf(r) : "",
        `${quem} sem bairro, cidade ou UF`,
      ),
      ctr_cep: exigir(formatarCep(r.cep), `${quem} sem CEP`),
      ctr_celular: exigir(formatarCelular(r.celular) ?? "", `${quem} sem celular`),
      ctr_email: exigir(so(r.email), `${quem} sem e-mail`),
    }

    // Responsável legal: filiação 1, quando não é o próprio contratante.
    const legal = vinculo("filiacao_1")
    const legalDiferente = !!legal && legal.responsavel.id !== r.id
    const leg: Etiquetas = legalDiferente
      ? {
          leg_nome: exigir(so(legal.responsavel.nome), "Filiação 1 (responsável legal) sem nome"),
          leg_cpf: exigir(formatarCpf(legal.responsavel.cpf), "Filiação 1 (responsável legal) sem CPF"),
        }
      : { leg_nome: NAO_SE_APLICA, leg_cpf: "—" }

    const { valor_total, sessoes_max, valor_sessao_avulsa } = e.contrato
    if (!(valor_total && valor_total > 0)) pend.push("Contrato sem valor total")
    if (!(sessoes_max && sessoes_max > 0)) pend.push("Contrato sem limite de sessões")
    if (!(valor_sessao_avulsa && valor_sessao_avulsa > 0)) {
      pend.push(
        "Contrato sem valor da sessão avulsa: cadastre o valor por sessão Particular de Avaliação Neuropsicológica na tabela de valores do Cronograma e edite o rascunho (ou informe em Alterar)",
      )
    }

    const autorizou = !!(img.site || img.redes || img.impressos || img.ensino)
    if (pend.length) return { ok: false, pendencias: pend }
    return {
      ok: true,
      modelo: MODELOS.avaliacao_neuropsicologica,
      dados: {
        ...base,
        ...ctr,
        pac_cpf: formatarCpf(p.cpf) || "—",
        pac_rg: so(p.rg) || "—",
        ...leg,
        sessoes_texto: quantidadeComExtenso(sessoes_max!),
        valor_total: reais(valor_total!),
        valor_extenso: valorPorExtenso(valor_total!),
        valor_avulsa: reais(valor_sessao_avulsa!),
        img_autorizo: caixa(autorizou),
        img_nao_autorizo: caixa(!autorizou),
      },
    }
  }

  // ── Termo de uso de imagem ──
  if (!e.vinculado) {
    pend.push("Termo sem contrato de Terapias vinculado")
  } else if (!so(e.vinculado.numero)) {
    pend.push("O contrato de Terapias vinculado não tem número")
  }

  const r1 = vinculo("filiacao_1")
  if (!r1) {
    pend.push("Sem filiação 1 cadastrada (o autorizante do Termo)")
    return { ok: false, pendencias: pend }
  }
  const r1q = qualidadeLegal(r1.parentesco)
  const autorizante: Etiquetas = {
    r1_nome: exigir(so(r1.responsavel.nome), "Filiação 1 sem nome"),
    r1_cpf: exigir(formatarCpf(r1.responsavel.cpf), "Filiação 1 sem CPF"),
    r1_qualidade: exigir(r1q ?? "", `Filiação 1 com parentesco "${r1.parentesco ?? "vazio"}": o Termo pede a qualidade legal (mãe, pai, tutor(a)…)`),
  }

  const r2 = vinculo("filiacao_2")
  const r2q = r2 ? qualidadeLegal(r2.parentesco) : null
  const segundo: Etiquetas = r2
    ? {
        tem_r2: true,
        r2_nome: exigir(so(r2.responsavel.nome), "Filiação 2 sem nome"),
        r2_cpf: exigir(formatarCpf(r2.responsavel.cpf), "Filiação 2 sem CPF"),
        r2_qualidade: exigir(r2q ?? "", `Filiação 2 com parentesco "${r2.parentesco ?? "vazio"}": o Termo pede a qualidade legal (mãe, pai…)`),
      }
    : { tem_r2: false, r2_nome: "", r2_cpf: "", r2_qualidade: "" }

  if (pend.length) return { ok: false, pendencias: pend }
  const v = e.vinculado!
  return {
    ok: true,
    modelo: MODELOS.termo_uso_imagem,
    dados: {
      ...base,
      vinc_numero: so(v.numero),
      // "firmado em": a data da assinatura; antes dela (Termo enviado junto com
      // o contrato), a data de início.
      vinc_data: v.assinado_em ? dataBRDeTimestamp(v.assinado_em) : dataBR(v.data_inicio),
      ...autorizante,
      ...segundo,
      img_primeiro_nome: caixa(img.primeiro_nome),
    },
  }
}
