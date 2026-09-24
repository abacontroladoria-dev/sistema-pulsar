-- Acrescenta policy de DELETE em previsao_receitas_faturamento.
--
-- A migration original (20260923140100) tinha deixado de propósito sem
-- DELETE, seguindo o padrão de tabela financeira "corrige editando, não
-- apagando" (mesmo de laudos_acompanhamento). O usuário pediu explicitamente
-- um botão de excluir na tela (2026-09-23) — um lançamento digitado errado
-- (paciente/mês/valor trocado) precisa poder ser removido, não só editado, e
-- a exclusão já fica registrada na trilha (cadastros_auditoria, ação
-- "excluir") pelo mesmo service que grava o insert/update.
--
-- Mesma condição de permissão das outras policies desta tabela.

do $$
declare
  cond constant text :=
    '(public.usuario_tem_permissao(''indicadores_alimentar_bd'')'
    || ' or public.remuneracao_has_role(array[''admin'',''diretoria'']))';
begin
  execute format(
    'create policy previsao_receitas_faturamento_delete on public.previsao_receitas_faturamento'
    || ' for delete to authenticated using (%s)', cond);
end $$;

grant delete on public.previsao_receitas_faturamento to authenticated;
