package br.com.consulta.autofill;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/consulta-autofill")
class PartnerBridgeController {
  private static final int MAX_BODY_BYTES = 1_000_000;
  private static final Pattern BASE64 = Pattern.compile("^[A-Za-z0-9+/]+={0,2}$");
  private final ObjectMapper strictObjectMapper;
  private final PartnerBridgeProperties properties;
  private final PartnerBridgeService bridge;
  private final LocalRateLimiter rateLimiter;

  PartnerBridgeController(ObjectMapper objectMapper, PartnerBridgeProperties properties, PartnerBridgeService bridge, LocalRateLimiter rateLimiter) {
    this.strictObjectMapper = objectMapper.copy().enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    this.properties = properties;
    this.bridge = bridge;
    this.rateLimiter = rateLimiter;
  }

  @PostMapping(value = "/session", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
  ResponseEntity<?> session(
      @RequestBody byte[] body,
      @RequestHeader(value = "Origin", required = false) String origin,
      HttpServletRequest request) {
    try {
      ResponseEntity<?> guard = guard(origin, request, "session", 20, body);
      if (guard != null) return guard;
      SessionInput input = strictObjectMapper.readValue(body, SessionInput.class);
      if (input.protocolVersion() != 1 || !validDocumentType(input.documentType())) return invalid("Sessão Autofill inválida.");
      return relay(bridge.forward("/api/v1/autofill/sessions", Map.of(
          "protocol_version", input.protocolVersion(),
          "document_type", input.documentType(),
          "partner_origin", properties.getPartnerOrigin())));
    } catch (Exception exception) {
      return invalid("Sessão Autofill inválida.");
    } finally {
      java.util.Arrays.fill(body, (byte) 0);
    }
  }

  @PostMapping(value = "/decode", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
  ResponseEntity<?> decode(
      @RequestBody byte[] body,
      @RequestHeader(value = "Origin", required = false) String origin,
      HttpServletRequest request) {
    try {
      ResponseEntity<?> guard = guard(origin, request, "decode", 60, body);
      if (guard != null) return guard;
      DecodeInput input = strictObjectMapper.readValue(body, DecodeInput.class);
      if (!validDecode(input)) return invalid("Decode Autofill inválido.");
      return relay(bridge.forward("/api/v1/autofill/decode", Map.of(
          "protocol_version", input.protocolVersion(),
          "session_token", input.sessionToken(),
          "payload_base64", input.payloadBase64(),
          "include_photo", input.includePhoto())));
    } catch (Exception exception) {
      return invalid("Decode Autofill inválido.");
    } finally {
      java.util.Arrays.fill(body, (byte) 0);
    }
  }

  private ResponseEntity<?> guard(String origin, HttpServletRequest request, String scope, int limit, byte[] body) {
    if (body.length > MAX_BODY_BYTES) return error("INVALID_REQUEST", "A requisição Autofill é inválida.", 400);
    if (origin != null && !origin.equals(properties.getPartnerOrigin())) return error("INVALID_ORIGIN", "Origem não autorizada.", 403);
    if (!requirePartnerAccess(request)) return error("UNAUTHENTICATED", "Não autorizado.", 401);
    String key = scope + ":" + request.getRemoteAddr();
    if (!rateLimiter.allow(key, limit)) return error("RATE_LIMITED", "Muitas solicitações; tente novamente em breve.", 429);
    return null;
  }

  private static boolean requirePartnerAccess(HttpServletRequest request) {
    // Conecte à sessão/RBAC do seu produto antes de produção. Nunca escolha
    // projeto ou credencial a partir de dados do browser.
    return true;
  }

  private static boolean validDocumentType(String value) {
    return "auto".equals(value) || "cnh-e".equals(value) || "crlv-e".equals(value);
  }

  private static boolean validDecode(DecodeInput input) {
    return input.protocolVersion() == 1 && input.includePhoto() != null && input.sessionToken() != null
        && input.sessionToken().length() >= 32 && input.sessionToken().length() <= 4096
        && input.payloadBase64() != null && input.payloadBase64().length() >= 4
        && input.payloadBase64().length() <= MAX_BODY_BYTES && BASE64.matcher(input.payloadBase64()).matches();
  }

  private static ResponseEntity<?> relay(PartnerBridgeService.BridgeResponse response) {
    if (response.body() == null) return error("UPSTREAM_UNAVAILABLE", "Serviço temporariamente indisponível.", 503);
    return ResponseEntity.status(response.status()).cacheControl(CacheControl.noStore()).body(response.body());
  }

  private static ResponseEntity<?> invalid(String message) { return error("INVALID_REQUEST", message, 400); }

  private static ResponseEntity<?> error(String code, String message, int status) {
    return ResponseEntity.status(status)
        .header(HttpHeaders.CACHE_CONTROL, "no-store")
        .contentType(MediaType.APPLICATION_JSON)
        .body(Map.of("success", false, "error", Map.of("code", code, "message", message, "retryable", status >= 500), "request_id", "partner_local"));
  }

  record SessionInput(@JsonProperty("protocol_version") int protocolVersion, @JsonProperty("document_type") String documentType) {}
  record DecodeInput(
      @JsonProperty("protocol_version") int protocolVersion,
      @JsonProperty("session_token") String sessionToken,
      @JsonProperty("payload_base64") String payloadBase64,
      @JsonProperty("include_photo") Boolean includePhoto) {}
}
