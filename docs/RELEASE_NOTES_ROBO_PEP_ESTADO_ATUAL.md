# Release notes — PEP como retrato da pasta (02–03/10/2026)

Branch `feat/robo-pep-estado-atual`. Robô SharePoint 0.3.0 → **0.4.0**.

## Resumo

A tela Entregas PEP passa a mostrar **o que está na pasta do SharePoint agora**, e não só o que a última leitura mudou. Entrega e valor acompanham a pasta: se uma evidência some, a entrega perde a unidade e o valor é recalculado. O que mudou fica num histórico, com gráfico. O status dos analistas passa a dizer o que as pessoas fizeram, e não se o sistema já calculou.

## Para quem usa

### Tela Entregas PEP (`/relacionamento-prestador/pep`)
- **"O que está no SharePoint agora"**: todos os arquivos, evidências e pastas de todos os prestadores, como a última leitura os viu. "Ver o que foi lido" abre esse retrato. O detalhe de cada leitura continua em "Informações técnicas".
- **Evidências esperadas × na pasta**, por tipo de entrega (STC, ETC, TAP, TOP, PIC, RT, OE) e no total, em barras coloridas. Dá para escolher o **mês aberto** ou o **ano**, e filtrar por um ou mais profissionais. A lâmpada explica a conta:
  - STC e ETC: uma por semana do mês (3 em mês de recesso).
  - TAP: 2 por paciente por mês. TOP: 1 por paciente por mês.
  - PIC, RT e OE: 1 por planejamento semestral cadastrado que venceu. Sem planejamento cadastrado, não se espera.
  - Só conta arquivo com nome no padrão. Hoje existe 1 único planejamento semestral ativo (de OE).
- **"Entregas que mudaram com o SharePoint"** (últimos 30 dias) e a aba **"Saíram da pasta"** na gaveta do analista: o que era, quem entregou, quando sumiu e quantas unidades eram antes e depois.
- **Status do analista** (lista "Analistas do mês", com lâmpada explicando cada um):
  - **Faltam entregas**: há item esperado sem entrega, ou sugestão esperando uma pessoa.
  - **Entregas completas**: tudo o que era esperado foi entregue; ninguém conferiu.
  - **Conferido**: uma pessoa clicou "Marcar como conferido" na página do analista. Vale até uma entrega mudar depois.
  - **Liberado para pagamento**: o mês está travado.
  - Abrir a página do analista **não muda mais o status**. Valor ainda não calculado virou um aviso pequeno.

### Painel do robô (`/admin/robo-sharepoint`)
- Nova seção **Histórico de mudanças nas evidências**: gráfico por dia ou por mês (entraram × saíram, com a linha de quantas estavam na pasta), totais, "saíram em até 7 dias", e lista filtrável por período, prestador e tipo de mudança.
- **Alerta do freio**: se uma leitura completa não encontrar mais de 10 arquivos e mais de 15% do total de uma vez, ela **não apaga nada** (costuma ser falta de acesso, não arquivo apagado). Um admin confirma se foram apagados mesmo.
- **Saiu o botão de ligar e desligar a entrega automática**: o robô entrega sempre.

## Regras novas

- **Evidência que some tira a unidade da entrega**, tanto a do robô quanto a de pessoa, e o valor do mês é recalculado (inclusive de outros meses abertos).
- **Mês liberado não muda.** Fica um único aviso no histórico.
- **Arquivo que volta** pode ser entregue de novo (antes, o robô nunca mais o entregava).
- **Entrega semestral** com outra evidência não é mais apagada inteira.
- **Arquivo renomeado fora do padrão** depois de entregue: a entrega fica, com aviso.
- **Arquivo movido para a pasta de outro paciente/item** conta como "saiu" da origem.
- **Arquivo solto que não era evidência** e foi apagado: ignorado, sem registro.
- O histórico guarda uma fotografia legível de cada evidência (nome, link, prestador, paciente, item, mês, quem entregou, unidades antes e depois). Sem prazo de retenção.

## Robô 0.4.0
- A execução agendada (03:00) **lê o site inteiro** (cerca de 10 segundos). "Executar agora" continua lendo só o que mudou. `LEITURA_COMPLETA_NA_AGENDA=nao` volta ao delta diário.
- Planilha apagada deixa de contar como "tem planilha".

## Banco de dados (migrations — já aplicadas)
- `20261003100000_robo_pep_estado_atual_e_historico.sql`: estado atual de todo arquivo, histórico das evidências, retrato diário, freio, entrega que acompanha a pasta, RPCs do painel aceitando "estado atual".
- `20261003110000_pep_conferencia_mensal.sql`: conferência mensal do analista.

## Publicação
1. Migrations: já aplicadas.
2. Redeploy da tela no Coolify.
3. Redeploy do **robô** no Coolify (0.4.0), depois do passo 2.
4. Na manhã seguinte, a leitura completa das 03:00 atualiza o retrato.

## Para conferir depois de publicar
- Em Entregas PEP, o retrato mostra todos os arquivos (hoje, cerca de 100 arquivos e 77 evidências).
- Apague uma evidência já entregue na pasta de homologação e clique em "Executar agora": devem aparecer "Sumiu" e "Entrega retirada" no histórico, e o valor do mês deve ser recalculado. Devolva o arquivo e confira "Voltou".

## Pendências conhecidas
- Paciente com dois analistas no mesmo mês: o cálculo do valor guarda **um por paciente**, sem separar por analista; quem abre por último fica com ele. Falta decidir se os dois recebem ou se o valor é dividido.
- O esperado do ano usa os pacientes da Grade do mês aberto em todos os meses (aproximação).
- PIC e RT só entram no esperado quando alguém cadastra o planejamento semestral.
