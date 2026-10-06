"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import toast from "react-hot-toast"
import { refetchProfissionais } from "@/hooks/useProfissionais"
import { MigrationPendenteError } from "@/services/cadastroTerapias.service"
import {
  atualizarProfissional, getProfissional, listarHabilitadas, listarTerapiasDaGrade, salvarHabilitadas,
} from "@/services/profissionais.service"
import type { Profissional, ProfissionalEdit } from "@/types/profissional"

// Estado da ficha do profissional: o registro, o formulário da aba Cadastro
// (com os campos alterados), as terapias habilitadas e as vistas na grade TiTa.

export const CAMPOS_EDITAVEIS: (keyof ProfissionalEdit)[] = [
  "nome", "cpf", "email", "celular",
  "tipo_registro", "uf_registro", "codigo_registro", "cbo",
  "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf",
  "observacoes",
]

export type FormProfissional = Pick<ProfissionalEdit, (typeof CAMPOS_EDITAVEIS)[number]>

function formDe(p: Profissional): FormProfissional {
  return Object.fromEntries(CAMPOS_EDITAVEIS.map(c => [c, p[c] ?? null])) as FormProfissional
}

/** Vazio e só-espaço contam como null — senão "" vs null acusaria alteração. */
function igual(a: unknown, b: unknown): boolean {
  const n = (v: unknown) => (typeof v === "string" ? v.trim() || null : v ?? null)
  return n(a) === n(b)
}

/** Validação local, espelho dos CHECKs da tabela — a mensagem aparece no campo, antes de ir ao banco. */
export function errosDoForm(f: FormProfissional): Partial<Record<keyof FormProfissional, string>> {
  const e: Partial<Record<keyof FormProfissional, string>> = {}
  const dig = (v: string | null) => (v ?? "").replace(/\D/g, "")
  if ((f.nome ?? "").trim().length < 2) e.nome = "Informe o nome."
  if (f.cpf && dig(f.cpf).length !== 11) e.cpf = "O CPF tem 11 dígitos."
  if (f.celular && (dig(f.celular).length < 10 || dig(f.celular).length > 13)) e.celular = "DDD + número."
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) e.email = "E-mail inválido."
  if (f.cep && dig(f.cep).length !== 8) e.cep = "O CEP tem 8 dígitos."
  if ((f.cbo ?? "").length > 10) e.cbo = "No máximo 10 caracteres."
  if ((f.codigo_registro ?? "").length > 40) e.codigo_registro = "No máximo 40 caracteres."
  return e
}

export function useProfissionalDetalhe(id: number) {
  const [prof, setProf] = useState<Profissional | null>(null)
  const [form, setForm] = useState<FormProfissional | null>(null)
  const [habilitadas, setHabilitadas] = useState<number[]>([])
  const [grade, setGrade] = useState<{ terapia: string; horarios: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [migrationPendente, setMigrationPendente] = useState(false)
  const [naoEncontrado, setNaoEncontrado] = useState(false)
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const p = await getProfissional(id)
      if (!p) {
        setNaoEncontrado(true)
        setLoading(false)
        return
      }
      const [hab, gr] = await Promise.all([
        listarHabilitadas(id),
        p.tita_profissional_id ? listarTerapiasDaGrade(p.tita_profissional_id).catch(() => null) : Promise.resolve(null),
      ])
      setProf(p)
      setForm(formDe(p))
      setHabilitadas(hab.get(id) ?? [])
      setGrade(gr?.get(p.tita_profissional_id ?? -1) ?? [])
      setErro(null)
    } catch (e) {
      setErro(String((e as Error)?.message ?? e))
      setMigrationPendente(e instanceof MigrationPendenteError)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void carregar() }, [carregar])

  const camposSujos = useMemo(() => {
    if (!prof || !form) return [] as (keyof FormProfissional)[]
    return CAMPOS_EDITAVEIS.filter(c => !igual(form[c], prof[c]))
  }, [prof, form])

  const set = useCallback((patch: Partial<FormProfissional>) => {
    setForm(f => (f ? { ...f, ...patch } : f))
  }, [])

  const descartar = useCallback(() => {
    if (prof) setForm(formDe(prof))
  }, [prof])

  /** Devolve true quando gravou (o guarda de navegação depende disso). */
  const salvar = useCallback(async (): Promise<boolean> => {
    if (!prof || !form || !camposSujos.length) return true
    const erros = errosDoForm(form)
    if (Object.keys(erros).length) {
      toast.error("Corrija os campos destacados antes de salvar.")
      return false
    }
    setSalvando(true)
    try {
      const patch = Object.fromEntries(
        camposSujos.map(c => [c, typeof form[c] === "string" ? (form[c] as string).trim() || null : form[c]])
      ) as Partial<ProfissionalEdit>
      const novo = await atualizarProfissional(prof, patch)
      setProf(novo)
      setForm(formDe(novo))
      void refetchProfissionais()
      toast.success("Cadastro salvo.")
      return true
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e))
      return false
    } finally {
      setSalvando(false)
    }
  }, [prof, form, camposSujos])

  /** Grava ativo/inativo ou a terapia da cor do card, fora do modo de edição. */
  const gravarDireto = useCallback(async (patch: Pick<Partial<ProfissionalEdit>, "ativo" | "terapia_focal_id">) => {
    if (!prof) return false
    try {
      const novo = await atualizarProfissional(prof, patch)
      setProf(novo)
      void refetchProfissionais()
      return true
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e))
      return false
    }
  }, [prof])

  const gravarHabilitadas = useCallback(async (novas: number[], nomes: Map<number, string>) => {
    if (!prof) return false
    try {
      await salvarHabilitadas(prof, habilitadas, novas, nomes)
      setHabilitadas(novas)
      void refetchProfissionais()
      return true
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e))
      // A lista pode ter sido gravada pela metade: relê do banco.
      const hab = await listarHabilitadas(prof.id).catch(() => null)
      if (hab) setHabilitadas(hab.get(prof.id) ?? [])
      return false
    }
  }, [prof, habilitadas])

  return {
    prof, form, set, habilitadas, grade,
    loading, erro, migrationPendente, naoEncontrado,
    camposSujos, salvando, salvar, descartar, gravarDireto, gravarHabilitadas,
    recarregar: carregar,
  }
}
