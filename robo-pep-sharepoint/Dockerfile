# robo-pep-sharepoint — container do Coolify.
#
# Nada de segredo aqui: token da máquina, IDs do Entra e a chave do
# certificado entram como variáveis de ambiente (Secret) no Coolify, em tempo
# de execução. A imagem pode ser vista por qualquer um sem expor nada.
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8080 \
    TZ=America/Sao_Paulo

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY lib ./lib
COPY worker.js ./

# Usuário sem privilégio (já existe na imagem oficial do Node).
USER node

EXPOSE 8080

# O Coolify usa isto para saber se o robô está de pé. 503 = configuração
# inválida (credencial ausente/errada): aparece como "unhealthy", não como
# reinício em laço.
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "worker.js"]
