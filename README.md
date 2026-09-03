# Consulta Autofill

**Preencha cadastros com documentos oficiais em segundos.**

Consulta Autofill é o componente público do ecossistema `consulta.dev.br`. Ele oferece uma experiência de câmera, arquivo, PDF, revisão e preenchimento de formulários para documentos com QR Code, sem expor a chave da API do parceiro no navegador.

> Este repositório não contém o decodificador VIO, documentos, payloads reais, chaves ou dados pessoais. A infraestrutura privada de decodificação continua no serviço Consulta.

## Como a integração funciona

```text
Formulário do parceiro
  → @consulta-dev/autofill
  → iframe oficial da Consulta
  → endpoint do parceiro
  → API privada da Consulta
  → revisão e preenchimento confirmado
```

O navegador processa a imagem e extrai o QR localmente. A chamada autenticada para a API passa exclusivamente pelo backend do parceiro.

## Pacotes

| Pacote | Finalidade | Estado |
|---|---|---|
| `@consulta-dev/autofill` | Web Component e contrato público | Em desenvolvimento |
| `@consulta-dev/qr-engine` | Interface de leitura de QR no navegador | Em desenvolvimento |
| `apps/embed` | Aplicação hospedada no iframe | Em desenvolvimento |

## Desenvolvimento

Requer Node.js 24 e pnpm 11.

```bash
corepack enable
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Para testes end-to-end, instale o navegador uma vez:

```bash
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

## Segurança e privacidade

- A API key nunca pertence ao cliente web.
- Um projeto só pode ser usado nas origens HTTPS exatas autorizadas.
- A comunicação iframe/página valida origem, janela, versão e nonce.
- Nenhum payload, imagem, foto ou campo decodificado deve ser enviado para analytics ou logs públicos.
- O componente não substitui campos existentes sem confirmação explícita.

Leia [a arquitetura](docs/ARCHITECTURE.md) e a [política de segurança](SECURITY.md) antes de integrar ou contribuir.

O guia com o componente, a ponte same-origin, CSP/Permissions Policy e exemplos de servidor está em [docs/INTEGRATION.md](docs/INTEGRATION.md).

Para a integração HTML mais curta, use `<consulta-autofill-field>`: ele posiciona o botão de câmera acessível dentro de um `input` nativo e abre o fluxo hospedado após o toque.

Os exemplos de ponte segura para Next.js, Express, Laravel, FastAPI e Go ficam em [examples/backend](examples/backend).

O schema de referência do contrato v1 está em [packages/autofill/contracts/v1/autofill.schema.json](packages/autofill/contracts/v1/autofill.schema.json). Ele é distribuído junto com `@consulta-dev/autofill`.

## Status

O repositório está no início da implementação pública. A API e o produto de produção não devem ser assumidos como estáveis até a primeira release `v1`.

## Licença

Código próprio licenciado sob [Apache-2.0](LICENSE). Dependências e artefatos de terceiros têm seus avisos em [third-party](third-party/README.md).
