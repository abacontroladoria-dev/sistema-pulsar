"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { totaisDaSemana, rascunhoDeVersao } from "@/lib/disponibilidadeProfissional"
import { MigrationPendenteError } from "@/services/cadastroTerapias.service"
import { listarEventos, listarVersoes } from "@/services/profissionalDisponibilidade.service"
import type { EventoDisponibilidade, VersaoDisponibilidade } from "@/types/disponibilidadeProfissional"

// Versões e eventos da disponibilidade de UM profissional. A ficha carrega uma
// vez e reparte com o hero, a aba Disponibilidade e a aba Histórico.

export function useDisponibilidadeProfissional(profissionalId: number) {
  const [versoes, setVersoes] = useState<VersaoDisponibilidade[]>([])
  const [eventos, setEventos] = useState<EventoDisponibilidade[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [migrationPendente, setMigrationPendente] = useState(false)

  const recarregar = useCallback(async () => {
    try {
      const [v, e] = await Promise.all([listarVersoes(profissionalId), listarEventos(profissionalId)])
      setVersoes(v)
      setEventos(e)
      setErro(null)
      setMigrationPendente(false)
    } catch (e) {
      setErro(String((e as Error)?.message ?? e))
      setMigrationPendente(e instanceof MigrationPendenteError)
    } finally {
      setLoading(false)
    }
  }, [profissionalId])

  useEffect(() => { void recarregar() }, [recarregar])

  const vigente = useMemo(() => versoes.find(v => v.situacao === "vigente") ?? null, [versoes])
  const proxima = useMemo(
    () => [...versoes].filter(v => v.situacao === "agendada").sort((a, b) => a.vigente_de.localeCompare(b.vigente_de))[0] ?? null,
    [versoes]
  )
  const ultimaEncerrada = useMemo(
    () => [...versoes].filter(v => v.situacao === "encerrada").sort((a, b) => (b.vigente_ate ?? "").localeCompare(a.vigente_ate ?? ""))[0] ?? null,
    [versoes]
  )
  const sessoesSemana = useMemo(() => (vigente ? totaisDaSemana(rascunhoDeVersao(vigente)).sessoes : null), [vigente])

  return { versoes, eventos, vigente, proxima, ultimaEncerrada, sessoesSemana, loading, erro, migrationPendente, recarregar }
}
