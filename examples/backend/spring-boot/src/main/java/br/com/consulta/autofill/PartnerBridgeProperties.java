package br.com.consulta.autofill;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import java.net.URISyntaxException;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "consulta.autofill")
public class PartnerBridgeProperties {
  private String apiBaseUrl;
  private String apiKey;
  private String projectId;
  private String partnerOrigin;

  @PostConstruct
  void validate() {
    if (blank(apiBaseUrl) || blank(apiKey) || blank(projectId) || blank(partnerOrigin)) {
      throw new IllegalStateException("Defina CONSULTA_API_KEY, CONSULTA_PROJECT_ID e CONSULTA_PARTNER_ORIGIN no ambiente do servidor.");
    }
    URI api = uri(apiBaseUrl, "CONSULTA_API_BASE_URL inválida.");
    if (!"https".equals(api.getScheme()) && !localHttp(api)) {
      throw new IllegalStateException("CONSULTA_API_BASE_URL deve usar HTTPS fora de localhost.");
    }
    URI origin = uri(partnerOrigin, "CONSULTA_PARTNER_ORIGIN inválida.");
    if (!"https".equals(origin.getScheme()) || blank(origin.getHost()) || origin.getUserInfo() != null
        || !blank(origin.getPath()) || !blank(origin.getQuery()) || !blank(origin.getFragment())
        || !origin.toString().equals(partnerOrigin)) {
      throw new IllegalStateException("CONSULTA_PARTNER_ORIGIN deve ser uma origem HTTPS exata.");
    }
    apiBaseUrl = apiBaseUrl.replaceAll("/+$", "");
  }

  private static URI uri(String value, String message) {
    try {
      return new URI(value);
    } catch (URISyntaxException exception) {
      throw new IllegalStateException(message);
    }
  }

  private static boolean localHttp(URI uri) {
    return "http".equals(uri.getScheme()) && ("localhost".equals(uri.getHost()) || "127.0.0.1".equals(uri.getHost()));
  }

  private static boolean blank(String value) {
    return value == null || value.isBlank();
  }

  public String getApiBaseUrl() { return apiBaseUrl; }
  public void setApiBaseUrl(String apiBaseUrl) { this.apiBaseUrl = apiBaseUrl; }
  public String getApiKey() { return apiKey; }
  public void setApiKey(String apiKey) { this.apiKey = apiKey; }
  public String getProjectId() { return projectId; }
  public void setProjectId(String projectId) { this.projectId = projectId; }
  public String getPartnerOrigin() { return partnerOrigin; }
  public void setPartnerOrigin(String partnerOrigin) { this.partnerOrigin = partnerOrigin; }
}
