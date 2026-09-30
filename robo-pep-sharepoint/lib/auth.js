/**
 * Autenticação no Microsoft Graph com CERTIFICADO (nunca segredo de cliente).
 *
 * O app "Pulsar - Robo PEP SharePoint" no Entra ID tem só `Sites.Selected`
 * com papel `read` num único site. Mesmo que esta chave vaze, quem a tiver lê
 * aquele site e nada mais — e o administrador revoga o certificado com um
 * clique, sem afetar o outro (Dev e Produção são certificados separados).
 *
 * De onde vem a chave (nesta ordem):
 *   SHAREPOINT_CERT_KEY_B64   PEM da chave privada em base64 (Coolify)
 *   SHAREPOINT_CERT_KEY_PATH  caminho do .key.pem (máquina de desenvolvimento,
 *                             FORA do repositório: C:\Users\...\.pulsar-sharepoint)
 * O certificado público (para calcular a impressão digital, em vez de alguém
 * digitar 40 caracteres à mão):
 *   SHAREPOINT_CERT_B64 / SHAREPOINT_CERT_PATH
 */

const fs = require('fs')
const crypto = require('crypto')
const msal = require('@azure/msal-node')

const ESCOPO_GRAPH = ['https://graph.microsoft.com/.default']

function lerPem(varB64, varCaminho, rotulo) {
  if (process.env[varB64]) return Buffer.from(process.env[varB64], 'base64').toString('utf8')
  if (process.env[varCaminho]) return fs.readFileSync(process.env[varCaminho], 'utf8')
  throw Object.assign(new Error(`${rotulo} ausente: defina ${varB64} ou ${varCaminho}`), { fatal: true })
}

function carregarCredencial() {
  const privateKey = lerPem('SHAREPOINT_CERT_KEY_B64', 'SHAREPOINT_CERT_KEY_PATH', 'Chave privada do certificado')
  const certificado = new crypto.X509Certificate(lerPem('SHAREPOINT_CERT_B64', 'SHAREPOINT_CERT_PATH', 'Certificado público'))

  // A chave e o certificado têm que ser do MESMO par. Trocar o .crt de Dev
  // com a .key de Produção dá um erro opaco do Entra ("AADSTS700027"); aqui
  // o erro sai com nome.
  const publica = crypto.createPublicKey(privateKey)
  if (!publica.export({ type: 'spki', format: 'der' }).equals(certificado.publicKey.export({ type: 'spki', format: 'der' }))) {
    throw Object.assign(new Error('A chave privada não corresponde ao certificado informado (pares trocados?)'), { fatal: true })
  }

  const validoAte = new Date(certificado.validTo)
  const hex = (fp) => fp.replace(/:/g, '').toUpperCase()
  return {
    privateKey,
    thumbprintSha256: hex(certificado.fingerprint256),
    thumbprintSha1: hex(certificado.fingerprint),
    assunto: certificado.subject.replace(/^CN=/, ''),
    validoAte,
    diasRestantes: Math.floor((validoAte.getTime() - Date.now()) / 86400000),
  }
}

function criarAutenticador({ tenantId, clientId }) {
  if (!tenantId) throw Object.assign(new Error('AZURE_TENANT_ID não definido'), { fatal: true })
  if (!clientId) throw Object.assign(new Error('AZURE_CLIENT_ID não definido'), { fatal: true })

  const cred = carregarCredencial()
  const app = new msal.ConfidentialClientApplication({
    auth: {
      clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientCertificate: { thumbprintSha256: cred.thumbprintSha256, privateKey: cred.privateKey },
    },
    system: { loggerOptions: { logLevel: msal.LogLevel.Error, piiLoggingEnabled: false } },
  })

  return {
    credencial: { assunto: cred.assunto, thumbprintSha1: cred.thumbprintSha1, validoAte: cred.validoAte, diasRestantes: cred.diasRestantes },
    /** Token de acesso; a MSAL guarda em cache e só vai ao Entra quando expira. */
    async obterToken() {
      const r = await app.acquireTokenByClientCredential({ scopes: ESCOPO_GRAPH })
      if (!r?.accessToken) throw new Error('Entra ID não devolveu token de acesso')
      return r.accessToken
    },
  }
}

module.exports = { criarAutenticador, carregarCredencial }
