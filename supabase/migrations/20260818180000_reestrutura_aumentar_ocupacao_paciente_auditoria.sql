-- Pedido do usuário (2026-08-18): renomeou a trilha de auditoria das
-- Observações (criada em 20260818170000 como
-- cronograma_paciente_observacoes_auditoria) para
-- aumentar_ocupacao_paciente_auditoria, e pediu pra ela também abrigar o
-- histórico de implantações na TiTa que hoje só existe como resultado de uma
-- consulta ao vivo sobre acomp_pac_bundles (ver mensagem inicial do pedido).
-- Uma tabela só, duas origens de linha:
--   - linhas de implantação (histórico, backfill único) preenchem
--     terapia/profissional/dia_sessao/hora_sessao/status e deixam texto/acao nulos;
--   - linhas de observação (criar/editar/excluir, gravadas por
--     pacienteObservacoes.service.ts) preenchem texto/acao e deixam
--     terapia/profissional/dia_sessao/hora_sessao/status nulos.
-- `data`/`hora` como text (não date/time) pra bater exatamente com o formato
-- já usado na consulta original (to_char(...,'DD/MM/YYYY') / 'HH24:MI:SS').

-- O RENAME da tabela em si foi feito A MAO no dashboard de producao, entao
-- nenhuma migration o executava: num banco NOVO o 20260818170000 deixa o nome
-- antigo (cronograma_paciente_observacoes_auditoria) e todo o resto deste
-- arquivo — e das 3 migrations seguintes — quebrava com "relation ... does not
-- exist". Fazer o rename aqui deixa o historico reproduzivel do zero e e
-- no-op em producao, onde a tabela ja tem o nome novo.
DO $$
BEGIN
  IF to_regclass('public.aumentar_ocupacao_paciente_auditoria') IS NULL
     AND to_regclass('public.cronograma_paciente_observacoes_auditoria') IS NOT NULL THEN
    ALTER TABLE public.cronograma_paciente_observacoes_auditoria
      RENAME TO aumentar_ocupacao_paciente_auditoria;
    RAISE NOTICE 'tabela renomeada para aumentar_ocupacao_paciente_auditoria';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aumentar_ocupacao_paciente_auditoria' AND column_name = 'pac'
  ) THEN
    ALTER TABLE public.aumentar_ocupacao_paciente_auditoria RENAME COLUMN pac TO paciente;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aumentar_ocupacao_paciente_auditoria' AND column_name = 'usuario_nome'
  ) THEN
    ALTER TABLE public.aumentar_ocupacao_paciente_auditoria RENAME COLUMN usuario_nome TO usuario;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aumentar_ocupacao_paciente_auditoria' AND column_name = 'texto_depois'
  ) THEN
    ALTER TABLE public.aumentar_ocupacao_paciente_auditoria RENAME COLUMN texto_depois TO texto;
  END IF;
END $$;

alter table public.aumentar_ocupacao_paciente_auditoria
  drop column if exists texto_antes;

alter table public.aumentar_ocupacao_paciente_auditoria
  add column if not exists data text,
  add column if not exists hora text,
  add column if not exists email text,
  add column if not exists terapia text,
  add column if not exists profissional text,
  add column if not exists dia_sessao text,
  add column if not exists hora_sessao text,
  add column if not exists status text;

alter table public.aumentar_ocupacao_paciente_auditoria
  alter column paciente set not null;

-- `acao` (criar/editar/excluir) já existia e continua sendo só das linhas de
-- observação — nulo nas linhas de implantação, que usam `status` em vez disso.
alter table public.aumentar_ocupacao_paciente_auditoria
  alter column acao drop not null;

-- Backfill do histórico de implantações (62 linhas, extraídas da consulta
-- original sobre acomp_pac_bundles em 2026-08-18) — one-off. Guardado por uma
-- linha-marcador: se a primeira linha do lote já está presente, o backfill já
-- rodou e não insere de novo (idempotente mesmo sem chave única na tabela).
insert into public.aumentar_ocupacao_paciente_auditoria
  (data, hora, usuario, email, paciente, terapia, profissional, dia_sessao, hora_sessao, status)
