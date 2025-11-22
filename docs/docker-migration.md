# Migração para Sandbox Docker

Este guia descreve como transicionar de execuções anteriores (que usavam o
sandbox da Vercel) para o novo fluxo **totalmente baseado em Docker**.

> **Escopo:** somente credenciais, modelos de IA e a configuração do GitHub App
> devem ser preservados. Todos os demais recursos serão destruídos.

## 1. Catálogo do que permanece

Use o arquivo [`GITHUB_APP_CONFIG.txt`](../GITHUB_APP_CONFIG.txt) para listar **onde**
cada segredo está armazenado (Key Vault, Vercel Project, etc.). Não salve os
valores em texto plano. Recomenda-se registrar pelo menos:

- `SANDBOX_VERCEL_TOKEN`, `SANDBOX_VERCEL_TEAM_ID`, `SANDBOX_VERCEL_PROJECT_ID`
- `JWE_SECRET`, `ENCRYPTION_KEY`, `POSTGRES_URL`
- Chaves de modelos (Anthropic, OpenAI, Gemini, Cursor, etc.)
- Dados do GitHub App (nome, ID, callback URLs)

## 2. Limpeza automatizada dos recursos antigos

Execute o script abaixo a partir da raiz do projeto. Ele remove contêineres,
imagens e volumes associados aos nomes anteriores (`coding-agent-app`,
`coding-agent-template-app`, etc.).

```powershell
pwsh ./scripts/reset-docker-sandbox.ps1
```

Para um *dry-run*, utilize `-WhatIf`.

### O que o script faz

1. Remove contêineres que tenham nome explícito (`coding-agent-app`,
   `a49bbcc9908a`) ou que possuam o rótulo `coding-agent-template`.
2. Remove a imagem `coding-agent-template-app:latest` (ou outras passadas via
   parâmetro `-ImageNames`).
3. Remove volumes cujo nome comece com `sandbox-`, `coding-agent-app` ou
   `coding-agent-template`. Ajuste o parâmetro `-VolumePrefixes` caso precise
   preservar algum volume específico.

> Caso deseje manter apenas determinados dados, exporte-os antes de executar o
> script. As credenciais/modelos/GitHub listados no passo anterior não são
> impactados.

## 3. Recriação automática via Docker

1. Suba o Postgres local (porta 5433) com `docker compose up -d postgres`.
2. Configure as variáveis de ambiente normalmente (`.env.local`).
3. Execute o app (`pnpm dev`) – o novo provider Docker criará contêineres por
   tarefa, com volumes dedicados `<sandboxId>-workspace` e `<sandboxId>-cache`.

As portas expostas passam a depender da task (padrão 3000/5173). Nenhum recurso
antigo fica em uso.
