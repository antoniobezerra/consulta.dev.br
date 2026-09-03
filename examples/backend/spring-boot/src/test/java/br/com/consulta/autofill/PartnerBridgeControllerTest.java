package br.com.consulta.autofill;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = PartnerBridgeController.class)
@Import({LocalRateLimiter.class, PartnerBridgeControllerTest.PropertiesConfiguration.class})
@TestPropertySource(properties = {
    "consulta.autofill.api-base-url=https://consulta.example",
    "consulta.autofill.api-key=test_server_key",
    "consulta.autofill.project-id=pub_test_project",
    "consulta.autofill.partner-origin=https://partner.example"
})
class PartnerBridgeControllerTest {
  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper objectMapper;
  @MockBean private PartnerBridgeService bridge;
  @MockBean private PartnerAccessPolicy accessPolicy;

  @BeforeEach
  void allowAuthenticatedFixture() {
    when(accessPolicy.hasAutofillAccess(any())).thenReturn(true);
  }

  @Test
  void rejectsAnUnexpectedOriginWithoutContactingTheUpstream() throws Exception {
    mvc.perform(post("/api/consulta-autofill/session")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Origin", "https://attacker.example")
            .content("{\"protocol_version\":1,\"document_type\":\"auto\"}"))
        .andExpect(status().isForbidden())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.error.code").value("INVALID_ORIGIN"));

    verify(bridge, never()).forward(eq("/api/v1/autofill/sessions"), anyMap());
  }

  @Test
  void rejectsAMissingOriginWithoutContactingTheUpstream() throws Exception {
    mvc.perform(post("/api/consulta-autofill/session")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"protocol_version\":1,\"document_type\":\"auto\"}"))
        .andExpect(status().isForbidden())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.error.code").value("INVALID_ORIGIN"));

    verify(bridge, never()).forward(eq("/api/v1/autofill/sessions"), anyMap());
  }

  @Test
  void fixesTheProjectOriginOnTheServerWhenCreatingASession() throws Exception {
    when(bridge.forward(eq("/api/v1/autofill/sessions"), anyMap())).thenReturn(new PartnerBridgeService.BridgeResponse(
        201,
        objectMapper.readTree("{\"success\":true,\"request_id\":\"req_synthetic\",\"data\":{}}")));

    mvc.perform(post("/api/consulta-autofill/session")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Origin", "https://partner.example")
            .content("{\"protocol_version\":1,\"document_type\":\"cnh-e\"}"))
        .andExpect(status().isCreated())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.success").value(true));

    verify(bridge).forward(eq("/api/v1/autofill/sessions"), eq(Map.of(
        "protocol_version", 1,
        "document_type", "cnh-e",
        "partner_origin", "https://partner.example")));
  }

  @Test
  void rejectsUnknownDecodeFields() throws Exception {
    mvc.perform(post("/api/consulta-autofill/decode")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Origin", "https://partner.example")
            .content("{\"protocol_version\":1,\"session_token\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"payload_base64\":\"QUJDRA==\",\"include_photo\":false,\"project_id\":\"pub_browser_controlled\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));

    verify(bridge, never()).forward(eq("/api/v1/autofill/decode"), anyMap());
  }

  @Test
  void rejectsUnknownMetricFields() throws Exception {
    mvc.perform(post("/api/consulta-autofill/metrics")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Origin", "https://partner.example")
            .content("{\"protocol_version\":1,\"session_token\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"event\":\"filled\",\"fields\":{\"cpf\":\"00000000000\"}}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.error.code").value("INVALID_REQUEST"));

    verify(bridge, never()).forward(eq("/api/v1/autofill/metrics"), anyMap());
  }

  @Test
  void rejectsAnonymousRequestsBeforeContactingTheUpstream() throws Exception {
    when(accessPolicy.hasAutofillAccess(any())).thenReturn(false);

    mvc.perform(post("/api/consulta-autofill/session")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Origin", "https://partner.example")
            .content("{\"protocol_version\":1,\"document_type\":\"auto\"}"))
        .andExpect(status().isUnauthorized())
        .andExpect(header().string("Cache-Control", "no-store"))
        .andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));

    verify(bridge, never()).forward(eq("/api/v1/autofill/sessions"), anyMap());
  }

  @TestConfiguration
  @EnableConfigurationProperties(PartnerBridgeProperties.class)
  static class PropertiesConfiguration {}
}
