package br.com.consulta.autofill;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class PartnerBridgeServiceTest {
  private HttpServer upstream;

  @AfterEach
  void stopUpstream() {
    if (upstream != null) upstream.stop(0);
  }

  @Test
  void forwardsOnlyThePinnedServerCredentials() throws Exception {
    AtomicBoolean expectedHeaders = new AtomicBoolean(false);
    upstream = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    upstream.createContext("/api/v1/autofill/sessions", exchange -> {
      expectedHeaders.set(
          "test_server_key".equals(exchange.getRequestHeaders().getFirst("X-API-Key"))
              && "autofill".equals(exchange.getRequestHeaders().getFirst("X-Consulta-Product"))
              && "pub_test_project".equals(exchange.getRequestHeaders().getFirst("X-Consulta-Project-ID")));
      byte[] response = "{\"success\":true,\"request_id\":\"req_synthetic\",\"data\":{}}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
      exchange.getResponseHeaders().set("Content-Type", "application/json");
      exchange.sendResponseHeaders(201, response.length);
      exchange.getResponseBody().write(response);
      java.util.Arrays.fill(response, (byte) 0);
      exchange.close();
    });
    upstream.start();

    PartnerBridgeProperties properties = new PartnerBridgeProperties();
    properties.setApiBaseUrl("http://127.0.0.1:" + upstream.getAddress().getPort());
    properties.setApiKey("test_server_key");
    properties.setProjectId("pub_test_project");
    properties.setPartnerOrigin("https://partner.example");
    properties.validate();
    PartnerBridgeService service = new PartnerBridgeService(
        new ObjectMapper(),
        properties,
        java.net.http.HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build());

    PartnerBridgeService.BridgeResponse result = service.forward("/api/v1/autofill/sessions", Map.of(
        "protocol_version", 1,
        "document_type", "auto",
        "partner_origin", "https://partner.example"));

    assertEquals(201, result.status());
    assertTrue(expectedHeaders.get());
    assertTrue(result.body().path("success").asBoolean());
  }
}
