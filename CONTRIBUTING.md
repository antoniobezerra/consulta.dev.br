# Contribuindo

Obrigado por contribuir com o Consulta Autofill.

## Regras de segurança

Não abra issues, pull requests ou commits contendo:

- chaves, tokens, cookies ou arquivos `.env`;
- payloads VIO, QR Codes de documentos, fotos ou dados pessoais;
- corpus privado, certificados, templates internos ou logs de produção;
- código do serviço privado de decodificação.

Use apenas fixtures sintéticas e irreversíveis para testes públicos.

## Fluxo de trabalho

1. Crie uma branch curta a partir de `main`.
2. Mantenha a mudança focada em uma responsabilidade.
3. Execute `pnpm sanitize:public`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` e `pnpm test:e2e`.
4. Adicione um changeset para qualquer alteração em pacote publicável.
5. Explique impacto de compatibilidade, segurança e privacidade no pull request.

Mudanças no protocolo, origem permitida, telemetria, autenticação ou publicação exigem revisão de mantenedores.

## Commits

Prefira Conventional Commits, por exemplo `feat(autofill): add session handshake` ou `fix(embed): validate parent origin`.
