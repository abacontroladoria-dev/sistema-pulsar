-- O papel `faturamento` lê a fila_autorizacoes.
--
-- Sintoma relatado em 22/09/2026: na Conferência ASSIM (/auditoria-assim?tab=auditoria)
-- a Silvana (role `faturamento`) via TOTAL DE SESSÕES 333, enquanto os demais
-- usuários viam 340 no mesmo dia — com Faltas Paciente e Faltas Terapeuta
-- zeradas (os outros viam 27 e 4) e Não Solicitadas inflada de 217 para 243.
--
-- Causa: `faturamento` não consta em nenhuma policy de SELECT da
-- fila_autorizacoes. As policies cobrem recepcao, terapeutico, autorizacao,
-- diretoria, rp e admin (20260610000011, 20260713130000, 20260817120000) — e
-- foi 20260817120000 que derrubou as policies amplas a `authenticated`, que até
-- então mascaravam a ausência.
--
-- As RPCs da tela são `LANGUAGE sql STABLE` SEM SECURITY DEFINER, ou seja,
-- rodam como INVOKER: a RLS do usuário vale dentro delas. Como RLS FILTRA
-- LINHAS em vez de levantar exceção, a chamada volta 200 com menos dados e o
-- erro é silencioso — o mesmo modo de falha que o comentário de 20260817120000
-- descreve para o papel `rp`.
--
-- O efeito não é só "faltar falta". A tela erra em três lugares de uma vez:
--   1. get_faltas_auditoria_assim lê SÓ a fila       -> 0 linhas -> os dois
--      cards de falta zeram;
--   2. o anti-join `agenda_sem_falta` (NOT EXISTS na fila) não encontra nada,
--      então as faltas VOLTAM para a lista principal como sessões comuns;
--   3. sem a fila, o bloco perde status/status_assim/forma_autorizacao e o CASE
--      de `situacao` cai em NAO_SOLICITADA — daí as 26 "não solicitadas" a mais.
-- Ou seja: sessões que faltaram apareciam para o faturamento como sessões
-- pendentes de autorização.
--
-- O total da tela é `rawDados.length` somado no cliente (KpiCards.tsx), não uma
-- contagem no servidor — por isso a linha escondida pela RLS simplesmente some
-- da conta, sem nada na tela indicando que faltou dado.
--
-- SELECT apenas: `faturamento` confere, não altera a fila.

drop policy if exists fila_autorizacoes_faturamento_select on public.fila_autorizacoes;

create policy fila_autorizacoes_faturamento_select
  on public.fila_autorizacoes
  for select
  to authenticated
  using (
    exists (
      select 1 from public.usuarios u
      where u.id = auth.uid()
        and u.role = 'faturamento'
        and u.ativo = true
    )
  );