select v.* from (values
  ('18/08/2026','12:27:53','Juliana','julianagmrsmatos@gmail.com','Sara Ferreira Dias','Terapia Ocupacional','Danielle Galvão Nogueira','Terça-feira','15:40','confirmado'),
  ('18/08/2026','08:58:15','Juliana','julianagmrsmatos@gmail.com','Bianca Alves Candido','Aplicador ABA (EF)','Gabriel Rodrigues Miguel','Quinta-feira','10:40','confirmado'),
  ('17/08/2026','16:06:23','Juliana','julianagmrsmatos@gmail.com','Nathan Machado Grossi','Psicologia','Jéssica Santos Gonçalves','Quarta-feira','14:20','confirmado'),
  ('17/08/2026','09:37:14','Juliana','julianagmrsmatos@gmail.com','Theo Meneses Da Silva','Aplicador ABA (PS)','Caio Belem Guterres','Quinta-feira','08:00','confirmado'),
  ('17/08/2026','09:37:14','Juliana','julianagmrsmatos@gmail.com','Theo Meneses Da Silva','Aplicador ABA (PS)','Caio Belem Guterres','Quinta-feira','08:40','confirmado'),
  ('17/08/2026','09:23:43','Juliana','julianagmrsmatos@gmail.com','Miguel França De Castro','Aplicador ABA (PS)','Caio Belem Guterres','Terça-feira','08:40','confirmado'),
  ('17/08/2026','09:23:43','Juliana','julianagmrsmatos@gmail.com','Miguel França De Castro','Aplicador ABA (PS)','Caio Belem Guterres','Terça-feira','09:20','confirmado'),
  ('13/08/2026','11:31:50','Juliana','julianagmrsmatos@gmail.com','Diana Costa Damasceno','Aplicador ABA (PS)','Nathalia de Lyra Silva Rezende Freitas Inacio','Quarta-feira','08:00','confirmado'),
  ('13/08/2026','08:40:40','Juliana','julianagmrsmatos@gmail.com','Davi Dantas Dos Reis De Vasconcelos','Terapia Ocupacional','Elisangela Motta Do Valle','Sexta-feira','10:00','confirmado'),
  ('12/08/2026','15:29:17','Juliana','julianagmrsmatos@gmail.com','Carlos Haniel Correa Da Silva','Terapia Ocupacional','Jhenifer Matos De Souza Montes','Sexta-feira','13:40','confirmado'),
  ('12/08/2026','15:02:07','Juliana','julianagmrsmatos@gmail.com','Carlos Haniel Correa Da Silva','Fisioterapia','Ana Tereza Rezende Nascimento','Sexta-feira','14:20','confirmado'),
  ('12/08/2026','10:11:32','Juliana','julianagmrsmatos@gmail.com','Alvaro Soares Da Silva','Musicoterapia','Rachel Silva De Castro De Brito','Quarta-feira','08:00','confirmado'),
  ('11/08/2026','10:40:02','Victoria França','prefaturamento@universoaba.com.br','Brayn Henrique Marques De Oliveira','Aplicador ABA (PS)','Lais de Castro Cerqueira Monteiro','Quarta-feira','13:00','confirmado'),
  ('11/08/2026','10:40:02','Victoria França','prefaturamento@universoaba.com.br','Brayn Henrique Marques De Oliveira','Terapia Ocupacional','Danielle Galvão Nogueira','Quinta-feira','15:40','confirmado'),
  ('11/08/2026','10:40:02','Victoria França','prefaturamento@universoaba.com.br','Brayn Henrique Marques De Oliveira','Psicopedagogia','Ingrid Cristina Mello da Costa Dutra','Quinta-feira','16:20','confirmado'),
  ('11/08/2026','10:40:02','Victoria França','prefaturamento@universoaba.com.br','Brayn Henrique Marques De Oliveira','Aplicador ABA (PS)','Ana Beatriz Soeiro Leopoldo','Sexta-feira','15:40','confirmado'),
  ('11/08/2026','10:40:02','Victoria França','prefaturamento@universoaba.com.br','Brayn Henrique Marques De Oliveira','Psicomotricidade','Thaísa Raquel Souza Da Gama Sarmento Dos Santos','Sexta-feira','16:20','confirmado'),
  ('11/08/2026','10:40:02','Victoria França','prefaturamento@universoaba.com.br','Brayn Henrique Marques De Oliveira','Psicomotricidade','Thaísa Raquel Souza Da Gama Sarmento Dos Santos','Terça-feira','15:40','confirmado'),
  ('11/08/2026','10:01:57','Júlia Souza','coordenacao1.universoaba@gmail.com','Bianca Alves Candido','Terapia Ocupacional','Danielle Galvão Nogueira','Quinta-feira','10:00','confirmado'),
  ('11/08/2026','09:38:26','Júlia Souza','coordenacao1.universoaba@gmail.com','Benício Calheiros De Oliveira Brito','Fonoaudiologia','Isabella Alves De Oliveira Marciano','Quinta-feira','08:40','confirmado'),
  ('11/08/2026','08:38:32','Juliana','julianagmrsmatos@gmail.com','Heitor Prado Cuquejo Pereira Bonfim','Aplicador ABA (EF)','Gabriel Rodrigues Miguel','Quinta-feira','10:00','confirmado'),
  ('11/08/2026','08:38:32','Juliana','julianagmrsmatos@gmail.com','Heitor Prado Cuquejo Pereira Bonfim','Terapia Ocupacional','Vivian Menendes dos Santos','Quinta-feira','11:20','confirmado'),
  ('11/08/2026','08:11:42','Juliana','julianagmrsmatos@gmail.com','Gabrielle Gregório Manço','Terapia Ocupacional','Danielle Galvão Nogueira','Quinta-feira','08:00','removido_tita'),
  ('11/08/2026','08:11:42','Juliana','julianagmrsmatos@gmail.com','Gabrielle Gregório Manço','Fonoaudiologia','Marcia Regina Araujo de Paula','Quinta-feira','08:40','removido_tita'),
  ('10/08/2026','16:57:30','Juliana','julianagmrsmatos@gmail.com','Sophia Monteiro Gomes','Aplicador ABA (PS)','Lais de Castro Cerqueira Monteiro','Quarta-feira','16:20','confirmado'),
  ('10/08/2026','16:41:07','Juliana','julianagmrsmatos@gmail.com','Sophia Monteiro Gomes','Musicoterapia','Rosenilza Abreu Da Silva Leiras','Quarta-feira','17:00','confirmado'),
  ('10/08/2026','15:44:17','Júlia Souza','coordenacao1.universoaba@gmail.com','Miguel Da Silva Monsores','Terapia Ocupacional','Vivian Menendes dos Santos','Sexta-feira','17:00','confirmado'),
  ('10/08/2026','13:53:10','Júlia Souza','coordenacao1.universoaba@gmail.com','Arthur Vitorino Santana','Musicoterapia','Thiago Henrique Brito Do Nascimento','Terça-feira','10:40','confirmado'),
  ('10/08/2026','08:59:45','Sanderson Rodrigues','adm2.universoaba@gmail.com','Notificação Prévia','Aplicador ABA (PS)','Ana Beatriz Soeiro Leopoldo','Quinta-feira','17:00','removido_tita'),
  ('06/08/2026','10:08:43','Júlia Souza','coordenacao1.universoaba@gmail.com','Davi Lucas De Oliveira Capela','Aplicador ABA (PS)','Lais de Castro Cerqueira Monteiro','Quarta-feira','08:00','confirmado'),
  ('06/08/2026','10:08:43','Júlia Souza','coordenacao1.universoaba@gmail.com','Davi Lucas De Oliveira Capela','Terapia Alimentar','Camila Ferreira Rios Gomes','Quarta-feira','08:40','confirmado'),
  ('06/08/2026','10:08:43','Júlia Souza','coordenacao1.universoaba@gmail.com','Davi Lucas De Oliveira Capela','Aplicador ABA (EF)','Gabriel Rodrigues Miguel','Quinta-feira','08:00','confirmado'),
  ('05/08/2026','15:33:49','Júlia Souza','coordenacao1.universoaba@gmail.com','Tomaz De Barros Quirino','Psicomotricidade','Débora Anastacia Pires Porto Jensen','Terça-feira','13:00','confirmado'),
  ('05/08/2026','15:33:49','Júlia Souza','coordenacao1.universoaba@gmail.com','Tomaz De Barros Quirino','Psicopedagogia','Leonardo Nascimento Bassi','Terça-feira','13:40','confirmado'),
  ('05/08/2026','15:01:26','Júlia Souza','coordenacao1.universoaba@gmail.com','Danilo Figueiredo Rego','Fonoaudiologia','Isabella Alves De Oliveira Marciano','Quinta-feira','15:40','confirmado'),
  ('05/08/2026','15:01:26','Júlia Souza','coordenacao1.universoaba@gmail.com','Danilo Figueiredo Rego','Psicopedagogia','Ingrid Cristina Mello da Costa Dutra','Terça-feira','13:00','confirmado'),
  ('05/08/2026','10:55:39','Sanderson Rodrigues','adm2.universoaba@gmail.com','Notificação Prévia','Psicopedagogia','Ingrid Cristina Mello da Costa Dutra','Quinta-feira','13:40','removido_tita'),
  ('14/07/2026','16:47:09','Marcelle Volpasso','marcellevolpasso@gmail.com','Pedro Targino Abrahão','Psicomotricidade','Thaísa Raquel Souza Da Gama Sarmento Dos Santos','Quarta-feira','13:40','confirmado'),
  ('14/07/2026','16:47:09','Marcelle Volpasso','marcellevolpasso@gmail.com','Pedro Targino Abrahão','Fonoaudiologia','Carina da Silva Moreira','Quinta-feira','16:20','confirmado'),
  ('14/07/2026','16:47:09','Marcelle Volpasso','marcellevolpasso@gmail.com','Pedro Targino Abrahão','Psicomotricidade','Juliana Soares Rodrigues','Quinta-feira','17:00','confirmado'),
  ('14/07/2026','16:36:18','Sanderson Rodrigues','adm2.universoaba@gmail.com','Notificação Prévia','Psicomotricidade','Thaísa Raquel Souza Da Gama Sarmento Dos Santos','Terça-feira','15:40','removido_tita'),
  ('14/07/2026','16:33:11','(sem autoria — antes da auditoria)',null,'Notificação Prévia','Aplicador ABA (PS)','Lais de Castro Cerqueira Monteiro','Quarta-feira','13:40','removido_tita'),
  ('14/07/2026','16:09:00','(sem autoria — antes da auditoria)',null,'Notificação Prévia','Aplicador ABA (EF)','Gabriel Rodrigues Miguel','Terça-feira','13:00','removido_tita'),
  ('10/07/2026','14:28:49','(sem autoria — antes da auditoria)',null,'Notificação Prévia','Psicopedagogia','Ana Beatriz Virginio Da Silva','Quinta-feira','13:40','removido_tita'),
  ('10/07/2026','10:15:05','(sem autoria — antes da auditoria)',null,'Benício Santiago De Souza','Fonoaudiologia','Marcelle Andressa Da silva Dorcelino','Segunda-feira','08:00','confirmado'),
  ('10/07/2026','10:15:05','(sem autoria — antes da auditoria)',null,'Benício Santiago De Souza','Terapia Ocupacional','Jhenifer Matos De Souza Montes','Segunda-feira','08:40','confirmado'),
  ('09/07/2026','14:35:29','(sem autoria — antes da auditoria)',null,'Eduardo Gomes Aguiar','Psicopedagogia','Leonardo Nascimento Bassi','Quarta-feira','13:00','confirmado'),
  ('08/07/2026','16:35:47','(sem autoria — antes da auditoria)',null,'Helena Carvalho Alcantara Martins Barcellos','Terapia Ocupacional','Julliana de Oliveira Mota','Terça-feira','16:20','confirmado'),
  ('08/07/2026','16:03:01','(sem autoria — antes da auditoria)',null,'Samuel Alimandro Martins','Psicopedagogia','Leonardo Nascimento Bassi','Terça-feira','16:20','confirmado'),
  ('08/07/2026','11:55:34','(sem autoria — antes da auditoria)',null,'Kourtney Savino Lopes','Psicomotricidade','Rafael Pontes Pinheiro De Souza','Segunda-feira','09:20','confirmado'),
  ('08/07/2026','11:55:34','(sem autoria — antes da auditoria)',null,'Kourtney Savino Lopes','Aplicador ABA (PS)','Nathalia de Lyra Silva Rezende Freitas Inacio','Sexta-feira','11:20','confirmado'),
  ('08/07/2026','11:55:34','(sem autoria — antes da auditoria)',null,'Kourtney Savino Lopes','Psicopedagogia','Ana Carolyna Barros Leal','Terça-feira','10:00','confirmado'),
  ('08/07/2026','11:55:34','(sem autoria — antes da auditoria)',null,'Kourtney Savino Lopes','Terapia Alimentar','Juliana Fraga Sampaio','Terça-feira','10:40','confirmado'),
  ('08/07/2026','11:55:34','(sem autoria — antes da auditoria)',null,'Kourtney Savino Lopes','Psicomotricidade','Débora Anastacia Pires Porto Jensen','Terça-feira','11:20','confirmado'),
  ('08/07/2026','11:22:47','(sem autoria — antes da auditoria)',null,'Ícaro Melo Da Costa','Terapia Ocupacional','Vivian Menendes dos Santos','Segunda-feira','08:00','confirmado'),
  ('07/07/2026','14:09:21','(sem autoria — antes da auditoria)',null,'Clara Amorim David','Psicopedagogia','Leonardo Nascimento Bassi','Quinta-feira','13:00','confirmado'),
  ('07/07/2026','14:09:21','(sem autoria — antes da auditoria)',null,'Clara Amorim David','Fonoaudiologia','Marcia Regina Araujo de Paula','Quinta-feira','13:40','confirmado'),
  ('07/07/2026','14:09:21','(sem autoria — antes da auditoria)',null,'Clara Amorim David','Terapia Ocupacional','Bárbara Costa de Sá Barreto','Quinta-feira','14:20','confirmado'),
  ('07/07/2026','11:18:16','(sem autoria — antes da auditoria)',null,'Sophia Valentina Lopes Alvarado','Psicopedagogia','Brena Alves Soares de Barros','Quinta-feira','11:20','confirmado'),
  ('07/07/2026','11:18:16','(sem autoria — antes da auditoria)',null,'Sophia Valentina Lopes Alvarado','Aplicador ABA (PS)','Michele Sousa Freire de Faria','Terça-feira','11:20','confirmado'),
  ('02/07/2026','09:09:23','(sem autoria — antes da auditoria)',null,'Carlos Haniel Correa Da Silva','Terapia Ocupacional','Bárbara Costa de Sá Barreto','Quinta-feira','15:00','removido_tita')
) as v(data, hora, usuario, email, paciente, terapia, profissional, dia_sessao, hora_sessao, status)
where not exists (
  select 1 from public.aumentar_ocupacao_paciente_auditoria
  where data = '18/08/2026' and hora = '12:27:53' and paciente = 'Sara Ferreira Dias' and terapia = 'Terapia Ocupacional'
);
