import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, use, useEffect, useState, type PropsWithChildren } from 'react';

import { buscarPerfil, type Perfil } from '@/lib/perfil';
import { supabase } from '@/lib/supabase';

type EstadoSessao = {
  /** `undefined` enquanto a sessão guardada no aparelho ainda está sendo lida. */
  session: Session | null | undefined;
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

  const userId = session?.user.id;
  const consultaPerfil = useQuery({
    queryKey: ['perfil', userId],
    queryFn: buscarPerfil,
    enabled: !!userId,
    staleTime: Infinity,
  });

  const perfil = userId ? consultaPerfil.data : undefined;
  const erroPerfil = userId && perfil === undefined ? consultaPerfil.error : null;
  const pronto = session !== undefined && (!session || perfil !== undefined || !!erroPerfil);

  const sair = async () => {
    await supabase.auth.signOut();
    // Nada do usuário anterior pode sobrar em cache para o próximo que entrar.
    queryClient.clear();
  };

  return (
    <SessaoContext
      value={{
        session,
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
