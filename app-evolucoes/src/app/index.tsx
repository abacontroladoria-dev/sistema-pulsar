import { Redirect } from 'expo-router';

import { Botao } from '@/components/botao';
import { EstadoTela } from '@/components/estado-tela';
import { useSessao } from '@/providers/session-provider';

/** Porta de entrada: manda cada pessoa para a área do seu papel. */
export default function Index() {
  const { session, segundoFatorPendente, perfil, erroPerfil, tentarPerfilDeNovo, sair } = useSessao();

  if (!session) return <Redirect href="/login" />;
  if (segundoFatorPendente) return <Redirect href="/segundo-fator" />;
  if (perfil?.tipo === 'terapeuta' || perfil?.tipo === 'gestao') return <Redirect href="/agenda" />;
  if (perfil?.tipo === 'responsavel') return <Redirect href="/responsavel" />;

  if (erroPerfil) {
    return (
      <EstadoTela
        icone="aviso"
        titulo="Não foi possível carregar seu acesso"
        mensagem="Verifique a internet e tente de novo."
        acoes={
          <>
            <Botao titulo="Tentar de novo" onPress={tentarPerfilDeNovo} />
            <Botao titulo="Sair" variante="texto" onPress={sair} />
          </>
        }
      />
    );
  }

  if (perfil === null) {
    return (
      <EstadoTela
        icone="cadeado"
        titulo="Sem acesso ao app"
        mensagem="Sua conta não está liberada para o app. Fale com a clínica."
        acoes={<Botao titulo="Sair" variante="secundario" onPress={sair} />}
      />
    );
  }

  // Logo depois do login, enquanto o perfil chega.
  return <EstadoTela carregando />;
}
