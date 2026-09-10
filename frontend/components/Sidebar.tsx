"use client"

import {
  LayoutDashboard,
  PlusCircle,
  Users,
  Activity,
  FileText,
  ShieldCheck,
  ClipboardList,
  ClipboardPlus,
  ListChecks,
  Link2,
  CalendarDays,
  UserRound,
  Building2,
  Stethoscope,
  BriefcaseBusiness,
  Star,
  KeyRound,
  Monitor,
  Megaphone,
  BarChart3,
  CalendarPlus,
  Database,
  LogOut,
  TrendingUp,
  UserCheck,
  UserPlus,
  Clock,
  XCircle,
  AlertTriangle,
  CalendarOff,
  BookOpen,
  Settings,
  CalendarRange,
  ClipboardCheck,
  Handshake,
  Wallet,
  RotateCcw,
  DoorOpen,
  ArrowRightLeft,
  Tag,
  Calendar,
  FileSignature,
  Percent,
  History,
  UserSearch,
  Zap,
  Package,
  FileClock,
  CalendarClock,
  Gauge,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { getSupabaseClient } from "@/lib/supabase/client"
import { getFunctionHeaders, getFunctionUrl } from "@/lib/supabase/functions"
import toast from "react-hot-toast"
import ModalPerfil from "@/components/perfil/ModalPerfil"
import ModalAlterarSenha from "@/components/perfil/ModalAlterarSenha"
import ModalErros from "@/components/perfil/ModalErros"
import { SidebarGroup } from "@/components/sidebar/SidebarGroup"
import { ThemeSwitcher } from "@/components/sidebar/ThemeSwitcher"
import { useTheme } from "@/contexts/ThemeContext"
import { useImpersonation } from "@/contexts/ImpersonationContext"
import { ImpersonationSelector } from "@/components/admin/ImpersonationSelector"
import { ROLE_LABELS } from "@/constants/roleLabels"
import { podeAcessarRota, resolverPermissoes } from "@/lib/permissions/resolver"
import { getUsuarioPermissoes } from "@/services/permissoes.service"

type Favorito = { label: string; path: string }

const pathIconMap: Record<string, any> = {
  "/": LayoutDashboard,
  "/solicitar": PlusCircle,
  "/autorizacoes-avulsas": ClipboardPlus,
  "/central-pacientes": Activity,
  "/central-terapeutas": UserRound,
  "/cadastros/pacientes": UserRound,
  "/acompanhamento/laudos": FileClock,
  "/terapeutico/prazos-pdi": CalendarClock,
  "/terapeutico/pdi-painel-analista": Gauge,
  "/auditoria-assim": ClipboardList,
  "/auditoria-assim?tab=auditoria": ClipboardList,
  "/auditoria-assim?tab=reconciliacao": Link2,
  "/cco": BarChart3,
  "/admin": ShieldCheck,
  "/admin/permissoes": KeyRound,
  "/connect": Zap,
  "/tv-avisos": Monitor,
  "/relacionamento-prestador/solicitacoes?tab=simulacao": UserPlus,
  "/relacionamento-prestador/solicitacoes?tab=novo-cron": CalendarPlus,
  "/relacionamento-prestador/solicitacoes?tab=banco": Database,
  "/relacionamento-prestador/ocupacao-salas": DoorOpen,
  "/cadastros/cadastro-valores": Tag,
  "/cadastros/convenios": Building2,
  "/cadastros/feriados": Calendar,
  "/cadastros/contratos": FileSignature,
  "/cadastros/taxas-e-parametros": Percent,
  "/cronograma/saida-profissional": LogOut,
  "/cronograma/ocupacao-paciente": TrendingUp,
  "/relacionamento-prestador/ocupar-profissionais-disponiveis": UserSearch,
  "/cronograma/ocupacao?tab=fila": Clock,
  "/cronograma/ocupacao?tab=recusados": XCircle,
  "/cronograma/ocupacao?tab=inviavel": AlertTriangle,
  "/cronograma/ocupacao?tab=gaps": CalendarOff,
  "/cronograma/ocupacao?tab=inconsistencias": AlertTriangle,
  "/cronograma/ocupacao?tab=guia": BookOpen,
  "/cronograma/ocupacao?tab=config": Settings,
  "/analise-tratativas": ClipboardCheck,
  "/relacionamento-prestador/analise": TrendingUp,
  "/relacionamento-prestador/rp": Wallet,
  "/relacionamento-prestador/individual": UserRound,
  "/relacionamento-prestador/pep": ListChecks,
  "/relacionamento-prestador/pep-historico": History,
  "/cronograma/indicadores?tab=profissionais": BarChart3,
  "/cronograma/indicadores?tab=unidades": Building2,
  "/cronograma/indicadores?tab=pacientes": UserCheck,
  "/cronograma/indicadores?tab=previsao-receitas": Wallet,
  "/cronograma/indicadores?tab=historico-receitas": History,
  "/cronograma/indicadores?tab=comparativo-sessoes": ArrowRightLeft,
}

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = getSupabaseClient()
  const { theme } = useTheme()
  const { isImpersonating, impersonatedTarget, canImpersonate } = useImpersonation()
  const [loadingLogout, setLoadingLogout] = useState(false)
  const [role, setRole] = useState<string | null>(null)
  const [loadingRole, setLoadingRole] = useState(true)
  const [nome, setNome] = useState("Usuário")
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [machineId, setMachineId] = useState<string | null>(null)
  const [automacaoAtiva, setAutomacaoAtiva] = useState(true)
  const [countProcessando, setCountProcessando] = useState(0)
  const [countErros, setCountErros] = useState(0)
  const [loadingPausar, setLoadingPausar] = useState(false)
  const [loadingRetomar, setLoadingRetomar] = useState(false)
  const [loadingReiniciar, setLoadingReiniciar] = useState(false)
  const [loadingLiberar, setLoadingLiberar] = useState(false)
  const [modalPerfil, setModalPerfil] = useState(false)
  const [modalSenha, setModalSenha] = useState(false)
  const [modalErros, setModalErros] = useState(false)
  const [favoritos, setFavoritos] = useState<Favorito[]>([])
  // Guarda os CÓDIGOS, não as rotas já convertidas: `podeAcessarRota` (a mesma do
  // proxy.ts) faz a conversão por dentro, e é o que mantém menu e navegação com
  // uma implementação só.
  const [codigos, setCodigos] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const stored = localStorage.getItem("sidebar_favoritos")
      if (stored) setFavoritos(JSON.parse(stored))
    } catch {}
  }, [])

  function toggleFavorito(label: string, path: string) {
    setFavoritos(prev => {
      const next = prev.some(f => f.path === path)
        ? prev.filter(f => f.path !== path)
        : [...prev, { label, path }]
      localStorage.setItem("sidebar_favoritos", JSON.stringify(next))
      return next
    })
  }

  function isActive(path: string) {
    const [rawPart, queryPart] = path.split("?")
    const pathPart = rawPart.replace(/\/$/, "") || "/"
    const current = pathname.replace(/\/$/, "") || "/"
    if (path === "/connect") return current === "/connect" || current.startsWith("/connect/")
    if (current !== pathPart) return false
    if (!queryPart) return true
    const expected = new URLSearchParams(queryPart)
    for (const [k, v] of expected) {
      if (searchParams.get(k) !== v) return false
    }
    return true
  }

  async function handleLogout() {
    setLoadingLogout(true)
    await supabase.auth.signOut()
    router.replace("/login")
  }

  function canAccess(path: string) {
    if (!role) return false
    // `podeAcessarRota` é a MESMA função do proxy.ts, o gate real da navegação —
    // inclusive o "admin acessa tudo". Enquanto eram duas implementações, o admin
    // abria /autorizacoes-avulsas pelo link e não via o item no menu (o código só
    // está no roleDefaults de `admin` e `recepcao`).
    const [barePath, query] = path.split("?")
    return podeAcessarRota(role, codigos, barePath, query ? `?${query}` : "")
  }

  useEffect(() => {
    let isMounted = true

    async function loadRole() {
      let targetId: string | undefined
      let targetRole: string | null

      if (isImpersonating && impersonatedTarget) {
        targetId = impersonatedTarget.id
        targetRole = impersonatedTarget.role
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          if (isMounted) setLoadingRole(false)
          return
        }
        targetId = user.id
        const { data } = await supabase
          .from("usuarios")
          .select("role")
          .eq("id", user.id)
          .single()
        targetRole = data?.role || null
      }

      if (!isMounted) return

      setRole(targetRole)

      if (!targetRole) {
        setCodigos(new Set())
        setLoadingRole(false)
        return
      }

      // resolverPermissoes é a mesma função usada pelo proxy.ts (gate real das
      // páginas) e pelas rotas de API — regra "defaults do papel + concessões −
      // revogações, revogação vencendo". A conversão para rotas e o "admin acessa
      // tudo" agora também são compartilhados, dentro de `podeAcessarRota`.
      let overrides: { permissao_codigo: string; permitido: boolean }[] = []
      if (targetId) {
        try {
          overrides = await getUsuarioPermissoes(targetId)
        } catch (error) {
          console.error("Erro ao carregar permissões do usuário:", error)
        }
      }

      if (isMounted) {
        setCodigos(resolverPermissoes(targetRole, overrides))
        setLoadingRole(false)
      }
    }

    loadRole()

    return () => {
      isMounted = false
    }
  }, [isImpersonating, impersonatedTarget, supabase])

  useEffect(() => {
    async function checkUser() {
      const { data, error: userError } = await supabase.auth.getUser()
      if (userError || !data.user) return
      const uid = data.user.id
      setUserId(uid)
      setEmail(data.user.email ?? "")
      const { data: maquina, error } = await supabase
        .from("maquinas")
        .select("id, nome, ativa, user_id")
        .eq("user_id", uid)
        .maybeSingle()
      if (error) console.error("Erro ao carregar dados da máquina:", error.message)
      if (maquina) {
        setMachineId(maquina.id)
        setAutomacaoAtiva(maquina.ativa ?? true)
      }
      const { data: perfil } = await supabase
        .from("usuarios")
        .select("nome")
        .eq("id", uid)
        .single()
      if (perfil?.nome) {
        setNome(perfil.nome.split(" ")[0])
      } else {
        setNome(data.user.email?.split("@")[0] || "Usuário")
      }
    }
    checkUser()
  }, [])

  // Os dois badges da fila.
  //
  // Só com a aba visível, e a cada 60 s. A Sidebar existe em toda tela, então
  // este par de contagens é multiplicado por aba aberta — em 24/08 os logs do
  // PostgREST mostram 7 chamadas de cada uma no MESMO segundo, de abas
  // esquecidas abertas, enquanto o banco já estava sem conexão livre. Não foi a
  // causa daquele incidente, mas é tráfego que não serve a ninguém: ninguém lê
  // um badge de aba que não está na frente.
  //
  // Ao voltar o foco a contagem é refeita na hora, senão o badge mostraria por
  // até um minuto um número de antes de a aba ser escondida.
  useEffect(() => {
    let vivo = true

    async function fetchCounts() {
      if (document.visibilityState !== "visible") return
      const [{ count: cp }, { count: ce }] = await Promise.all([
        supabase.from("fila_autorizacoes").select("*", { count: "exact", head: true }).eq("status", "processando"),
        supabase.from("fila_autorizacoes").select("*", { count: "exact", head: true }).eq("status", "erro"),
      ])
      if (!vivo) return
      setCountProcessando(cp ?? 0)
      setCountErros(ce ?? 0)
    }

    fetchCounts()
    const interval = setInterval(fetchCounts, 60000)
    document.addEventListener("visibilitychange", fetchCounts)
    return () => {
      vivo = false
      clearInterval(interval)
      document.removeEventListener("visibilitychange", fetchCounts)
    }
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  async function handlePausar() {
    if (!machineId) { toast.error("Máquina não identificada"); return }
    setLoadingPausar(true)
    try {
      const res = await fetch(getFunctionUrl("automation-pause"), {
        method: "POST",
        headers: await getFunctionHeaders(),
        body: JSON.stringify({ machineId }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setAutomacaoAtiva(false)
      toast.success("Automação pausada")
    } catch (err: any) { toast.error(err.message) }
    setLoadingPausar(false)
  }

  async function handleRetomar() {
    if (!machineId) { toast.error("Máquina não identificada"); return }
    setLoadingRetomar(true)
    try {
      const res = await fetch(getFunctionUrl("automation-resume"), {
        method: "POST",
        headers: await getFunctionHeaders(),
        body: JSON.stringify({ machineId }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setAutomacaoAtiva(true)
      toast.success("Automação retomada")
    } catch (err: any) { toast.error(err.message) }
    setLoadingRetomar(false)
  }

  async function handleReiniciar() {
    if (!machineId) { toast.error("Máquina não identificada"); return }
    setLoadingReiniciar(true)
    try {
      const res = await fetch(getFunctionUrl("automation-restart"), {
        method: "POST",
        headers: await getFunctionHeaders(),
        body: JSON.stringify({ machineId }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success("Worker reiniciado")
    } catch (err: any) { toast.error("Falha ao reiniciar: " + err.message) }
    setLoadingReiniciar(false)
  }

  async function handleLiberarTravados() {
    setLoadingLiberar(true)
    try {
      const res = await fetch(getFunctionUrl("automation-release-stuck"), {
        method: "POST",
        headers: await getFunctionHeaders(),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const plural = json.liberados !== 1 ? "s" : ""
      // `retidas` são as travadas que a função deliberadamente NÃO devolveu para a
      // fila: de outro dia, ou já com guia emitida. Sem dizer isso, um resultado
      // "0 liberados" com 30 travadas na tela parece defeito do botão.
      toast.success(
        `${json.liberados} processo${plural} liberado${plural}` +
        (json.retidas ? ` · ${json.retidas} retido${json.retidas !== 1 ? "s" : ""} (outro dia ou já autorizado)` : "")
      )
    } catch (err: any) { toast.error(err.message) }
    setLoadingLiberar(false)
  }

  function MenuItem({
    label,
    icon: Icon,
    path,
  }: {
    label: string
    icon: any
    path: string
  }) {
    const active = isActive(path)
    const isFav = favoritos.some(f => f.path === path)

    return (
      <Link
        href={path}
        className={`group flex w-full items-center gap-2.5 py-2 pr-2 rounded-lg text-sm transition-all duration-150
        ${
          active
            ? "border-l-2 border-sidebar-primary pl-2.5 font-semibold bg-sidebar-accent text-sidebar-accent-foreground"
            : "border-l-2 border-transparent pl-2.5 text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
        }`}
      >
        <Icon
          size={16}
          className="shrink-0"
          style={{ color: active ? "var(--color-sidebar-primary)" : "var(--color-sidebar-foreground)" }}
        />
        <span className="flex-1 text-left">{label}</span>
        {path !== "/" && (
          <span
            onClick={e => { e.preventDefault(); e.stopPropagation(); toggleFavorito(label, path) }}
            className={`p-1 rounded transition-all duration-150 hover:bg-sidebar-accent
              ${isFav
                ? "opacity-100 text-yellow-500"
                : "opacity-0 group-hover:opacity-100 text-sidebar-foreground/40 hover:text-yellow-500"
              }`}
          >
            <Star size={12} fill={isFav ? "currentColor" : "none"} />
          </span>
        )}
      </Link>
    )
  }

  const isDark = theme === 'dark'

  return (
    <>
      <aside
        className="fixed top-0 left-0 w-64 h-screen flex flex-col z-50 bg-sidebar border-r border-sidebar-border transition-colors duration-300"
      >

        {/* LOGO — lockup do Pulsar.

            Duas imagens trocadas por CSS (`dark:`) em vez de um `src`
            condicional: o tema só é conhecido depois da hidratação, e trocar a
            URL ali faz o navegador buscar o outro arquivo e piscar. Com as duas
            no HTML o swap é imediato e sem requisição extra.

            E não é mais `filter: brightness(0) invert(1)`, que era o jeito de
            clarear o logo antigo: aplicado neste lockup ele achataria tudo em
            branco sólido e apagaria o ponto rosa, que é o único acento de cor
            da marca. A variante clara já existe no repo (a mesma que a /tv usa)
            e preserva o rosa. */}
        <div className="h-20 flex items-center justify-center px-6 border-b border-sidebar-border">
          <img
            src="/pulsar-lockup-1920-transparent.png"
            alt="Pulsar"
            className="max-h-full w-full object-contain dark:hidden"
          />
          {/* `max-h-[60%]` não é chute: os dois arquivos têm exatamente o mesmo
              conteúdo (1133x462), mas o de 1920x768 carrega 39,8% de margem
              transparente embutida e este aqui é recorte justo (0%). Sem
              compensar, a marca aparecia 66% maior no tema escuro e encostava
              nas bordas da barra. 60% ≈ os 60,2% que a arte ocupa no arquivo
              acolchoado, então a marca fica do mesmo tamanho nos dois temas. */}
          <img
            src="/pulsar-lockup-tv-light.png"
            alt=""
            aria-hidden="true"
            className="hidden max-h-[60%] w-full object-contain dark:block"
          />
        </div>

        {/* IMPERSONATION SELECTOR (apenas para admin) */}
        {canImpersonate && (
          <div className="px-3 py-3 border-b border-sidebar-border">
            <ImpersonationSelector />
          </div>
        )}

        {/* MENU */}
        <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-0.5">

          {/* Dashboard */}
          <MenuItem label="Dashboard" icon={LayoutDashboard} path="/" />

          {/* Favoritos */}
          <div className="pt-2">
            <p className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider select-none text-sidebar-foreground/50">
              ⭐ Favoritos
            </p>
            {favoritos
              .filter(f => canAccess(f.path))
              .map(f => (
                <MenuItem key={f.path} label={f.label} icon={pathIconMap[f.path] ?? Star} path={f.path} />
              ))}
          </div>

          <hr className="my-2 border-sidebar-border" />

          {/* Pacientes */}
          {(canAccess("/solicitar") || canAccess("/autorizacoes-avulsas") || canAccess("/central-pacientes") ||
            canAccess("/acompanhamento/laudos")) && (
            <SidebarGroup
              title="Pacientes"
              icon={Users}
              defaultOpen={["/solicitar", "/autorizacoes-avulsas", "/central-pacientes", "/acompanhamento/laudos"].some(p => pathname === p)}
            >
              {canAccess("/solicitar") && (
                <MenuItem label="Atendimentos" icon={PlusCircle} path="/solicitar" />
              )}
              {canAccess("/central-pacientes") && (
                <MenuItem label="Gestão Recepção" icon={Activity} path="/central-pacientes" />
              )}
              {canAccess("/autorizacoes-avulsas") && (
                <MenuItem label="Autorizações Avulsas" icon={ClipboardPlus} path="/autorizacoes-avulsas" />
              )}
              {/* Fila de laudos vencidos + registro do aviso ao responsável.
                  Neste grupo, e não em Autorização (ao lado da Reconciliação) nem
                  em Cadastros: quem trabalha aqui é a recepção, e o grupo
                  Pacientes é onde as outras telas dela já estão. Decisão do
                  usuário em 28/08/2026. */}
              {canAccess("/acompanhamento/laudos") && (
                <MenuItem label="Status dos Laudos" icon={FileClock} path="/acompanhamento/laudos" />
              )}
            </SidebarGroup>
          )}

          {/* Terapêutico */}
          {(canAccess("/central-terapeutas") || canAccess("/analise-tratativas") || canAccess("/terapeutico/prazos-pdi") || canAccess("/terapeutico/pdi-painel-analista")) && (
            <SidebarGroup
              title="Terapêutico"
              icon={Stethoscope}
              defaultOpen={["/central-terapeutas", "/analise-tratativas", "/terapeutico/prazos-pdi", "/terapeutico/pdi-painel-analista"].some(p => pathname === p)}
            >
              {canAccess("/central-terapeutas") && (
                <MenuItem label="Gestão" icon={UserRound} path="/central-terapeutas" />
              )}
              {canAccess("/analise-tratativas") && (
                <MenuItem label="Análise de Evolução" icon={ClipboardCheck} path="/analise-tratativas" />
              )}
              {canAccess("/terapeutico/prazos-pdi") && (
                <MenuItem label="PDI - Controle" icon={CalendarClock} path="/terapeutico/prazos-pdi" />
              )}
              {canAccess("/terapeutico/pdi-painel-analista") && (
                <MenuItem label="PDI - Painel" icon={Gauge} path="/terapeutico/pdi-painel-analista" />
              )}
            </SidebarGroup>
          )}

          {/* Autorização */}
          {(canAccess("/auditoria-assim") || canAccess("/cco")) && (
            <SidebarGroup
              title="Autorização"
              icon={BriefcaseBusiness}
              defaultOpen={pathname === "/cco" || pathname === "/auditoria-assim"}
            >
              {canAccess("/cco") && (
                <MenuItem label="Conciliação ASSIM" icon={BarChart3} path="/cco" />
              )}
              {/* Duas visões da mesma rota. canAccess("/auditoria-assim?tab=…")
                  resolve para o bare path '/auditoria-assim' de CODIGO_PARA_ROTAS,
                  então nenhum código de permissão novo foi necessário.
                  Reconciliação: quem vê a Conferência vê a aba; quem pode VINCULAR
                  é decidido pelas RPCs (admin/autorizacao/recepcao), não aqui —
                  diretoria consulta sem escrever. */}
              {canAccess("/auditoria-assim?tab=auditoria") && (
                <MenuItem label="Conferência ASSIM" icon={ClipboardList} path="/auditoria-assim?tab=auditoria" />
              )}
              {canAccess("/auditoria-assim?tab=reconciliacao") && (
                <MenuItem label="Reconciliação ASSIM" icon={Link2} path="/auditoria-assim?tab=reconciliacao" />
              )}
            </SidebarGroup>
          )}

          {/* Insumos — controle de compras (porte do AXIUM). Grupo próprio, e não
              dentro de Faturamento: aquele grupo é faturamento de convênio
              (ASSIM), este é compra de insumo. Vai crescer com Estoque. */}
          {canAccess("/insumos") && (
            <SidebarGroup title="Suprimentos" icon={Package} defaultOpen={pathname === "/insumos"}>
              <MenuItem label="Solicitações" icon={Package} path="/insumos" />
            </SidebarGroup>
          )}

          {/* Cronograma */}
          {(canAccess("/cronograma/saida-profissional") || canAccess("/cronograma/ocupacao-paciente") ||
            canAccess("/cronograma/ocupacao?tab=oportunidades-recusadas") || canAccess("/cronograma/ocupacao?tab=gaps") ||
            canAccess("/cronograma/ocupacao?tab=inconsistencias") ||
            canAccess("/cronograma/reposicao")) && (
            <SidebarGroup
              title="Cronograma"
              icon={CalendarRange}
              defaultOpen={[
                "/cronograma/saida-profissional",
                "/cronograma/ocupacao-paciente",
                "/cronograma/reposicao",
              ].includes(pathname) || pathname === "/cronograma/ocupacao"}
            >
              {canAccess("/cronograma/saida-profissional") && <MenuItem label="Saída Profissional" icon={LogOut} path="/cronograma/saida-profissional" />}
              {canAccess("/cronograma/ocupacao-paciente") && <MenuItem label="Ocupação Paciente" icon={UserCheck} path="/cronograma/ocupacao-paciente" />}
              {canAccess("/cronograma/reposicao") && <MenuItem label="Reposição de Faltas" icon={RotateCcw} path="/cronograma/reposicao" />}
              {canAccess("/cronograma/ocupacao?tab=oportunidades-recusadas") && <MenuItem label="Oportunidades recusadas" icon={XCircle} path="/cronograma/ocupacao?tab=oportunidades-recusadas" />}
              {canAccess("/cronograma/ocupacao?tab=gaps") && <MenuItem label="Diferença: Laudo e Oferta" icon={BarChart3} path="/cronograma/ocupacao?tab=gaps" />}
              {canAccess("/cronograma/ocupacao?tab=inconsistencias") && <MenuItem label="Inconsistências e Exceções" icon={AlertTriangle} path="/cronograma/ocupacao?tab=inconsistencias" />}
            </SidebarGroup>
          )}

          {/* Indicadores — uma permissão por aba, não uma pra rota inteira */}
          {(canAccess("/cronograma/indicadores?tab=profissionais") ||
            canAccess("/cronograma/indicadores?tab=unidades") ||
            canAccess("/cronograma/indicadores?tab=pacientes") ||
            canAccess("/cronograma/indicadores?tab=previsao-receitas") ||
            canAccess("/cronograma/indicadores?tab=historico-receitas") ||
            canAccess("/cronograma/indicadores?tab=comparativo-sessoes")) && (
            <SidebarGroup title="Indicadores" icon={TrendingUp} defaultOpen={pathname === "/cronograma/indicadores"}>
              {canAccess("/cronograma/indicadores?tab=profissionais") && (
                <MenuItem label="Ocupação de Profissionais" icon={BarChart3} path="/cronograma/indicadores?tab=profissionais" />
              )}
              {canAccess("/cronograma/indicadores?tab=unidades") && (
                <MenuItem label="Ocupação Clínica" icon={Building2} path="/cronograma/indicadores?tab=unidades" />
              )}
              {canAccess("/cronograma/indicadores?tab=pacientes") && (
                <MenuItem label="Dashboard de Pacientes" icon={UserCheck} path="/cronograma/indicadores?tab=pacientes" />
              )}
              {canAccess("/cronograma/indicadores?tab=previsao-receitas") && (
                <MenuItem label="Previsão de Receitas" icon={Wallet} path="/cronograma/indicadores?tab=previsao-receitas" />
              )}
              {canAccess("/cronograma/indicadores?tab=historico-receitas") && (
                <MenuItem label="Histórico de Receitas" icon={History} path="/cronograma/indicadores?tab=historico-receitas" />
              )}
              {canAccess("/cronograma/indicadores?tab=comparativo-sessoes") && (
                <MenuItem label="Comparativo de Sessões" icon={ArrowRightLeft} path="/cronograma/indicadores?tab=comparativo-sessoes" />
              )}
            </SidebarGroup>
          )}

          {/* Cadastros */}
          {(canAccess("/cadastros/cadastro-valores") || canAccess("/cadastros/feriados") ||
            canAccess("/cadastros/contratos") || canAccess("/cadastros/taxas-e-parametros") ||
            canAccess("/cadastros/pacientes") || canAccess("/cadastros/convenios")) && (
            <SidebarGroup
              title="Cadastros"
              icon={Database}
              defaultOpen={pathname.startsWith("/cadastros")}
            >
              {canAccess("/cadastros/pacientes") && <MenuItem label="Pacientes" icon={UserRound} path="/cadastros/pacientes" />}
              {canAccess("/cadastros/convenios") && <MenuItem label="Convênios" icon={Building2} path="/cadastros/convenios" />}
              {canAccess("/cadastros/cadastro-valores") && <MenuItem label="Cadastro de Valores" icon={Tag} path="/cadastros/cadastro-valores" />}
              {canAccess("/cadastros/feriados") && <MenuItem label="Feriados" icon={Calendar} path="/cadastros/feriados" />}
              {canAccess("/cadastros/taxas-e-parametros") && <MenuItem label="Variáveis & Taxas" icon={Percent} path="/cadastros/taxas-e-parametros" />}
              {canAccess("/cadastros/contratos") && <MenuItem label="Contratos" icon={FileSignature} path="/cadastros/contratos" />}
            </SidebarGroup>
          )}

          {/* Relacionamento Prestador */}
          {(canAccess("/relacionamento-prestador/analise") || canAccess("/relacionamento-prestador/rp") ||
            canAccess("/relacionamento-prestador/individual") || canAccess("/relacionamento-prestador/pep") ||
            canAccess("/relacionamento-prestador/pep-historico") ||
            canAccess("/relacionamento-prestador/ocupacao-salas") ||
            canAccess("/relacionamento-prestador/solicitacoes") ||
            canAccess("/relacionamento-prestador/ocupar-profissionais-disponiveis")) && (
            <SidebarGroup
              title="Relacionamento Prestador"
              icon={Handshake}
              defaultOpen={pathname.startsWith("/relacionamento-prestador")}
            >
              {canAccess("/relacionamento-prestador/ocupacao-salas") && (
                <MenuItem label="Ocupação de Salas" icon={DoorOpen} path="/relacionamento-prestador/ocupacao-salas" />
              )}
              {canAccess("/relacionamento-prestador/solicitacoes") && (
                <MenuItem label="Simulação de Novo Prestador" icon={UserPlus} path="/relacionamento-prestador/solicitacoes?tab=simulacao" />
              )}
              {canAccess("/relacionamento-prestador/ocupar-profissionais-disponiveis") && (
                <MenuItem label="Ocupar Profissionais Disponíveis" icon={UserSearch} path="/relacionamento-prestador/ocupar-profissionais-disponiveis" />
              )}
              {canAccess("/relacionamento-prestador/analise") && (
                <MenuItem label="Rem. Mês - Previsão" icon={TrendingUp} path="/relacionamento-prestador/analise" />
              )}
              {canAccess("/relacionamento-prestador/rp") && (
                <MenuItem label="Remuneração Total" icon={Wallet} path="/relacionamento-prestador/rp" />
              )}
              {canAccess("/relacionamento-prestador/individual") && (
                <MenuItem label="Remuneração Individual" icon={UserRound} path="/relacionamento-prestador/individual" />
              )}
              {canAccess("/relacionamento-prestador/pep") && (
                <MenuItem label="Entregas PEP" icon={ListChecks} path="/relacionamento-prestador/pep" />
              )}
              {canAccess("/relacionamento-prestador/pep-historico") && (
                <MenuItem label="PEP - Histórico" icon={History} path="/relacionamento-prestador/pep-historico" />
              )}
            </SidebarGroup>
          )}

          {/* Marketing */}
          {/* Grupo PRÓPRIO, e não um item dentro de Administração (onde nasceu):
              quem opera isto é o marketing, que não administra o sistema — o
              único vizinho ali seriam Usuários e Permissões, telas que este setor
              nunca vai abrir. E o rótulo do item diz o LUGAR ("TV da Recepção"),
              não o meio: a única dúvida de quem prepara um cartaz é onde ele vai
              aparecer. */}
          {canAccess("/tv-avisos") && (
            <SidebarGroup
              title="Marketing"
              icon={Megaphone}
              defaultOpen={pathname === "/tv-avisos"}
            >
              <MenuItem label="TV da Recepção" icon={Monitor} path="/tv-avisos" />
            </SidebarGroup>
          )}

          {/* Administração */}
          {/* "Usuários" é condicional, e não incondicional como já foi: sem isso
              apareceria para quem não tem /admin. */}
          {canAccess("/admin") && (
            <SidebarGroup
              title="Administração"
              icon={ShieldCheck}
              defaultOpen={["/admin", "/admin/permissoes"].some(p => pathname === p)}
            >
              {canAccess("/admin") && (
                <MenuItem label="Usuários" icon={Users} path="/admin" />
              )}
              {canAccess("/admin/permissoes") && (
                <MenuItem label="Permissões" icon={KeyRound} path="/admin/permissoes" />
              )}
            </SidebarGroup>
          )}

          {/* Pulsar Connect — o proxy só libera /connect para admin ou para quem
              recebeu a permissão `connect`. Antes o item aparecia para todos e
              levava a /sem-permissao. */}
          {canAccess("/connect") && (
            <>
              <hr className="my-2 border-sidebar-border" />
              <MenuItem label="Pulsar Connect" icon={Zap} path="/connect" />
            </>
          )}

        </nav>

        {/* THEME SWITCHER */}
        <div className="px-4 pb-3">
          <ThemeSwitcher />
        </div>

        {/* FOOTER — PERFIL */}
        <div className="p-4 border-t border-sidebar-border" ref={menuRef}>
          <div className="relative">

            <button
              onClick={() => setOpen(!open)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-sidebar-accent/60 transition-colors duration-150 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-full bg-sidebar-primary text-white flex items-center justify-center font-semibold text-sm shrink-0">
                {nome?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-semibold text-sidebar-foreground truncate leading-tight">{nome}</p>
                {role && (
                  <p className={`text-xs capitalize leading-tight ${isImpersonating ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-sidebar-foreground/50'}`}>
                    {isImpersonating ? '👁️ ' : ''}
                    {ROLE_LABELS[role] ?? role}
                  </p>
                )}
              </div>
              <span className={`text-sidebar-foreground/40 text-xs transition-transform duration-200 shrink-0 ${open ? "rotate-180" : ""}`}>
                ▼
              </span>
            </button>

            {open && (
              <div className={`absolute bottom-full left-0 mb-2 w-72 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.15)] p-3 text-sm z-999
                ${isDark
                  ? "bg-linear-to-br from-[#1f3f5b] to-[#2f6f95] text-white"
                  : "bg-white border border-sidebar-border text-slate-800"
                }`}
              >

                <div className="px-3 pb-3">
                  <div className="text-sm font-semibold">{nome}</div>
                  <div className={`text-xs ${isDark ? "text-white/60" : "text-slate-500"}`}>{email || "—"}</div>
                </div>

                <div className={`border-t my-2 ${isDark ? "border-white/10" : "border-slate-100"}`} />

                <div className={`px-3 text-xs mb-1 ${isDark ? "text-white/50" : "text-slate-400"}`}>Conta</div>

                <button
                  onClick={() => { setOpen(false); setModalPerfil(true) }}
                  className={`w-full text-left px-3 py-2 rounded-lg transition ${isDark ? "hover:bg-white/10 active:bg-white/20" : "hover:bg-slate-50 active:bg-slate-100"}`}
                >
                  Meu perfil
                </button>

                <button
                  onClick={() => { setOpen(false); setModalSenha(true) }}
                  className={`w-full text-left px-3 py-2 rounded-lg transition ${isDark ? "hover:bg-white/10 active:bg-white/20" : "hover:bg-slate-50 active:bg-slate-100"}`}
                >
                  Alterar senha
                </button>

                <div className={`border-t my-2 ${isDark ? "border-white/10" : "border-slate-100"}`} />

                <div className={`px-3 py-2 text-xs flex justify-between mb-1 ${isDark ? "text-white/50" : "text-slate-400"}`}>
                  <span>Automação</span>
                  <span className={`flex items-center gap-2 font-medium ${automacaoAtiva ? "text-green-500" : "text-orange-500"}`}>
                    <span className={`w-2 h-2 rounded-full ${automacaoAtiva ? "bg-green-400" : "bg-orange-400"}`} />
                    {automacaoAtiva ? "Ativa" : "Pausada"}
                  </span>
                </div>

                {automacaoAtiva ? (
                  <button
                    onClick={handlePausar}
                    disabled={loadingPausar}
                    className={`w-full text-left px-3 py-2 rounded-lg transition disabled:opacity-50 ${isDark ? "hover:bg-white/10" : "hover:bg-slate-50"}`}
                  >
                    {loadingPausar ? "Pausando..." : "Pausar automação"}
                  </button>
                ) : (
                  <button
                    onClick={handleRetomar}
                    disabled={loadingRetomar}
                    className={`w-full text-left px-3 py-2 rounded-lg transition disabled:opacity-50 ${isDark ? "hover:bg-white/10" : "hover:bg-slate-50"}`}
                  >
                    {loadingRetomar ? "Retomando..." : "Retomar automação"}
                  </button>
                )}

                <button
                  onClick={handleReiniciar}
                  disabled={loadingReiniciar}
                  className={`w-full text-left px-3 py-2 rounded-lg transition disabled:opacity-50 ${isDark ? "hover:bg-white/10" : "hover:bg-slate-50"}`}
                >
                  {loadingReiniciar ? "Reiniciando..." : "Reiniciar worker"}
                </button>

                <button
                  onClick={handleLiberarTravados}
                  disabled={loadingLiberar}
                  className={`w-full text-left px-3 py-2 rounded-lg transition disabled:opacity-50 ${isDark ? "hover:bg-white/10" : "hover:bg-slate-50"}`}
                >
                  {loadingLiberar ? "Liberando..." : "Liberar processos travados"}
                </button>

                <div className={`border-t my-2 ${isDark ? "border-white/10" : "border-slate-100"}`} />

                <div className={`px-3 py-2 text-xs flex justify-between ${isDark ? "text-white/70" : "text-slate-500"}`}>
                  <span>{countProcessando} em processamento</span>
                  {countErros > 0 ? (
                    <button
                      onClick={() => { setOpen(false); setModalErros(true) }}
                      className="text-red-500 font-medium hover:text-red-600 transition"
                    >
                      {countErros} erro{countErros !== 1 ? "s" : ""}
                    </button>
                  ) : (
                    <span className={isDark ? "text-white/40" : "text-slate-400"}>0 erros</span>
                  )}
                </div>

                <div className={`border-t my-2 ${isDark ? "border-white/10" : "border-slate-100"}`} />

                <button
                  onClick={handleLogout}
                  disabled={loadingLogout}
                  className="w-full text-left px-3 py-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingLogout ? "Saindo..." : "Sair"}
                </button>

              </div>
            )}

          </div>
        </div>

      </aside>

      {userId && (
        <>
          <ModalPerfil open={modalPerfil} onClose={() => setModalPerfil(false)} userId={userId} />
          <ModalAlterarSenha open={modalSenha} onClose={() => setModalSenha(false)} email={email} />
        </>
      )}
      <ModalErros open={modalErros} onClose={() => setModalErros(false)} />
    </>
  )
}
