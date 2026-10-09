"use client"

import { useEffect, useState } from "react"
import { getPacientes } from "@/services/pacientes.service"
import { getResumoEscolarPorPaciente } from "@/services/pacienteDadosEscolares.service"
import type { ResumoEscolar } from "@/services/pacienteDadosEscolares.service"
import { getPacientesComContrato } from "@/services/pacienteContratos.service"
import { getTelefonesDosResponsaveis } from "@/services/responsaveis.service"
import type { Paciente } from "@/types/paciente"

type PacientesState = {
  pacientes: Paciente[]
  /**
   * `id_paciente` -> celular do responsável de maior prioridade. Vem junto do
   * paciente porque a listagem mostra os dois lado a lado no cartão, e uma
   * segunda rodada de carregamento faria o telefone piscar depois do nome.
   */
  telefonesResponsaveis: Map<number, string>
  /**
   * `id_paciente` -> último envio da ficha escolar. AUSÊNCIA da chave = a
   * família ainda não respondeu; é assim que o dado existe (não há flag em
   * `pacientes`, só linha em `pacientes_dados_escolares`).
   */
  fichasEscolares: Map<number, ResumoEscolar>
  /**
   * A leitura das fichas falhou. Sem isto, um Map vazio por erro de rede seria
   * lido como "nenhuma família respondeu" e a tela acusaria todas elas.
   */
  fichasEscolaresIndisponivel: boolean
  /**
   * `id_paciente` de quem tem ao menos um contrato não cancelado (existência,
   * não vigência). Mesma lógica das fichas: `contratosIndisponivel` separa
   * "não tem" de "não deu para ler".
   */
  pacientesComContrato: Set<number>
  contratosIndisponivel: boolean
  loading: boolean
  error: string | null
}

const INITIAL_STATE: PacientesState = {
  pacientes: [],
  telefonesResponsaveis: new Map(),
  fichasEscolares: new Map(),
  fichasEscolaresIndisponivel: false,
  pacientesComContrato: new Set(),
  contratosIndisponivel: false,
  loading: true,
  error: null,
}

let cachedState: PacientesState | null = null
let inflightFetch: Promise<void> | null = null
const subscribers = new Set<(state: PacientesState) => void>()

function notify(state: PacientesState) {
  cachedState = state
  subscribers.forEach((fn) => fn(state))
}

function fetchPacientes(): Promise<void> {
  if (inflightFetch) return inflightFetch
  // Traz TUDO (fictícios e inativos inclusos) — o único consumidor hoje
  // (PacientesCadastro) decide o que mostrar com o filtro de Situação. Buscar
  // tudo uma vez é mais barato que refazer a requisição a cada combinação do
  // filtro.
  // As três consultas são independentes — em paralelo, e nem telefone nem ficha
  // escolar podem derrubar a listagem: sem responsável cadastrado o cartão só
  // perde uma linha, enquanto sem paciente não há tela. Por isso o erro dessas
  // duas é registrado no console, não propagado para `error`.
  //
  // A ficha escolar usa `allSettled` em vez de engolir o erro com um `.catch`
  // que devolve Map vazio: Map vazio é indistinguível de "ninguém respondeu", e
  // a tela acusaria TODA família de não ter preenchido por causa de uma falha de
  // rede. `fichasEscolaresIndisponivel` deixa a tela dizer "não deu para saber".
  inflightFetch = Promise.all([
    getPacientes({ incluirFicticios: true, incluirInativos: true }),
    getTelefonesDosResponsaveis(),
    Promise.allSettled([getResumoEscolarPorPaciente(), getPacientesComContrato()]),
  ])
    .then(([{ data, error }, telefones, [escolar, contratos]]) => {
      if (contratos.status === "rejected") {
        console.error("Falha ao ler os contratos:", contratos.reason)
      }
      if (escolar.status === "rejected") {
        console.error("Falha ao ler as fichas escolares:", escolar.reason)
      }
      notify({
        pacientes: data,
        telefonesResponsaveis: telefones.data,
        fichasEscolares: escolar.status === "fulfilled" ? escolar.value : new Map(),
        fichasEscolaresIndisponivel: escolar.status === "rejected",
        pacientesComContrato: contratos.status === "fulfilled" ? contratos.value : new Set(),
        contratosIndisponivel: contratos.status === "rejected",
        loading: false,
        error,
      })
    })
    .finally(() => {
      inflightFetch = null
    })
  return inflightFetch
}

// Mesmo padrão de frontend/hooks/useFeriados.ts — cache compartilhado entre
// todas as instâncias do hook montadas ao mesmo tempo.
export function refetchPacientes(): Promise<void> {
  inflightFetch = null
  notify({
    pacientes: cachedState?.pacientes ?? [],
    telefonesResponsaveis: cachedState?.telefonesResponsaveis ?? new Map(),
    fichasEscolares: cachedState?.fichasEscolares ?? new Map(),
    fichasEscolaresIndisponivel: false,
    pacientesComContrato: cachedState?.pacientesComContrato ?? new Set(),
    contratosIndisponivel: false,
    loading: true,
    error: null,
  })
  return fetchPacientes()
}

export function usePacientes() {
  const [state, setState] = useState<PacientesState>(cachedState ?? INITIAL_STATE)

  useEffect(() => {
    subscribers.add(setState)
    if (!cachedState || cachedState.error) {
      fetchPacientes()
    }
    return () => {
      subscribers.delete(setState)
    }
  }, [])

  return state
}
