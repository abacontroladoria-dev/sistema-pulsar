import "server-only"

import { readFile } from "node:fs/promises"
import path from "node:path"
import { supabaseService } from "@/lib/supabase/service"
import { hojeBrasilia, ROTULO_TIPO, type TipoContrato } from "@/lib/contratos/status"
import {
  montarDadosDocumento,
  type ContratoDoc,
  type PacienteDoc,
  type VinculadoDoc,
  type VinculoDoc,
} from "@/lib/contratos/documento/montarDados"
import { preencherModelo } from "@/lib/contratos/documento/preencher"

// O documento preenchido de UM contrato do paciente: lê o cadastro, monta as
// etiquetas e preenche o modelo. Nada é gravado — o arquivo é gerado a cada
// pedido (decisão do usuário, 09/10/2026: sem PDF guardado neste tema; o
// documento final vive na D4Sign, fase 3, que recebe este mesmo .docx).
//
// service_role: precisa de CPF/RG/endereço do responsável. A checagem de
// acesso (cadastros_pacientes) é a da rota.

/** Modelos ficam em lib/contratos/modelos/ — ver outputFileTracingIncludes no next.config. */
const PASTA_MODELOS = path.join(process.cwd(), "lib", "contratos", "modelos")

const COLUNAS_RESPONSAVEL =
  "id, nome, cpf, rg, data_nascimento, celular, email, cep, logradouro, numero, complemento, bairro, cidade, uf"

export type DocumentoGerado =
  | { ok: true; arquivo: Buffer; nomeArquivo: string }
  | { ok: false; status: 404 | 422; mensagem: string; pendencias: string[] }

export async function gerarDocumentoDoContrato(contratoId: number): Promise<DocumentoGerado> {
  const sb = supabaseService

  const { data: c, error: eC } = await sb
    .from("pacientes_contratos")
    .select("id, paciente_id, tipo, numero, valor_total, sessoes_max, valor_sessao_avulsa, contrato_vinculado_id, autorizacoes_imagem")
    .eq("id", contratoId)
    .eq("ativo", true)
    .maybeSingle()
  if (eC) throw new Error(`contrato: ${eC.message}`)
  if (!c) return { ok: false, status: 404, mensagem: "Contrato não encontrado.", pendencias: [] }

  const [pac, vin, vinculado] = await Promise.all([
    sb
      .from("pacientes")
      .select("nome, nome_civil, tem_nome_civil, cpf, rg, data_nascimento")
      .eq("id_paciente", c.paciente_id)
      .maybeSingle(),
    sb
      .from("pacientes_responsaveis")
      .select(`tipo, parentesco, responsavel:responsaveis(${COLUNAS_RESPONSAVEL})`)
      .eq("paciente_id", c.paciente_id),
    c.contrato_vinculado_id
      ? sb
          .from("pacientes_contratos")
          .select("numero, data_inicio, assinado_em")
          .eq("id", c.contrato_vinculado_id)
          .eq("ativo", true)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (pac.error) throw new Error(`paciente: ${pac.error.message}`)
  if (vin.error) throw new Error(`responsáveis: ${vin.error.message}`)
  if (vinculado.error) throw new Error(`contrato vinculado: ${vinculado.error.message}`)
  if (!pac.data) return { ok: false, status: 404, mensagem: "Paciente não encontrado.", pendencias: [] }

  // `as unknown as`: os tipos gerados do Supabase não acompanham migrations novas.
  const contrato = c as unknown as ContratoDoc
  const resultado = montarDadosDocumento({
    contrato: {
      ...contrato,
      valor_total: c.valor_total == null ? null : Number(c.valor_total),
      valor_sessao_avulsa: c.valor_sessao_avulsa == null ? null : Number(c.valor_sessao_avulsa),
    },
    paciente: pac.data as unknown as PacienteDoc,
    // Vínculo com responsável inativo/apagado chega com `responsavel` nulo.
    vinculos: ((vin.data ?? []) as unknown as VinculoDoc[]).filter((v) => v.responsavel),
    vinculado: (vinculado.data ?? null) as VinculadoDoc | null,
    hoje: hojeBrasilia(),
  })
  if (!resultado.ok) {
    return {
      ok: false,
      status: 422,
      mensagem: "Complete o cadastro antes de gerar o documento.",
      pendencias: resultado.pendencias,
    }
  }

  const modelo = await readFile(path.join(PASTA_MODELOS, resultado.modelo))
  const arquivo = preencherModelo(modelo, resultado.dados)
  // Sem nome do paciente no nome do arquivo (mesma regra dos caminhos de
  // storage): o arquivo baixado circula por WhatsApp, e-mail, pasta de Downloads.
  const nomeArquivo = `${c.numero} - ${ROTULO_TIPO[c.tipo as TipoContrato]}.docx`
  return { ok: true, arquivo, nomeArquivo }
}
