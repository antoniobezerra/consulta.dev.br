# Exemplo Next.js

Copie `app/api/consulta-autofill/[action]/route.ts` para um projeto Next.js App Router, copie `.env.example` para `.env.local` e configure as variáveis. O cliente usa `endpoint="/api/consulta-autofill"` e, opcionalmente, `metrics-endpoint="/api/consulta-autofill/metrics"`; a API key não é exposta no bundle.

O diretório também inclui um teste do Route Handler com upstream sintético. Em Node 24+:

```bash
npm test
```

O handler faz body limit, valida a origem exata, fixa o projeto no servidor e usa timeout no upstream. Conecte o comentário `assertPartnerAccess` à sessão/autorização do seu produto antes de produção.

Leia também [docs/INTEGRATION.md](../../../docs/INTEGRATION.md).
