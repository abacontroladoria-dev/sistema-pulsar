-- Amplia a LEITURA de cadastros_pacientes_altas e
-- cadastros_pacientes_alta_clinica para quem tem a permissão
-- `cronograma_ocupacao_paciente`.
--
-- POR QUE: a Ocupação de Paciente (/cronograma/ocupacao-paciente) passou a
-- consultar estas duas tabelas para não ofertar especialidade com alta
-- registrada nem paciente com alta clínica (ver
-- frontend/lib/cronograma/suspensaoTemporaria.ts). É o mesmo caso que a
-- 20260902120100 resolveu para a suspensão temporária: o acesso à TELA é dado
-- por `cronograma_ocupacao_paciente`, independente de `cadastros_pacientes` /
-- papel admin/diretoria/cronograma, que é o que a RLS destas tabelas exige
-- (20260826140700 e 20260921200100). Sem isto, um usuário só com a permissão
-- da tela leria zero linhas em silêncio e a ferramenta continuaria ofertando
-- a especialidade com alta para ele.
--
-- SÓ AMPLIA LEITURA. Insert/update/delete continuam exigindo
-- `cadastros_pacientes` (ou o papel): quem só tem a Ocupação de Paciente vê a
-- alta, não cria, não exclui, não reativa. O anexo (Storage) não muda — a
-- policy do bucket laudos-pacientes continua só para `cadastros_pacientes`.
--
-- Pode ser aplicada a qualquer momento, antes ou depois do redeploy: o
-- frontend novo funciona sem ela (só não bloqueia para quem não lê a tabela)
-- e o frontend antigo não lê estas tabelas.

drop policy if exists cadastros_pacientes_altas_select
  on public.cadastros_pacientes_altas;

create policy cadastros_pacientes_altas_select
  on public.cadastros_pacientes_altas
  for select to authenticated
  using (
    public.usuario_tem_permissao('cadastros_pacientes')
    or public.usuario_tem_permissao('cronograma_ocupacao_paciente')
    or public.remuneracao_has_role(array['admin','diretoria','cronograma'])
  );

drop policy if exists cadastros_pacientes_alta_clinica_select
  on public.cadastros_pacientes_alta_clinica;

create policy cadastros_pacientes_alta_clinica_select
  on public.cadastros_pacientes_alta_clinica
  for select to authenticated
  using (
    public.usuario_tem_permissao('cadastros_pacientes')
    or public.usuario_tem_permissao('cronograma_ocupacao_paciente')
    or public.remuneracao_has_role(array['admin','diretoria','cronograma'])
  );
