# Integração do Consulta Autofill

O Consulta Autofill preenche formulários a partir de CNH-e e CRLV-e sem colocar a API key no navegador. O componente abre um iframe oficial para câmera, imagem, PDF e revisão; o seu servidor cria a sessão e encaminha o QR para a API Consulta.

> Os pacotes ainda não foram publicados no npm. Até a primeira release, use este repositório e os exemplos como referência de integração; não aponte produção para um branch Git.

## 1. Configure o servidor do parceiro

Defina estes valores apenas no ambiente do servidor:

```text
CONSULTA_API_BASE_URL=https://consulta.dev.br
CONSULTA_API_KEY=...
CONSULTA_PROJECT_ID=pub_...
CONSULTA_PARTNER_ORIGIN=https://cadastro.exemplo.com.br
```

`CONSULTA_PARTNER_ORIGIN` deve ser a origem HTTPS exata cadastrada no projeto Autofill. Não receba esse valor no corpo do browser e não aceite wildcard.

Seu servidor expõe dois endpoints same-origin:

```text
POST /api/consulta-autofill/session
POST /api/consulta-autofill/decode
```

Cada exemplo em [`examples/backend`](../examples/backend) implementa essa ponte para uma stack específica.

## 2. Adicione o componente ao formulário

Quando o pacote estiver publicado, carregue uma versão exata pelo npm ou pelo CDN oficial. Para desenvolvimento, importe o build local do monorepo.

```html
<form id="cadastro">
  <label>
    Nome completo
    <input name="name" data-consulta-field="full_name" />
  </label>

  <label>
    CPF
    <input name="cpf" data-consulta-field="cpf" />
  </label>

  <consulta-autofill
    project-id="pub_..."
    endpoint="/api/consulta-autofill"
    target-form="#cadastro"
    document-type="auto"
    label="Preencher com documento">
  </consulta-autofill>
</form>
```

O `project-id` é público e serve para consistência visual/protocolo. A associação real entre API key e projeto é feita pelo seu servidor, com `CONSULTA_PROJECT_ID`; nunca confie no atributo enviado pelo navegador para escolher uma credencial.

Campos com `data-consulta-field` são preenchidos somente se estiverem vazios. A pessoa revisa os dados antes de confirmar e pode editar os valores no iframe.

## 3. Eventos e frameworks controlados

O componente emite eventos no próprio elemento:

| Evento | Uso |
|---|---|
| `consulta:ready` | O componente foi registrado. |
| `consulta:opened` | Uma sessão curta foi criada. |
| `consulta:decoded` | A API retornou dados; o detalhe não contém os valores dos campos. |
| `consulta:confirmed` | A pessoa confirmou a revisão. |
| `consulta:filled` | Contém `fields`, `filled`, `preserved` e `document`; use para atualizar estado controlado. |
| `consulta:error` | Erro seguro para a interface; não envie o detalhe para analytics se puder conter contexto do cadastro. |

Em React, Vue e Angular controlados, consuma `consulta:filled` em vez de depender apenas de `input.value`:

```js
document.querySelector("consulta-autofill")?.addEventListener("consulta:filled", (event) => {
  const { fields } = event.detail;
  // Atualize o estado do framework somente com os campos que a pessoa confirmou.
  setRegistration((previous) => ({ ...previous, ...fields }));
});
```

## 4. Contrato da ponte do parceiro

O browser fala somente com os endpoints do parceiro. O componente envia:

```json
// POST /session
{ "protocol_version": 1, "document_type": "auto" }

// POST /decode
{
  "protocol_version": 1,
  "session_token": "...",
  "payload_base64": "...",
  "include_photo": false
}
```

O servidor do parceiro acrescenta seus próprios headers ao chamar a Consulta:

```http
X-API-Key: <CONSULTA_API_KEY>
X-Consulta-Product: autofill
X-Consulta-Project-ID: <CONSULTA_PROJECT_ID>
Content-Type: application/json
```

Para criar uma sessão, ele também envia a origem fixa do ambiente:

```json
{
  "protocol_version": 1,
  "document_type": "auto",
  "partner_origin": "https://cadastro.exemplo.com.br"
}
```

Repasse o envelope de sucesso/erro preservando o status HTTP. Não logue `payload_base64`, `session_token`, foto, arquivo, campos ou corpo de resposta.

## 5. Foto e privacidade

A foto é desligada por padrão no projeto e na interface. Mesmo para um projeto com foto habilitada, a pessoa precisa marcar a caixa de confirmação antes do decode. O parceiro não deve alterar `include_photo` para `true` no servidor.

O Autofill não dispara o webhook `document.decoded`; se o parceiro precisar de um evento de negócio, faça isso após salvar o cadastro sob as próprias regras de autorização e retenção.

## 6. Headers de produção

Permita o iframe oficial e delegue câmera somente para ele. Ajuste os hosts de acordo com o ambiente contratado:

```http
Content-Security-Policy: frame-src https://embed.consulta.dev.br; script-src 'self' https://cdn.consulta.dev.br
Permissions-Policy: camera=(self "https://embed.consulta.dev.br")
```

O componente já cria o iframe com `sandbox="allow-scripts allow-same-origin"` e `allow="camera"`. Não relaxe esse sandbox e não use `postMessage(..., "*")` em integrações customizadas.

## 7. Erros e recuperação

Erros têm formato estável:

```json
{
  "success": false,
  "error": {
    "code": "SESSION_EXPIRED",
    "message": "A sessão do Autofill expirou.",
    "retryable": true
  },
  "request_id": "req_..."
}
```

- Crie uma sessão nova em `SESSION_EXPIRED` e `SESSION_REPLAYED`.
- Mostre nova tentativa para `QR_NOT_FOUND`, `CAMERA_DENIED` e `CAMERA_UNAVAILABLE`.
- Respeite `429`/`RATE_LIMITED`; não faça retry automático em loop.
- Trate `UPSTREAM_UNAVAILABLE` como erro temporário e guarde apenas `request_id` para suporte.

O schema distribuído fica em [`packages/autofill/contracts/v1/autofill.schema.json`](../packages/autofill/contracts/v1/autofill.schema.json).
