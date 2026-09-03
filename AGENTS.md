# Consulta Autofill — regras para agentes

Este é o repositório público do Consulta Autofill. Antes de modificar código, leia `README.md`, `docs/ARCHITECTURE.md`, `SECURITY.md` e o contrato em `packages/autofill/contracts/v1/`.

## Limites absolutos

- Nunca copie código, certificados, templates, payloads, documentos, fotos, logs, banco, chaves ou variáveis do repositório privado `zuri-vio`.
- Não coloque API keys ou tokens em componentes, exemplos de frontend, fixtures, URLs, issues ou commits.
- Use somente documentos e dados sintéticos, obviamente fictícios e irreversíveis.
- Não implemente decodificação VIO neste repositório. O pacote QR trata apenas extração de bytes de QR no navegador.

## Contrato e segurança

- Qualquer mudança em `packages/autofill/contracts/v1/` é uma mudança pública de protocolo: atualize tipos, testes, documentação e exemplo correspondente.
- A API key deve permanecer no backend do parceiro.
- O iframe deve validar origem, `event.source`, versão, projeto e nonce; nunca use `targetOrigin: "*"`.
- Não adicione telemetria que registre payload, imagem, foto, campos ou dados pessoais.

## Verificação

Execute antes de abrir ou atualizar um pull request:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Use Changesets para alterações em pacotes publicáveis. Publicações ocorrem apenas por CI com Trusted Publishing/OIDC.
