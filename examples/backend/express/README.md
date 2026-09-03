# Exemplo Express

Ponte same-origin de referência para `@consulta-dev/autofill`. A API key fica somente no processo Node.

```bash
cp .env.example .env
npm install
npm start
```

Para executar os testes da ponte com upstream sintético:

```bash
npm test
```

Exponha o componente com `endpoint="/api/consulta-autofill"` e, para o funil
sem PII, `metrics-endpoint="/api/consulta-autofill/metrics"`. Antes de
produção, passe a sua verificação de sessão/RBAC server-side para a opção
`authorize` de `createApp`; a política padrão nega tudo com `401`. Não derive
acesso de `project-id`, QR, payload ou token estático enviado pelo browser.
Substitua também o rate limit em memória por Redis ou equivalente
compartilhado.

O exemplo não registra corpo de request/response, QR, token, foto ou campos. Consulte [a integração completa](../../../docs/INTEGRATION.md).
