using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace ConsultaAutofill.AspNetCore.Tests;

public sealed class BridgeEndpointTests : IClassFixture<BridgeFactory> {
    private readonly HttpClient _client;

    public BridgeEndpointTests(BridgeFactory factory) {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task Rejects_an_unexpected_origin_before_contacting_the_upstream() {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/consulta-autofill/session") {
            Content = JsonContent.Create(new { protocol_version = 1, document_type = "auto" }),
        };
        request.Headers.Add("Origin", "https://attacker.example");

        using var response = await _client.SendAsync(request);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal("INVALID_ORIGIN", body.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task Rejects_a_browser_controlled_unknown_decode_field() {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/consulta-autofill/decode") {
            Content = JsonContent.Create(new {
                protocol_version = 1,
                session_token = new string('a', 32),
                payload_base64 = "QUJDRA==",
                include_photo = false,
                project_id = "pub_browser_controlled",
            }),
        };
        request.Headers.Add("Origin", "https://partner.example");

        using var response = await _client.SendAsync(request);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("INVALID_REQUEST", body.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task Rejects_a_browser_controlled_metric_field() {
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/consulta-autofill/metrics") {
            Content = JsonContent.Create(new {
                protocol_version = 1,
                session_token = new string('a', 32),
                @event = "filled",
                fields = new { cpf = "00000000000" },
            }),
        };
        request.Headers.Add("Origin", "https://partner.example");

        using var response = await _client.SendAsync(request);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("INVALID_REQUEST", body.GetProperty("error").GetProperty("code").GetString());
    }
}

public sealed class BridgeFactory : WebApplicationFactory<Program> {
    private readonly Dictionary<string, string?> _originalEnvironment = new();

    public BridgeFactory() {
        SetEnvironment("CONSULTA_API_BASE_URL", "http://127.0.0.1:1");
        SetEnvironment("CONSULTA_API_KEY", "test_server_key");
        SetEnvironment("CONSULTA_PROJECT_ID", "pub_test_project");
        SetEnvironment("CONSULTA_PARTNER_ORIGIN", "https://partner.example");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder) {
        builder.UseEnvironment("Testing");
    }

    protected override void Dispose(bool disposing) {
        if (disposing) {
            foreach (var (name, previousValue) in _originalEnvironment) {
                Environment.SetEnvironmentVariable(name, previousValue);
            }
        }
        base.Dispose(disposing);
    }

    private void SetEnvironment(string name, string value) {
        _originalEnvironment[name] = Environment.GetEnvironmentVariable(name);
        Environment.SetEnvironmentVariable(name, value);
    }
}
