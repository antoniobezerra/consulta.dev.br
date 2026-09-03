# Exemplo Next.js

Copie `app/api/consulta-autofill/[action]/route.ts` para um projeto Next.js App Router, copie `.env.example` para `.env.local` e configure as variáveis. O cliente usa apenas `endpoint="/api/consulta-autofill"`; a API key não é exposta no bundle.

O handler faz body limit, valida a origem exata, fixa o projeto no servidor e usa timeout no upstream. Conecte o comentário `assertPartnerAccess` à sessão/autorização do seu produto antes de produção.

Leia também [docs/INTEGRATION.md](../../../docs/INTEGRATION.md).
