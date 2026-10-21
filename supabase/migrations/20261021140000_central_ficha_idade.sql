-- ============================================================================
-- Ficha do paciente: idade informada, separada do nascimento (21/10/2026)
--
-- A família muitas vezes diz "ele tem 5 anos" e não dá a data. Até aqui a
-- idade só existia derivada de birth_date (ficha.service.ts), e esse dado se
-- perdia: a Maia não tinha onde anotar.
--
-- `age_years` guarda SÓ a idade que a conversa revelou. Quando há nascimento,
-- a leitura (resolverCampos) mostra a idade calculada e ignora esta coluna —
-- o número guardado envelhece, o calculado não.
--
-- Não entra em coleta_concluida: o que se pergunta é a data; a idade é o que
-- se anota quando a família só deu a idade.
--
-- Aditiva e nula: código antigo não a lê nem a escreve. O código novo a
-- seleciona — aplicar ANTES do deploy.
-- ============================================================================

alter table central.contact_intake
  add column if not exists age_years smallint;

alter table central.contact_intake
  drop constraint if exists ck_cin_idade_plausivel;
alter table central.contact_intake
  add constraint ck_cin_idade_plausivel
  check (age_years is null or age_years between 0 and 120);

comment on column central.contact_intake.age_years is
  'Idade em anos como a familia informou, quando ela nao deu a data de nascimento. Com birth_date preenchido a tela mostra a idade calculada e ignora esta coluna.';

notify pgrst, 'reload schema';
