"use client";

import { useState } from "react"
import { getSupabaseClient } from "@/lib/supabase/client";
import { mensagemDoSegundoFator } from "@/lib/auth/mensagensSegundoFator";
import { Eye, EyeOff, User, Lock, ArrowRight, Smartphone } from "lucide-react";

export default function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");
  // Segundo passo: quem cadastrou o app autenticador digita o código depois da
  // senha. `destino` guarda para onde ir depois de confirmar.
  const [etapaCodigo, setEtapaCodigo] = useState<{ factorId: string; destino: string } | null>(null);
  const [codigo, setCodigo] = useState("");
  const supabase = getSupabaseClient()

  async function handleCodigo(e: React.FormEvent) {
    e.preventDefault();
    if (!etapaCodigo || codigo.length !== 6) return;
    setErro("");
    setLoading(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: etapaCodigo.factorId, code: codigo });
    if (error) {
      setErro(mensagemDoSegundoFator(error));
      setLoading(false);
      return;
    }
    window.location.href = etapaCodigo.destino
  }

  async function voltarParaSenha() {
    await supabase.auth.signOut();
    setEtapaCodigo(null);
    setCodigo("");
    setSenha("");
    setErro("");
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setLoading(true);

    try {
      let emailParaLogin = login

      if (!login.includes("@")) {
        // RPC, e não SELECT direto em `usuarios`: este passo roda antes de
        // autenticar, ou seja como `anon`. Com RLS ligada na tabela não existe
        // policy pra anon e a leitura voltaria vazia — todo login por username
        // passaria a dizer "Usuário não encontrado" com a senha certa.
        // email_por_username é SECURITY DEFINER e responde só o email.
        const { data: emailDoUsuario, error: erroBusca } = await supabase
          .rpc("email_por_username", { p_username: login })

        if (erroBusca || !emailDoUsuario) {
          setErro("Usuário não encontrado. Verifique e tente novamente.");
          setLoading(false);
          return;
        }
        emailParaLogin = emailDoUsuario
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailParaLogin,
        password: senha,
      });

      if (error) {
        setErro(error.message || "Login ou senha incorretos. Verifique e tente novamente.");
        setLoading(false);
        return;
      }

      if (!data?.user) {
        setErro("Login ou senha incorretos. Verifique e tente novamente.");
        setLoading(false);
        return;
      }

      const { data: perfil, error: perfilError } = await supabase
        .from('usuarios')
        .select('role')
        .eq('id', data.user.id)
        .single()

      if (perfilError) {
        setErro("Erro ao carregar perfil. Tente novamente.");
        setLoading(false);
        return;
      }

      if (!perfil) {
        setErro("Perfil de usuário não encontrado. Contate o administrador.");
        setLoading(false);
        return;
      }

      const redirectUrl = perfil.role === 'disponibilidade_terapeuta' ? '/disponibilidade-terapeuta/' : '/'

      // Tem app autenticador cadastrado: a sessão só vale por inteiro (aal2)
      // depois do código. Sem fator, segue como sempre.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        const { data: fatores } = await supabase.auth.mfa.listFactors()
        const fator = fatores?.totp?.[0]
        if (fator) {
          setEtapaCodigo({ factorId: fator.id, destino: redirectUrl })
          setLoading(false)
          return
        }
      }

      window.location.href = redirectUrl
    } catch (err) {
      setErro("Erro ao fazer login. Tente novamente.");
      setLoading(false);
    }
  }


  return (
    <main
      className="min-h-dvh flex flex-col items-center justify-center relative px-4 py-8 overflow-hidden"
      style={{ background: "radial-gradient(ellipse 120% 80% at 50% -10%, #2a6080 0%, #1a3a55 45%, #0f2540 100%)" }}
    >

      {/* Dot grid */}
      <div
        className="absolute inset-0 pointer-events-none select-none"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(58,143,183,0.10) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          WebkitMaskImage: "radial-gradient(ellipse 110% 90% at 50% 50%, black 30%, transparent 85%)",
          maskImage: "radial-gradient(ellipse 110% 90% at 50% 50%, black 30%, transparent 85%)",
        }}
      />

      {/* Card */}
      <div
        className="relative w-full max-w-3xl rounded-3xl overflow-hidden"
        style={{
          boxShadow: [
            "0 4px 8px rgba(0,0,0,0.15)",
            "0 12px 24px rgba(0,0,0,0.3)",
            "0 32px 56px rgba(0,0,0,0.45)",
            "0 64px 100px rgba(0,0,0,0.5)",
            "0 0 0 1px rgba(255,255,255,0.09)",
            "0 0 80px rgba(58,143,183,0.1)",
          ].join(", "),
        }}
      >

        {/* Reflexo de luz no topo */}
        <div
          className="pointer-events-none"
          style={{
            height: "1px",
            background: "linear-gradient(90deg, transparent 5%, rgba(255,255,255,0.55) 50%, transparent 95%)",
          }}
        />

        <div className="grid sm:grid-cols-[5fr_7fr]">

          {/* Painel esquerdo: logo com gradiente elegante */}
          <div
            className="hidden sm:flex flex-col items-center justify-center gap-4 p-10"
            style={{
              background: "linear-gradient(135deg, #e6f2f9 0%, #dfe8f5 45%, #f0e8f9 100%)",
              borderRight: "1px solid rgba(58, 143, 183, 0.15)",
              position: "relative",
              overflow: "hidden"
            }}
          >
            {/* Efeito de luz sutil - roxo */}
            <div
              style={{
                position: "absolute",
                top: "-40%",
                right: "-10%",
                width: "200px",
                height: "200px",
                background: "radial-gradient(circle, rgba(138, 43, 226, 0.06) 0%, transparent 70%)",
                pointerEvents: "none"
              }}
            />
            {/* Efeito de luz sutil - azul */}
            <div
              style={{
                position: "absolute",
                bottom: "-20%",
                left: "-5%",
                width: "150px",
                height: "150px",
                background: "radial-gradient(circle, rgba(58, 143, 183, 0.05) 0%, transparent 70%)",
                pointerEvents: "none"
              }}
            />
            {/* w-64 e não w-44 pelo mesmo motivo do logo mobile: ~40% da
                largura do arquivo é margem transparente. Sem `drop-shadow-sm`
                — sombra sob um lockup vazado marca o contorno de cada letra,
                não o bloco; no logo anterior, opaco, isso não aparecia. */}
            <img
              src="/pulsar-lockup-1920-transparent.png"
              alt="Pulsar"
              className="w-64 h-auto object-contain relative z-10"
            />
          </div>

          {/* Painel direito: formulário com fundo limpo */}
          <div
            className="px-8 sm:px-10 pt-8 pb-10 relative"
            style={{
              backgroundColor: '#FFFFFF',
              background: "linear-gradient(135deg, #ffffff 0%, #fafbfc 100%)"
            }}
          >

            {/* Logo mobile — h-28 e não h-20: o lockup carrega ~40% de margem
                transparente embutida, então na mesma altura a marca sairia
                menor que o logo anterior. */}
            <div className="flex justify-center mb-6 sm:hidden">
              <img
                src="/pulsar-lockup-1920-transparent.png"
                alt="Pulsar"
                className="h-28 w-auto object-contain"
              />
            </div>

            <div className="mb-7">
              <h1 id="page-title" className="text-2xl font-bold text-balance leading-tight" style={{ color: '#1e5a7d' }}>
                Clínica Universo ABA
              </h1>
            </div>

            {/* aria-label explícito em vez de apontar para o h1: o título agora
                nomeia a clínica, e "Clínica Universo ABA" sozinho não diz a um
                leitor de tela o que este formulário faz. O h1 segue com o id
                porque é referência estável da página. */}
            {etapaCodigo ? (
            <form onSubmit={handleCodigo} aria-label="Código do app autenticador" className="space-y-5">

              {erro && (
                <div
                  id="login-error"
                  role="alert"
                  className="border text-sm px-4 py-3 rounded-xl font-medium"
                  style={{
                    backgroundColor: '#fef2f2',
                    borderColor: '#fecaca',
                    color: '#dc2626',
                  }}
                >
                  {erro}
                </div>
              )}

              <div>
                <label htmlFor="codigo-field" className="text-sm font-semibold" style={{ color: '#1e5a7d' }}>
                  Código do app autenticador
                </label>
                <p className="text-sm text-slate-500 mt-1">Abra o app no celular e digite os 6 números que aparecem agora.</p>
                <div className="relative mt-2">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none" style={{ color: '#3a8fb7' }}>
                    <Smartphone size={18} aria-hidden="true" />
                  </span>
                  <input
                    id="codigo-field"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    value={codigo}
                    onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    aria-invalid={erro ? true : undefined}
                    aria-describedby={erro ? "login-error" : undefined}
                    className="w-full rounded-xl pl-11 pr-4 py-3.5 text-lg tracking-[0.4em] tabular-nums text-slate-800 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:border-transparent aria-invalid:border-rose-300 transition-all"
                    style={{ border: '1.5px solid #e0e7ff', backgroundColor: '#f9fbfd' }}
                  />
                </div>
              </div>

              <div className="pt-1 space-y-3">
                <button
                  type="submit"
                  disabled={loading || codigo.length !== 6}
                  className="w-full h-13 text-white rounded-xl text-base font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2"
                  style={{ background: 'linear-gradient(135deg, #2a8ba8 0%, #1e5a7d 100%)' }}
                >
                  {loading ? "Confirmando…" : (<><span>Confirmar</span><ArrowRight size={18} aria-hidden="true" /></>)}
                </button>
                <button
                  type="button"
                  onClick={voltarParaSenha}
                  className="w-full text-sm font-semibold py-2 rounded-xl hover:bg-slate-50 transition"
                  style={{ color: '#1e5a7d' }}
                >
                  Entrar com outro usuário
                </button>
              </div>
            </form>
            ) : (
            <form onSubmit={handleLogin} aria-label="Acessar o Sistema Pulsar" className="space-y-5">

              {erro && (
                <div
                  id="login-error"
                  role="alert"
                  className="border text-sm px-4 py-3 rounded-xl font-medium"
                  style={{
                    backgroundColor: '#fef2f2',
                    borderColor: '#fecaca',
                    color: '#dc2626',
                  }}
                >
                  {erro}
                </div>
              )}

              {/* Usuário */}
              <div>
                <label htmlFor="login-field" className="text-sm font-semibold" style={{ color: '#1e5a7d' }}>
                  Usuário ou e-mail
                </label>
                <div className="relative mt-1.5">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none" style={{ color: '#3a8fb7' }}>
                    <User size={18} aria-hidden="true" />
                  </span>
                  <input
                    id="login-field"
                    type="text"
                    autoComplete="username"
                    autoFocus
                    value={login}
                    onChange={(e) => setLogin(e.target.value.toLowerCase())}
                    placeholder="usuario ou e-mail"
                    aria-invalid={erro ? true : undefined}
                    aria-describedby={erro ? "login-error" : undefined}
                    className="w-full rounded-xl pl-11 pr-4 py-3.5 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:border-transparent aria-invalid:border-rose-300 aria-invalid:focus:ring-rose-400 transition-all"
                    style={{
                      border: '1.5px solid #e0e7ff',
                      backgroundColor: '#f9fbfd',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = '#3a8fb7';
                      e.currentTarget.style.boxShadow = '0 0 0 2px rgba(58, 143, 183, 0.1)';
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = '#e0e7ff';
                      e.currentTarget.style.boxShadow = 'none';
                      e.currentTarget.style.backgroundColor = '#f9fbfd';
                    }}
                  />
                </div>
              </div>

              {/* Senha */}
              <div>
                <label htmlFor="senha-field" className="text-sm font-semibold" style={{ color: '#1e5a7d' }}>
                  Senha
                </label>
                <div className="relative mt-1.5">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none" style={{ color: '#3a8fb7' }}>
                    <Lock size={18} aria-hidden="true" />
                  </span>
                  <input
                    id="senha-field"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    placeholder="••••••••"
                    aria-invalid={erro ? true : undefined}
                    aria-describedby={erro ? "login-error" : undefined}
                    className="w-full rounded-xl pl-11 pr-12 py-3.5 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-transparent aria-invalid:border-rose-300 aria-invalid:focus:ring-rose-400 transition-all"
                    style={{
                      border: '1.5px solid #e0e7ff',
                      backgroundColor: '#f9fbfd',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = '#3a8fb7';
                      e.currentTarget.style.boxShadow = '0 0 0 2px rgba(58, 143, 183, 0.1)';
                      e.currentTarget.style.backgroundColor = '#ffffff';
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = '#e0e7ff';
                      e.currentTarget.style.boxShadow = 'none';
                      e.currentTarget.style.backgroundColor = '#f9fbfd';
                    }}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-4 pl-2 hover:opacity-75 active:opacity-60 focus:outline-none focus:ring-2 rounded-r-xl transition-all"
                    style={{ color: '#3a8fb7' }}
                  >
                    {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                  </button>
                </div>
              </div>

              {/* Botão */}
              <div className="pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-13 text-white rounded-xl text-base font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2"
                  style={{
                    background: 'linear-gradient(135deg, #2a8ba8 0%, #1e5a7d 100%)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #1e7a96 0%, #164a6a 100%)';
                    e.currentTarget.style.boxShadow = '0 8px 16px rgba(42, 139, 168, 0.3)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'linear-gradient(135deg, #2a8ba8 0%, #1e5a7d 100%)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.boxShadow = '0 0 0 2px white, 0 0 0 4px #3a8fb7';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  {loading ? "Entrando…" : (<><span>Acessar Sistema</span><ArrowRight size={18} aria-hidden="true" /></>)}
                </button>
              </div>

            </form>
            )}
          </div>
        </div>
      </div>

      <p className="relative mt-5 text-xs text-white/55 select-none tracking-wide">Universo ABA — Sistema de Gestão Clínica</p>
    </main>
  );
}
