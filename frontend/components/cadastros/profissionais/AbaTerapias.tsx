"use client"

import { useMemo, useState } from "react"
import { CalendarClock, Check, CircleAlert, Loader2, Palette, Plus, Sparkles, Undo2 } from "lucide-react"
import { MultiSearchCombobox } from "@/components/cronograma/ui/MultiSearchCombobox"
import { CabecalhoPastel, SecaoPastel, avisoFeito, tom } from "@/components/ui/pastel/pecas"
import type { CadastroTerapia } from "@/types/terapia"
import type { Profissional, TerapiaDoProfissional } from "@/types/profissional"
import { estiloCor } from "./pecas"

// Aba Terapias: o que o profissional pode prestar (a disponibilidade só oferece
// estas) e o que a grade do TiTa mostra que ele presta. A lista é da equipe — a
// importação só a semeia uma vez —, então terapia nova na grade aparece aqui
// como "só no TiTa", com o botão para habilitar.

export function AbaTerapias({
  prof,
  terapias,
  habilitadas,
  catalogo,
  onSalvarHabilitadas,
  onDefinirFocal,
}: {
  prof: Profissional
  terapias: TerapiaDoProfissional[]
  habilitadas: number[]
  catalogo: CadastroTerapia[]
  onSalvarHabilitadas: (ids: number[]) => Promise<boolean>
  onDefinirFocal: (terapiaId: number) => Promise<boolean>
}) {
  const [rascunho, setRascunho] = useState<Set<number> | null>(null)
  const [salvando, setSalvando] = useState(false)
  const selecionadas = rascunho ?? new Set(habilitadas)
  const mudou = rascunho !== null && (rascunho.size !== habilitadas.length || habilitadas.some(id => !rascunho.has(id)))

  const opcoes = useMemo(
    () => catalogo
      .filter(t => t.ativo || habilitadas.includes(t.id))
      .map(t => ({ id: t.id, nome: t.ativo ? t.nome : `${t.nome} (inativa)` })),
    [catalogo, habilitadas]
  )

  const alternar = (id: number) => {
    const n = new Set(selecionadas)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setRascunho(n)
  }

  const salvar = async (ids: number[]) => {
    setSalvando(true)
    const ok = await onSalvarHabilitadas(ids)
    setSalvando(false)
    if (ok) {
      setRascunho(null)
      avisoFeito("Terapias salvas")
    }
  }

  const soNaTita = terapias.filter(t => !t.habilitada && t.terapiaId !== null)
  const semCatalogo = terapias.filter(t => t.terapiaId === null)
  const focalId = terapias[0]?.terapiaId ?? null

  return (
    <div className="space-y-5">
      <SecaoPastel titulo="ter-hab">
        <CabecalhoPastel
          id="ter-hab"
          titulo="Terapias habilitadas"
          t="rosa"
          Icone={Sparkles}
          apoio="Só estas podem ser escolhidas na disponibilidade"
          ajuda={[
            { t: "rosa", Icone: Sparkles, texto: "Habilitada = o profissional tem a formação e pode prestar." },
            { t: "amber", Icone: CalendarClock, texto: "“Só no TiTa” = aparece na grade, mas ainda não foi habilitada aqui." },
            { t: "aco", Icone: Palette, texto: "A estrela escolhe qual cor pinta o card do profissional." },
          ]}
          direita={
            mudou ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => setRascunho(null)} className={`${tom("cinza")} pp-btn pp-btn-suave`} disabled={salvando}>
                  <Undo2 className="h-4 w-4" aria-hidden /> Desfazer
                </button>
                <button type="button" onClick={() => salvar([...selecionadas])} className={`${tom("verde")} pp-btn`} disabled={salvando}>
                  {salvando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Salvar
                </button>
              </div>
            ) : undefined
          }
        />
        <div className="max-w-xl">
          <MultiSearchCombobox
            opcoes={opcoes}
            selecionados={selecionadas}
            onToggle={alternar}
            ariaLabel="Terapias habilitadas"
            nomePlural="terapias"
            placeholder="Nenhuma terapia habilitada"
            resumoCompleto
          />
        </div>

        {terapias.length > 0 && (
          <ul className="mt-5 grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
            {terapias.map(t => {
              const ehFocal = t.terapiaId !== null && t.terapiaId === focalId
              return (
                <li
                  key={t.nome}
                  style={estiloCor(t.cor)}
                  className="relative flex items-center gap-3 rounded-[20px] bg-[var(--pp-surface)] p-3.5 shadow-[var(--pp-sombra),inset_0_0_0_1px_var(--pp-border)]"
                >
                  <span className="h-11 w-11 shrink-0 rounded-[14px] bg-[var(--t-cor)] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-extrabold" title={t.nome}>{t.nome}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[var(--pp-ink-muted)]">
                      {t.habilitada ? (
                        <span className={`${tom("verde")} inline-flex items-center gap-1 text-[var(--c-tinta)]`}><Check className="h-3 w-3" aria-hidden /> Habilitada</span>
                      ) : t.terapiaId === null ? (
                        <span className={`${tom("vermelho")} inline-flex items-center gap-1 text-[var(--c-tinta)]`}><CircleAlert className="h-3 w-3" aria-hidden /> Fora do catálogo</span>
                      ) : (
                        <span className={`${tom("amber")} inline-flex items-center gap-1 text-[var(--c-tinta)]`}><CalendarClock className="h-3 w-3" aria-hidden /> Só no TiTa</span>
                      )}
                      {t.horariosGrade > 0 && <span>· {t.horariosGrade} horário{t.horariosGrade === 1 ? "" : "s"} na grade</span>}
                    </p>
                  </div>
                  {!t.habilitada && t.terapiaId !== null && (
                    <button
                      type="button"
                      onClick={() => salvar([...new Set([...habilitadas, t.terapiaId as number])])}
                      disabled={salvando || mudou}
                      title={mudou ? "Salve ou desfaça a lista acima primeiro" : `Habilitar ${t.nome}`}
                      className={`${tom("aco")} pp-btn pp-btn-suave !min-h-9 !px-3 text-[13px]`}
                    >
                      <Plus className="h-4 w-4" aria-hidden /> Habilitar
                    </button>
                  )}
                  {t.terapiaId !== null && (
                    <button
                      type="button"
                      aria-pressed={ehFocal}
                      onClick={async () => {
                        if (ehFocal || t.terapiaId === null) return
                        if (await onDefinirFocal(t.terapiaId)) avisoFeito(`Card agora em ${t.nome}`)
                      }}
                      title={ehFocal ? "Esta é a cor do card" : `Usar ${t.nome} como cor do card`}
                      aria-label={ehFocal ? `${t.nome} é a cor do card` : `Usar ${t.nome} como cor do card`}
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                        ehFocal
                          ? "bg-[var(--t-suave)] text-[var(--t-tinta)] shadow-[inset_0_0_0_2px_var(--t-linha)] dark:text-[var(--t-tinta-escuro)]"
                          : "text-[var(--pp-ink-muted)] hover:bg-[var(--pp-muted)]"
                      }`}
                    >
                      <Palette className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {terapias.length === 0 && (
          <p className="mt-5 rounded-[20px] bg-[var(--pp-muted)] px-4 py-6 text-center text-sm font-semibold text-[var(--pp-ink-muted)]">
            Nenhuma terapia ainda. Escolha acima o que {prof.nome.split(" ")[0]} pode prestar.
          </p>
        )}

        {(soNaTita.length > 0 || semCatalogo.length > 0) && (
          <p className="mt-4 text-xs font-semibold text-[var(--pp-ink-muted)]">
            {soNaTita.length > 0 && `${soNaTita.length} terapia${soNaTita.length === 1 ? "" : "s"} aparece${soNaTita.length === 1 ? "" : "m"} na grade do TiTa sem estar habilitada${soNaTita.length === 1 ? "" : "s"}. `}
            {semCatalogo.length > 0 && `${semCatalogo.map(t => t.nome).join(", ")} não existe no Cadastro de Terapias — cadastre para poder habilitar.`}
          </p>
        )}
      </SecaoPastel>
    </div>
  )
}
