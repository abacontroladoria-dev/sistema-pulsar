-- Bug (2026-09-09): o profissional Pedro Lucas Gonçalves Pires Viana
-- (profissional_id 18681, "Aplicador ABA Escola", sala "AT Externo Escola") foi
-- cadastrado no TiTa em 08/09, já tinha 228 sessões ativas de 09/09 a 30/10, e
-- NÃO aparecia em /cadastros/contratos no dia seguinte.
--
-- Causa medida em produção: a tela monta a lista como `roster ∪ contratos` (ver
-- montarLinhas em components/cadastros/ContratosCadastro.tsx), e o roster é
-- vw_remuneracao_profissionais_roster, que tinha csv_grades_profissionais como
-- única fonte. Essa tabela é alimentada pelo cron `sync-grade-csv-daily`, que
-- roda UMA vez por dia às 02:00 BRT (carimbo observado: 07:01 UTC). As linhas do
-- Pedro entraram na agenda_tita às 09:00 UTC — DEPOIS da rodada do dia. Não foi
-- rodada perdida nem janela de data: o modo "grade" cobre hoje → fimPadrao() e a
-- tabela já tinha 18.181 linhas de outubro. O sync não o perdeu; ele ainda não
-- existia quando o sync olhou.
--
-- Esta é EXATAMENTE a mesma falha que 20260827120000 corrigiu em
-- vw_cronograma_profissionais_salas (dropdown de "Alocar sessão livre"), com o
-- mesmo diagnóstico e o mesmo remédio. Aquela migration fechou dizendo, textual,
-- que vw_remuneracao_profissionais_roster "tem a MESMA janela de atraso, e
-- deliberadamente NÃO foi alterada aqui" porque devolve `terapia_principal` e
-- unir as fontes mudaria o VALOR devolvido, não só o conjunto de nomes — "é outra
-- entrega, com outra validação". Esta é aquela entrega, com aquela validação.
--
-- O dado já estava no banco: `grade_profissionais_tita`, o outro pipeline TiTa
-- (fn_sync_tita_operacional, cron `sync-tita-operacional` às 06:00 e 12:00 BRT em
-- dias úteis), tinha as linhas do Pedro com data 08/09 — o dia do cadastro. As
-- duas tabelas leem a mesma unidade (280) e cobrem a mesma janela; a diferença é
-- a frequência.
--
-- Correção: a view passa a considerar as DUAS fontes. Não é troca de fonte nem
-- ampliação de regra de negócio — é hedge de latência, e só produz efeito na
-- janela em que uma ponta está atrasada em relação à outra.
--
-- POR QUE NÃO REPONTAR PARA agenda_tita (a alternativa considerada e rejeitada):
-- medido hoje com o mesmo piso de 30 dias, trocar a fonte por agenda_tita fazia
-- entrar `Testes Técnicos - Sanderson Rodrigues de Souza` (os filtros abaixo usam
-- prefixo, e ali o nome traz o rótulo em outra posição) e SAIR 5 nomes, um deles
-- com contrato cadastrado. União acrescenta sem remover, então não há esse risco.
--
-- ─── Validação em produção (2026-09-09, varredura completa das duas fontes) ────
-- csv (roster atual): 123 nomes · grade_profissionais_tita, mesmo piso: 125
-- A união acrescenta 4 nomes, e SÓ 4:
--   + Pedro Lucas Gonçalves Pires Viana        ← o bug
--   + INATIVO - Davi da Silva Santos
--   + INATIVO - Débora Anastacia Pires Porto Jensen
--   + INATIVO - Izabelle Soares Da Silva
--
-- Os três `INATIVO - ...` são RUÍDO NOVO e precisam ser barrados, por dois
-- motivos independentes: (a) são desligados, que não devem entrar num cadastro de
-- contrato; (b) os três já estão no roster sob o nome LIMPO ("Davi da Silva
-- Santos" etc., verificado um a um) — sem o filtro, cada um apareceria DUAS vezes
-- na tela, e num cadastro que casa por nome isso é convite a cadastrar contrato
-- na linha errada.
--
-- O filtro existente `NOT ILIKE 'INATIVO%'` não bastaria aqui — ele não existia.
-- As duas fontes escrevem o prefixo de forma DIFERENTE, e é por isso que o filtro
-- abaixo usa '%INATIVO%' (contains) e não prefixo:
--   csv_grades_profissionais → 'INATIVO-Nome'    (sem espaços)
--   grade_profissionais_tita → 'INATIVO - Nome'  (com espaços)
-- Casar por prefixo exato deixaria passar uma das duas grafias na primeira vez
-- que a origem mudar de estilo. Ver reference: o prefixo INATIVO é o que diz QUEM
-- saiu no TiTa.
--
-- EFEITO COLATERAL ASSUMIDO, e é uma melhora: o filtro novo também remove os
-- 'INATIVO-...' que a fonte csv trazia e que a view devolvia HOJE. A csv tem 5
-- nomes assim na tabela inteira, mas só 2 caem dentro do piso de 30 dias e
-- portanto só 2 saem da view: INATIVO-Gabriela Pereira Ramos e
-- INATIVO-Larissa Neivane Caslow Assunção. (Os outros 3 — Brenda Rayanne
-- Ferreira, Rodrigo Magalhães do Nascimento, Sabrina Santos Theobaldo — já
-- estavam fora pela data.) São desligados listados num cadastro de contrato: não
-- deveriam estar lá. Nenhum deles deixa de ser alcançável se tiver contrato: a
-- tela faz `roster ∪ contratos`, então quem tem contrato cadastrado continua
-- aparecendo pela outra ponta da união, com o histórico intacto.
--
-- Resultado líquido MEDIDO (simulando a view nova contra produção, 09/09):
--   123 → 122 nomes.  ENTRA: Pedro Lucas (terapia 'Psicologia ABA').
--   SAEM: os 2 INATIVO- acima. Os 3 'INATIVO - ' da segunda fonte nunca entram.
--   terapia_principal NÃO virou NULL para ninguém que tinha valor (verificado
--   nome a nome).
--
-- ─── terapia_principal: a ressalva que 20260827120000 levantou ────────────────
-- É por isso que aquela migration parou antes desta view. Medido:
--   • roster atual: 0 de 123 nomes com terapia_principal NULL.
--   • segunda fonte: 27 de 125 com terapia_exibicao NULL (slots 'Livre' têm
--     exibição NULL, mesma razão descrita em 20260805160100).
-- A `prioridade` abaixo é o que protege o valor: csv vem com prioridade 0, então
-- para os 123 nomes que a csv já enxerga o DISTINCT ON continua escolhendo a
-- linha da csv e `terapia_principal` NÃO MUDA para ninguém que hoje tem valor. A
-- segunda fonte só é consultada para nome que a csv ainda não viu — hoje, só o
-- Pedro, que vem com 'Psicologia ABA' preenchido.
--
-- Ainda assim o NULL é possível para um profissional novo cujo primeiro slot na
-- segunda fonte seja 'Livre'. Isso é ACEITÁVEL e melhor que a alternativa: hoje
-- esse profissional não aparece de jeito nenhum (o bug), e amanhã a rodada da csv
-- preenche a terapia. Aparecer com terapia em branco por até um dia é
-- estritamente melhor que não aparecer. Deliberadamente NÃO se usou
-- COALESCE(terapia_exibicao, nome_terapia) — pela mesma razão dada em
-- 20260805160100: mudaria o valor devolvido para slots 'Livre', e o objetivo aqui
-- é acrescentar nome, não redefinir a terapia.
--
-- ATENÇÃO ao consumidor desta coluna: terapia_id/terapia_nome NÃO identificam a
-- terapia de forma estável no TiTa. `terapia_principal` é rótulo de conferência,
-- não chave.
--
-- security_invoker = true é mantido, e funciona nas duas tabelas:
-- grade_profissionais_tita tem policy de SELECT para `authenticated` com
-- using (true) desde 20260524120000. Só nome e terapia saem da view —
-- cpf_profissional e numero_telefone, que aquela tabela carrega, ficam fora.
--
-- A assimetria de `ativo` entre as fontes é a mesma que 20260827120000 já
-- documentou e aceitou: `ativo` só existe em csv_grades_profissionais (soft-delete
-- do sync-grade-csv); grade_profissionais_tita é snapshot por slot, sem
-- soft-delete. O piso de 30 dias é o que limita a exposição — quem sai deixa de
-- ter data recente e cai fora em no máximo 30 dias, a mesma tolerância que a csv
-- já tem hoje.
--
-- Definições anteriores: 20260707180000 (criação), 20260708140000
-- (terapia_principal) e 20260805160100 (piso de data + `ativo` + 'Combinar
-- Consulta%'). O piso de 30 dias é PRESERVADO de propósito: ampliá-lo continua
-- sendo decisão de produto, não desta correção.

CREATE OR REPLACE VIEW public.vw_remuneracao_profissionais_roster
WITH (security_invoker = true) AS
WITH fontes AS (
  -- Pipeline canônico (sync-grade-csv, 02:00 BRT) — prioridade 0.
  -- Mantém o valor de terapia_principal para todo nome que esta fonte enxerga.
  SELECT
    0 AS prioridade,
    profissional_nome,
    terapia_exibicao_nome AS terapia_principal,
    data
  FROM public.csv_grades_profissionais
  WHERE ativo
    AND data >= current_date - interval '30 days'

  UNION ALL

  -- Pipeline operacional (fn_sync_tita_operacional, 06:00 e 12:00 BRT em dias
  -- úteis) — prioridade 1, só preenche quem o canônico ainda não viu.
  SELECT
    1 AS prioridade,
    nome_profissional AS profissional_nome,
    terapia_exibicao  AS terapia_principal,
    data
  FROM public.grade_profissionais_tita
  WHERE data >= current_date - interval '30 days'
)
SELECT DISTINCT ON (profissional_nome)
  profissional_nome,
  terapia_principal
FROM fontes
WHERE profissional_nome IS NOT NULL
  AND profissional_nome <> ''
  AND profissional_nome NOT IN ('Profissional Teste', 'Testes Técnicos', 'Combinar Consulta')
  AND profissional_nome NOT ILIKE 'Testes Técnicos%'
  AND profissional_nome NOT ILIKE 'Combinar Consulta%'
  -- Contains, não prefixo: as duas fontes grafam o prefixo de forma diferente
  -- ('INATIVO-Nome' na csv, 'INATIVO - Nome' na operacional). Ver nota acima.
  AND profissional_nome NOT ILIKE '%INATIVO%'
-- prioridade ANTES de data: garante que, para nome visto pelas duas fontes, a
-- linha escolhida seja a da csv — é o que preserva terapia_principal. Dentro da
-- mesma fonte, `data DESC` continua pegando a terapia do agendamento mais
-- recente, como em 20260708140000.
ORDER BY profissional_nome, prioridade, data DESC;

GRANT SELECT ON public.vw_remuneracao_profissionais_roster TO authenticated;

COMMENT ON VIEW public.vw_remuneracao_profissionais_roster IS
  'Profissionais listados em /cadastros/contratos e em Config → Capacidade do profissional. União dos dois pipelines TiTa para não esconder quem foi cadastrado depois da rodada diária do sync-grade-csv, e exclusão de desligados (prefixo INATIVO, grafado diferente em cada fonte) — ver 20260909120000.';
