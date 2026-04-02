# 🏛️ Monitor Proposições AM — ALE-AM

Monitora automaticamente a API SAPL da Assembleia Legislativa do Amazonas e envia email quando há proposições novas. Roda **4x por dia** via GitHub Actions (8h, 12h, 17h e 21h, horário de Brasília).

---

## Como funciona

1. O GitHub Actions roda o script nos horários configurados
2. O script chama a API REST pública da ALE-AM (`sapl.al.am.leg.br/api`)
3. Compara as proposições recebidas com as já registradas no `estado.json`
4. Se há proposições novas → envia email com a lista organizada por tipo
5. Salva o estado atualizado no repositório

---

## Estrutura do repositório

```
monitor-proposicoes-am/
├── monitor.js                      # Script principal
├── package.json                    # Dependências (só nodemailer)
├── estado.json                     # Estado salvo automaticamente pelo workflow
├── README.md                       # Este arquivo
└── .github/
    └── workflows/
        └── monitor.yml             # Workflow do GitHub Actions
```

---

## Setup — Passo a Passo

### PARTE 1 — Preparar o Gmail

> Se você já tem uma Senha de App de outro monitor, pode reutilizá-la. Pule para a Parte 2.

**1.1** Acesse [myaccount.google.com/security](https://myaccount.google.com/security)

**1.2** Certifique-se de que a **Verificação em duas etapas** está ativa.

**1.3** Procure por **"Senhas de app"** e clique.

**1.4** Digite o nome `monitor-aleam` e clique em **Criar**.

**1.5** Copie a senha de **16 letras** gerada — ela só aparece uma vez.

---

### PARTE 2 — Criar o repositório no GitHub

**2.1** Acesse [github.com](https://github.com) → **+ → New repository**

**2.2** Preencha:
- **Repository name:** `monitor-proposicoes-am`
- **Visibility:** Private

**2.3** Clique em **Create repository**

---

### PARTE 3 — Fazer upload dos arquivos

**3.1** Na página do repositório, clique em **"uploading an existing file"**

**3.2** Faça upload de:
```
monitor.js
package.json
README.md
```
Clique em **Commit changes**.

**3.3** O `monitor.yml` precisa estar em `.github/workflows/`. Clique em **Add file → Create new file** e digite:
```
.github/workflows/monitor.yml
```
Cole o conteúdo do arquivo `monitor.yml` e clique em **Commit changes**.

---

### PARTE 4 — Configurar os Secrets

**4.1** No repositório: **Settings → Secrets and variables → Actions**

**4.2** Clique em **New repository secret** e crie os 3 secrets:

| Name | Valor |
|------|-------|
| `EMAIL_REMETENTE` | seu Gmail (ex: seuemail@gmail.com) |
| `EMAIL_SENHA` | a senha de 16 letras do App Password (sem espaços) |
| `EMAIL_DESTINO` | email onde quer receber os alertas |

---

### PARTE 5 — Testar

**5.1** Vá em **Actions → Monitor Proposições AM → Run workflow → Run workflow**

**5.2** Aguarde ~15 segundos. Verde = funcionou.

**5.3** O log deve mostrar algo como:
```
📊 Total de proposições em 2026: 350 (4 páginas)
📊 Total coletado: 350 proposições
🆕 Proposições novas: 350
✅ Email enviado com 350 proposições novas.
```

**5.4** O **primeiro run** envia email com todas as proposições do ano e salva o estado. A partir do segundo run, só envia se houver novidades.

---

## API utilizada

```
URL Base:  https://sapl.al.am.leg.br/api
Endpoint:  GET /materia/materialegislativa/?ano=2026&page=1&page_size=100&o=-data_apresentacao
Docs:      https://sapl.al.am.leg.br/api/schema/swagger-ui/
```

API pública REST (SAPL 3.1), sem autenticação, sem reCAPTCHA. Resposta paginada com campos `count`, `next`, `previous`, `results`.

---

## Email recebido

O email chega organizado por tipo, com número em ordem decrescente:

```
🏛️ ALE-AM — 5 nova(s) proposição(ões)

INDICAÇÃO — 2 proposição(ões)
  450/2026 | Dep. Fulano     | 27/03/2026 | Indica pavimentação...
  449/2026 | Dep. Ciclano    | 27/03/2026 | Indica iluminação...

PROJETO DE LEI ORDINÁRIA — 1 proposição(ões)
  101/2026 | Dep. Beltrano   | 27/03/2026 | Dispõe sobre...

REQUERIMENTO — 2 proposição(ões)
  792/2026 | Dep. Fulano     | 27/03/2026 | Requer informações...
  791/2026 | Dep. Ciclano    | 27/03/2026 | Requer envio de...
```

---

## Horários de execução

| Horário BRT | Cron UTC |
|-------------|----------|
| 08:00       | 0 11 * * * |
| 12:00       | 0 15 * * * |
| 17:00       | 0 20 * * * |
| 21:00       | 0 0 * * *  |

---

## Resetar o estado

Para forçar o reenvio de todas as proposições:

1. No repositório, clique em `estado.json` → lápis
2. Substitua o conteúdo por:
```json
{"proposicoes_vistas":[],"ultima_execucao":""}
```
3. Commit → rode o workflow manualmente

---

## Problemas comuns

**Não aparece "Senhas de app" no Google**
→ Ative a verificação em duas etapas primeiro.

**Erro "Authentication failed" no log**
→ Verifique se `EMAIL_SENHA` foi colado sem espaços.

**Workflow não aparece em Actions**
→ Confirme que o arquivo está em `.github/workflows/monitor.yml`.

**Log mostra "0 proposições encontradas"**
→ A API da ALE-AM pode estar fora do ar. Acesse `https://sapl.al.am.leg.br/api/materia/materialegislativa/?ano=2026&page=1&page_size=5` no browser para confirmar.

**Campo "Autor" aparece como "-"**
→ A API SAPL às vezes retorna o autor como URL aninhada. O script tenta resolver automaticamente, mas se a API estiver lenta pode falhar. O email ainda é enviado, só sem o nome do autor.
