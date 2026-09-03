using System.Net;
using System.Text;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace ConsultaAutofill.AspNetCore.Tests;

public sealed class PartnerBridgeServiceTests {
    [Fact]
    public async Task Forwards_only_the_server_configured_credentials() {
        var handler = new CapturingHandler();
        var settings = new PartnerSettings {
            ApiBaseUrl = "https://consulta.example",
            ApiKey = "test_server_key",
            ProjectId = "pub_test_project",
            PartnerOrigin = "https://partner.example",
        };
        using var client = new HttpClient(handler) { BaseAddress = new Uri(settings.ApiBaseUrl) };
        var bridge = new PartnerBridgeService(client, settings);

        var result = await bridge.ForwardAsync("/api/v1/autofill/sessions", new {
            protocol_version = 1,
            document_type = "auto",
            partner_origin = settings.PartnerOrigin,
        }, CancellationToken.None);

        Assert.Equal(StatusCodes.Status201Created, result.StatusCode);
        Assert.NotNull(result.Body);
        Assert.True(result.Body!.Value.GetProperty("success").GetBoolean());
        Assert.Equal("test_server_key", handler.ApiKey);
        Assert.Equal("autofill", handler.Product);
        Assert.Equal("pub_test_project", handler.ProjectId);
    }

    private sealed class CapturingHandler : HttpMessageHandler {
        public string? ApiKey { get; private set; }
        public string? Product { get; private set; }
        public string? ProjectId { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) {
            ApiKey = request.Headers.GetValues("X-API-Key").SingleOrDefault();
            Product = request.Headers.GetValues("X-Consulta-Product").SingleOrDefault();
            ProjectId = request.Headers.GetValues("X-Consulta-Project-ID").SingleOrDefault();
            if (request.Content is not null) {
                var content = await request.Content.ReadAsByteArrayAsync(cancellationToken);
                Array.Clear(content, 0, content.Length);
            }
            return new HttpResponseMessage(HttpStatusCode.Created) {
                Content = new StringContent("{\"success\":true,\"request_id\":\"req_synthetic\",\"data\":{}}", Encoding.UTF8, "application/json"),
            };
        }
    }
}
