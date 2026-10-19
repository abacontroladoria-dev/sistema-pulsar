import { AreaEmConstrucao } from '@/components/area-em-construcao';
import { useSessao } from '@/providers/session-provider';

export default function AgendaRoute() {
  const { perfil } = useSessao();
  return (
    <AreaEmConstrucao
      mensagem={
        perfil?.tipo === 'gestao'
          ? 'Aqui vão aparecer as agendas dos profissionais, com o status de evolução de cada sessão.'
          : 'Aqui vão aparecer as suas sessões do dia e as que você estiver cobrindo, para evoluir ou marcar falta.'
      }
    />
  );
}
