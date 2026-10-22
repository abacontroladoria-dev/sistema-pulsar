import { ORIGEM_PUBLICA } from "./disponibilidadePaciente"

// Link do formulário escolar (/ficha-escolar). Um link só para todas as
// famílias: quem abre busca a criança pelo nome e confirma a data de nascimento.

export const CAMINHO_FORMULARIO_ESCOLAR = "/ficha-escolar/"

export function linkFormularioEscolar(): string {
  return `${ORIGEM_PUBLICA}${CAMINHO_FORMULARIO_ESCOLAR}`
}

/** Mensagem de WhatsApp. Sem nome, sai genérica. */
export function mensagemFormularioEscolar(pacienteNome?: string | null): string {
  const primeiro = (pacienteNome ?? "").trim().split(/\s+/)[0] ?? ""
  const de = primeiro ? ` de ${primeiro}` : ""
  return `Olá! Para conhecermos a rotina escolar${de}, preencha os dados da escola neste link: ${linkFormularioEscolar()} — busque pelo nome da criança e confirme a data de nascimento.`
}
