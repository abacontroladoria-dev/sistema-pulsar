-- =============================================================================
-- O adiantamento para de ser apagado por escrita cega
-- =============================================================================
-- JÁ APLICADO EM PRODUÇÃO em 2026-09-17 pelo SQL Editor
-- (supabase/snippets/20260917_protege_adiantamento_APLICAR.sql). Esta migration
-- existe para o repositório contar a mesma história que o banco.
--
-- O CASO
--
-- Sessão de Davi Lucas (11579) agendada para 16/09 08:00 e ATENDIDA em 15/09. A
-- recepção lançou falta na quarta; a gestora lançou o adiantamento por cima em
-- 16/09 14:51:34, gravando os quatro campos num UPDATE só
-- (marcar_sessao_adiantada, 20260916120000:146-149).
--
-- Em 17/09 11:37:33 -- ~21h depois -- `data_atendimento_real` virou null sozinho:
--
--   adiantada_justificativa  preservada (o texto inteiro da gestora)
--   adiantada_por_nome       preservado
--   adiantada_em             preservado (16/09 14:51:34)
--   data_atendimento_real    ZERADO
--
-- Três de quatro intactos descarta reescrita de linha, e descarta
-- desfazer_sessao_adiantada: ela limpa os quatro juntos e teria sido recusada
-- pela própria guarda do vínculo (o vínculo existe e está ativo). Nenhum código
-- deste repositório zera essa coluna isoladamente -- procurado em migrations,
-- frontend e rotas de API. A assinatura é de escrita externa campo-a-campo (o
-- sync do TiTa), que manda null porque a origem não tem o conceito de data real.
-- Mesmo padrão dos drifts de CPF (20260707) e de convênio (20260901).
--
-- POR QUE ISSO É GRAVE
--
-- Com a coluna nula a sessão volta a ser falta para o anti-join de
-- get_auditoria_assim_periodo (20260916130100:69-85) e SOME da Conferência do
-- dia agendado -- a célula fica vazia. E não aparece entre as faltas, porque
-- `tipo_falta` é null e get_faltas_auditoria_assim exige paciente/terapeuta. Uma
-- sessão atendida, vinculada a uma guia e faturável fica invisível em todas as
-- telas: pior que uma falta visível, porque ninguém audita o que não vê.
--
-- Nem é refazível pela tela: marcar_sessao_adiantada exige `status = 'falta'`
-- (:167) e a linha fica em 'cancelado'.
--
-- O DESENHO
--
-- A trigger não impede limpar a coluna -- desfazer_sessao_adiantada precisa
-- disso. Impede limpá-la SOZINHA, deixando um adiantamento pela metade. Quem
-- desfaz de verdade limpa `adiantada_em` no mesmo UPDATE e passa reto.
--
-- RAISE em vez de restaurar o valor calado: um sync que apaga dado de
-- faturamento precisa aparecer. A mensagem nomeia o valor, o autor do
-- adiantamento e as duas saídas.
--
-- O `when` na trigger mantém o custo em zero para o UPDATE que não toca a
-- coluna -- e a fila é tabela quente (20260824, incidente do pool).
-- =============================================================================

create or replace function public.fn_protege_adiantamento()
returns trigger
language plpgsql
as $$
begin
  -- Só o caso exato: a data sai, mas o registro do adiantamento fica.
  if old.data_atendimento_real is not null
     and new.data_atendimento_real is null
     and new.adiantada_em is not null then
    raise exception
      'Tentativa de apagar data_atendimento_real (%) da sessão % mantendo o adiantamento de % por %. Para desfazer use desfazer_sessao_adiantada(); para sincronizar, exclua esta coluna do payload.',
      old.data_atendimento_real, old.id, old.adiantada_em, old.adiantada_por_nome
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protege_adiantamento on public.fila_autorizacoes;

create trigger trg_protege_adiantamento
  before update on public.fila_autorizacoes
  for each row
  when (old.data_atendimento_real is distinct from new.data_atendimento_real)
  execute function public.fn_protege_adiantamento();

comment on function public.fn_protege_adiantamento() is
  'Recusa UPDATE que zera data_atendimento_real deixando adiantada_em preenchido. Existe porque em 2026-09-17 uma escrita externa apagou só essa coluna de uma sessão adiantada (fila 8979a1f4), preservando as outras três, e a sessão sumiu da Conferência sem virar falta. Não bloqueia desfazer_sessao_adiantada, que limpa os quatro campos no mesmo UPDATE.';

-- Para achar vítimas (nenhuma além da restaurada, em 17/09):
--   select id, data_atendimento, horario, adiantada_em, adiantada_por_nome
--   from public.fila_autorizacoes
--   where adiantada_em is not null and data_atendimento_real is null;
