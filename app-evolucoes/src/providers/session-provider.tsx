import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useState, type PropsWithChildren } from 'react';

import { buscarPerfil, type Perfil } from '@/lib/perfil';
import { supabase } from '@/lib/supabase';
import { precisaSegundoFator } from '@/utils/segundo-fator';

type EstadoSessao = {
  /** `undefined` enquanto a sessão guardada no aparelho ainda está sendo lida. */
  session: Session | null | undefined;
  /**
   * Senha certa, mas a conta tem app autenticador e o código ainda não foi
   * digitado (sessão aal1). Nada do app abre até o código, como no web.
   */
  segundoFatorPendente: boolean;
  /** `undefined` enquanto carrega (ou sem sessão); `null` = conta sem acesso ao app. */
  perfil: Perfil | null | undefined;
  /** Falha ao descobrir o perfil (rede, RPC). Distinto de "sem acesso". */
  erroPerfil: Error | null;
  /** Sessão e perfil resolvidos: dá para decidir a rota sem piscar a tela errada. */
  pronto: boolean;
  tentarPerfilDeNovo: () => void;
  sair: () => Promise<void>;
};

const SessaoContext = createContext<EstadoSessao | null>(null);

export function useSessao() {
  const valor = use(SessaoContext);
  if (!valor) throw new Error('useSessao precisa estar dentro de <SessionProvider />');
  return valor;
}

export function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    // INITIAL_SESSION chega primeiro, com o que estava no Keychain/Keystore.
    const { data } = supabase.auth.onAuthStateChange((_evento, novaSessao) => {
      setSession(novaSessao);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const segundoFatorPendente = !!session && precisaSegundoFator(session);
  // Perfil só depois do segundo fator: antes dele a sessão ainda não vale.
  const userId = session && !segundoFatorPendente ? session.user.id : undefined;
  const consultaPerfil = useQuery({
    queryKey: ['perfil', userId],
    queryFn: buscarPerfil,
    enabled: !!userId,
    staleTime: Infinity,
  });

  const perfil = userId ? consultaPerfil.data : undefined;
  const erroPerfil = userId && perfil === undefined ? consultaPerfil.error : null;
  const pronto =
    session !== undefined && (!session || segundoFatorPendente || perfil !== undefined || !!erroPerfil);

  const sair = async () => {
    await supabase.auth.signOut();
    // Nada do usuário anterior pode sobrar em cache para o próximo que entrar.
    queryClient.clear();
  };

  return (
    <SessaoContext
      value={{
        session,
        segundoFatorPendente,
        perfil,
        erroPerfil,
        pronto,
        tentarPerfilDeNovo: () => void consultaPerfil.refetch(),
        sair,
      }}>
      {children}
    </SessaoContext>
  );
}
