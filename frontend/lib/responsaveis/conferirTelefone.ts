import "server-only"
import { supabaseService } from "@/lib/supabase/service"

// Indício de autenticidade dos formulários públicos (/ficha-escolar,
// /disponibilidade-paciente): o telefone que o responsável digitou bate com o
// de algum responsável cadastrado do paciente?
//
// Extraído de app/api/ficha-escolar/enviar/route.ts quando o segundo formulário
// público precisou da mesma regra — as duas telas têm de rotular "confere" e
// "verificar" pelo mesmo critério.

/**
 * Últimos 8 dígitos do telefone, ou `null` se não houver 8.
 *
 * `responsaveis.celular` é texto livre — entra como o usuário digitou, misturado
 * com o que veio do TiTa: "(21) 99999-9999", "21999999999", "9999-9999". Comparar
 * as strings cruas diria "não confere" para a mesma pessoa.
 *
 * Os últimos 8 dígitos são o que sobrevive a essa bagunça: descartam DDD (nem
 * sempre presente) e o nono dígito (que o cadastro antigo às vezes não tem).
 * A troca é deliberada — um falso "confere" entre dois números que terminam
 * igual é aceitável para um indício; um falso "não confere" em massa tornaria o
 * sinal inútil.
 */
export function ultimosDigitos(telefone: unknown): string | null {
  if (typeof telefone !== "string") return null

  const digitos = telefone.replace(/\D/g, "")

  return digitos.length >= 8 ? digitos.slice(-8) : null
}

/**
 * `true` bate, `false` não bate, `null` não deu para comparar.
 *
 * O `null` é um estado real e precisa continuar existindo: paciente sem
 * responsável cadastrado, ou cadastrado sem telefone, não é paciente cujo
 * formulário veio de estranho. Colapsar isso em `false` faria a ficha acusar
 * dezenas de envios legítimos.
 */
export async function conferirTelefone(
  pacienteId: number,
  telefoneInformado: string | null
): Promise<boolean | null> {
  const informado = ultimosDigitos(telefoneInformado)

  if (!informado) return null

  const { data, error } = await supabaseService
    .from("pacientes_responsaveis")
    .select("responsaveis(celular, telefone_residencial)")
    .eq("paciente_id", pacienteId)

  if (error || !data || data.length === 0) return null

  // O embed do PostgREST vem como objeto ou array conforme a cardinalidade —
  // normalizar evita depender de qual dos dois chegou.
  const telefones = data.flatMap((vinculo) => {
    const bruto = (vinculo as Record<string, unknown>).responsaveis
    const lista = Array.isArray(bruto) ? bruto : bruto ? [bruto] : []

    return lista.flatMap((r) => {
      const resp = r as { celular?: unknown; telefone_residencial?: unknown }

      return [ultimosDigitos(resp.celular), ultimosDigitos(resp.telefone_residencial)]
    })
  })

  const cadastrados = telefones.filter((t): t is string => t !== null)

  if (cadastrados.length === 0) return null

  return cadastrados.includes(informado)
}
