package br.com.consulta.autofill;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import org.springframework.stereotype.Service;

@Service
class PartnerBridgeService {
  private static final int MAX_UPSTREAM_BYTES = 6 * 1024 * 1024;
  private final ObjectMapper objectMapper;
  private final PartnerBridgeProperties properties;
  private final HttpClient httpClient;

  PartnerBridgeService(ObjectMapper objectMapper, PartnerBridgeProperties properties) {
    this(objectMapper, properties, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build());
  }

  PartnerBridgeService(ObjectMapper objectMapper, PartnerBridgeProperties properties, HttpClient httpClient) {
    this.objectMapper = objectMapper;
    this.properties = properties;
    this.httpClient = httpClient;
  }

  BridgeResponse forward(String path, Map<String, Object> body) {
    try {
      HttpRequest request = HttpRequest.newBuilder(URI.create(properties.getApiBaseUrl() + path))
          .timeout(Duration.ofSeconds(10))
          .header("Content-Type", "application/json")
          .header("X-API-Key", properties.getApiKey())
          .header("X-Consulta-Product", "autofill")
          .header("X-Consulta-Project-ID", properties.getProjectId())
          .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
          .build();
      HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
      byte[] bytes;
      try (InputStream stream = response.body()) {
        bytes = readLimited(stream);
      }
      try {
        JsonNode json = objectMapper.readTree(bytes);
        if (json == null || !json.isObject()) return BridgeResponse.unavailable();
        return new BridgeResponse(response.statusCode(), json);
      } finally {
        java.util.Arrays.fill(bytes, (byte) 0);
      }
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
      return BridgeResponse.unavailable();
    } catch (Exception exception) {
      // Nunca registre body, token, QR, foto ou campos de documento.
      return BridgeResponse.unavailable();
    }
  }

  private static byte[] readLimited(InputStream stream) throws IOException {
    byte[] buffer = new byte[8192];
    int total = 0;
    java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
    try {
      int read;
      while ((read = stream.read(buffer)) != -1) {
        total += read;
        if (total > MAX_UPSTREAM_BYTES) throw new IOException("response too large");
        output.write(buffer, 0, read);
      }
      return output.toByteArray();
    } finally {
      java.util.Arrays.fill(buffer, (byte) 0);
    }
  }

  record BridgeResponse(int status, JsonNode body) {
    static BridgeResponse unavailable() { return new BridgeResponse(503, null); }
  }
}
