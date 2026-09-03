using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

const int MaxBodyBytes = 1_000_000;
const int MaxMetricBodyBytes = 4_096;

var builder = WebApplication.CreateBuilder(args);
var settings = PartnerSettings.From(builder.Configuration);
if (int.TryParse(builder.Configuration["PORT"], out var port) && port is > 0 and <= 65535) {
    builder.WebHost.UseUrls($"http://0.0.0.0:{port}");
}
builder.Services.AddSingleton(settings);
builder.Services.AddSingleton<PartnerRateLimiter>();
// Replace this fail-closed policy with an adapter to the partner application's
// authenticated principal and RBAC rules before exposing the bridge.
builder.Services.AddSingleton<IPartnerAccessPolicy, DenyPartnerAccessPolicy>();
builder.Services.AddHttpClient<PartnerBridgeService>((_, client) => {
    client.BaseAddress = new Uri(settings.ApiBaseUrl);
    client.Timeout = TimeSpan.FromSeconds(10);
});

var app = builder.Build();

app.MapPost("/api/consulta-autofill/session", async (
    HttpRequest request,
    HttpResponse response,
    PartnerSettings options,
    PartnerRateLimiter limiter,
    IPartnerAccessPolicy accessPolicy,
    PartnerBridgeService bridge,
    CancellationToken cancellationToken) => {
    var guard = Guard(request, response, options, limiter, accessPolicy, "session", 20);
    if (guard is not null) return guard;
    var input = await ReadStrictJsonAsync<SessionInput>(request, cancellationToken);
    if (input is null || input.ProtocolVersion != 1 || !ValidDocumentType(input.DocumentType)) {
        return Error(response, "INVALID_REQUEST", "Sessão Autofill inválida.", StatusCodes.Status400BadRequest);
    }
    var result = await bridge.ForwardAsync("/api/v1/autofill/sessions", new {
        protocol_version = input.ProtocolVersion,
        document_type = input.DocumentType,
        partner_origin = options.PartnerOrigin,
    }, cancellationToken);
    return Relay(response, result);
});

app.MapPost("/api/consulta-autofill/decode", async (
    HttpRequest request,
    HttpResponse response,
    PartnerSettings options,
    PartnerRateLimiter limiter,
    IPartnerAccessPolicy accessPolicy,
    PartnerBridgeService bridge,
    CancellationToken cancellationToken) => {
    var guard = Guard(request, response, options, limiter, accessPolicy, "decode", 60);
    if (guard is not null) return guard;
    var input = await ReadStrictJsonAsync<DecodeInput>(request, cancellationToken);
    if (input is null || !ValidDecode(input)) {
        return Error(response, "INVALID_REQUEST", "Decode Autofill inválido.", StatusCodes.Status400BadRequest);
    }
    var result = await bridge.ForwardAsync("/api/v1/autofill/decode", new {
        protocol_version = input.ProtocolVersion,
        session_token = input.SessionToken,
        payload_base64 = input.PayloadBase64,
        include_photo = input.IncludePhoto,
    }, cancellationToken);
    return Relay(response, result);
});

app.MapPost("/api/consulta-autofill/metrics", async (
    HttpRequest request,
    HttpResponse response,
    PartnerSettings options,
    PartnerRateLimiter limiter,
    IPartnerAccessPolicy accessPolicy,
    PartnerBridgeService bridge,
    CancellationToken cancellationToken) => {
    var guard = Guard(request, response, options, limiter, accessPolicy, "metrics", 180);
    if (guard is not null) return guard;
    var input = await ReadStrictJsonAsync<MetricInput>(request, cancellationToken, MaxMetricBodyBytes);
    if (input is null || !ValidMetric(input)) {
        return Error(response, "INVALID_REQUEST", "Métrica Autofill inválida.", StatusCodes.Status400BadRequest);
    }
    var result = await bridge.ForwardAsync("/api/v1/autofill/metrics", new {
        protocol_version = input.ProtocolVersion,
        session_token = input.SessionToken,
        @event = input.Event,
    }, cancellationToken);
    return Relay(response, result);
});

app.Run();

static IResult? Guard(HttpRequest request, HttpResponse response, PartnerSettings options, PartnerRateLimiter limiter, IPartnerAccessPolicy accessPolicy, string scope, int limit) {
    if (request.ContentLength is > MaxBodyBytes) {
        return Error(response, "INVALID_REQUEST", "A requisição Autofill é inválida.", StatusCodes.Status400BadRequest);
    }
    var origin = request.Headers["Origin"].ToString();
    if (!string.IsNullOrEmpty(origin) && !string.Equals(origin, options.PartnerOrigin, StringComparison.Ordinal)) {
        return Error(response, "INVALID_ORIGIN", "Origem não autorizada.", StatusCodes.Status403Forbidden);
    }
    if (!accessPolicy.HasAutofillAccess(request.HttpContext)) {
        return Error(response, "UNAUTHENTICATED", "Não autorizado.", StatusCodes.Status401Unauthorized);
    }
    var client = request.HttpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown";
    if (!limiter.Allow($"{scope}:{client}", limit)) {
        return Error(response, "RATE_LIMITED", "Muitas solicitações; tente novamente em breve.", StatusCodes.Status429TooManyRequests);
    }
    return null;
}

static bool ValidDocumentType(string? value) => value is "auto" or "cnh-e" or "crlv-e";

static bool ValidDecode(DecodeInput input) => input.ProtocolVersion == 1
    && input.IncludePhoto is not null
    && input.SessionToken is { Length: >= 32 and <= 4096 }
    && input.PayloadBase64 is { Length: >= 4 and <= MaxBodyBytes }
    && Regex.IsMatch(input.PayloadBase64, "^[A-Za-z0-9+/]+={0,2}$", RegexOptions.CultureInvariant);

static bool ValidMetric(MetricInput input) => input.ProtocolVersion == 1
    && input.SessionToken is { Length: >= 32 and <= 4096 }
    && input.Event is "opened" or "camera_requested" or "camera_granted" or "camera_denied" or "qr_found"
        or "decoded" or "confirmed" or "filled" or "closed" or "error";

static IResult Relay(HttpResponse response, ForwardedResponse result) {
    if (result.Body is null) return Error(response, "UPSTREAM_UNAVAILABLE", "Serviço temporariamente indisponível.", StatusCodes.Status503ServiceUnavailable);
    response.Headers.CacheControl = "no-store";
    return Results.Json(result.Body.Value, JsonContract.Options, statusCode: result.StatusCode);
}

static IResult Error(HttpResponse response, string code, string message, int statusCode) {
    response.Headers.CacheControl = "no-store";
    return Results.Json(new ErrorEnvelope(false, new ErrorBody(code, message, statusCode >= 500), "partner_local"), JsonContract.Options, statusCode: statusCode);
}

static async Task<T?> ReadStrictJsonAsync<T>(HttpRequest request, CancellationToken cancellationToken, int maxBodyBytes = MaxBodyBytes) where T : class {
    if (!request.HasJsonContentType()) return null;
    await using var output = new MemoryStream();
    var buffer = new byte[8192];
    try {
        int read;
        while ((read = await request.Body.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken)) != 0) {
            if (output.Length + read > maxBodyBytes) return null;
            await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }
        var bytes = output.ToArray();
        try {
            return JsonSerializer.Deserialize<T>(bytes, JsonContract.Options);
        } catch (JsonException) {
            return null;
        } finally {
            Array.Clear(bytes, 0, bytes.Length);
        }
    } finally {
        Array.Clear(buffer, 0, buffer.Length);
    }
}

public sealed record SessionInput(
    [property: JsonPropertyName("protocol_version")] int ProtocolVersion,
    [property: JsonPropertyName("document_type")] string? DocumentType);

public sealed record DecodeInput(
    [property: JsonPropertyName("protocol_version")] int ProtocolVersion,
    [property: JsonPropertyName("session_token")] string? SessionToken,
    [property: JsonPropertyName("payload_base64")] string? PayloadBase64,
    [property: JsonPropertyName("include_photo")] bool? IncludePhoto);

public sealed record MetricInput(
    [property: JsonPropertyName("protocol_version")] int ProtocolVersion,
    [property: JsonPropertyName("session_token")] string? SessionToken,
    [property: JsonPropertyName("event")] string? Event);

public sealed record ErrorBody(string Code, string Message, bool Retryable);
public sealed record ErrorEnvelope(bool Success, ErrorBody Error, string RequestId);
public sealed record ForwardedResponse(int StatusCode, JsonElement? Body) {
    public static ForwardedResponse Unavailable => new(StatusCodes.Status503ServiceUnavailable, null);
}

public static class JsonContract {
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };
}

public sealed class PartnerSettings {
    public required string ApiBaseUrl { get; init; }
    public required string ApiKey { get; init; }
    public required string ProjectId { get; init; }
    public required string PartnerOrigin { get; init; }

    public static PartnerSettings From(IConfiguration configuration) {
        var apiBaseUrl = (configuration["CONSULTA_API_BASE_URL"] ?? "https://consulta.dev.br").TrimEnd('/');
        var apiKey = configuration["CONSULTA_API_KEY"] ?? "";
        var projectId = configuration["CONSULTA_PROJECT_ID"] ?? "";
        var partnerOrigin = configuration["CONSULTA_PARTNER_ORIGIN"] ?? "";
        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(projectId) || string.IsNullOrWhiteSpace(partnerOrigin)) {
            throw new InvalidOperationException("Defina CONSULTA_API_KEY, CONSULTA_PROJECT_ID e CONSULTA_PARTNER_ORIGIN no ambiente do servidor.");
        }
        if (!Uri.TryCreate(apiBaseUrl, UriKind.Absolute, out var api) || (api.Scheme != Uri.UriSchemeHttps && !LocalHttp(api))) {
            throw new InvalidOperationException("CONSULTA_API_BASE_URL deve usar HTTPS fora de localhost.");
        }
        if (!Uri.TryCreate(partnerOrigin, UriKind.Absolute, out var origin)
            || origin.Scheme != Uri.UriSchemeHttps
            || string.IsNullOrEmpty(origin.Host)
            || !string.IsNullOrEmpty(origin.UserInfo)
            || !string.Equals(origin.GetLeftPart(UriPartial.Authority), partnerOrigin, StringComparison.Ordinal)) {
            throw new InvalidOperationException("CONSULTA_PARTNER_ORIGIN deve ser uma origem HTTPS exata.");
        }
        return new PartnerSettings { ApiBaseUrl = apiBaseUrl, ApiKey = apiKey, ProjectId = projectId, PartnerOrigin = partnerOrigin };
    }

    private static bool LocalHttp(Uri uri) => uri.Scheme == Uri.UriSchemeHttp && (uri.Host == "localhost" || uri.Host == "127.0.0.1");
}

public sealed class PartnerRateLimiter {
    private readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> _windows = new();

    public bool Allow(string key, int limit) {
        var window = _windows.GetOrAdd(key, _ => new Queue<DateTimeOffset>());
        lock (window) {
            var cutoff = DateTimeOffset.UtcNow.AddMinutes(-1);
            while (window.TryPeek(out var first) && first < cutoff) window.Dequeue();
            if (window.Count >= limit) return false;
            window.Enqueue(DateTimeOffset.UtcNow);
            return true;
        }
    }
}

/**
 * Reads only a principal established by the partner's server-side
 * authentication middleware. Browser fields, project ids and payloads are
 * never an authorization signal. The shipped policy intentionally denies.
 */
public interface IPartnerAccessPolicy {
    bool HasAutofillAccess(HttpContext context);
}

public sealed class DenyPartnerAccessPolicy : IPartnerAccessPolicy {
    public bool HasAutofillAccess(HttpContext _context) => false;
}

public sealed class PartnerBridgeService(HttpClient client, PartnerSettings settings) {
    private const int MaxUpstreamBytes = 6 * 1024 * 1024;

    public async Task<ForwardedResponse> ForwardAsync(string path, object body, CancellationToken cancellationToken) {
        var payload = JsonSerializer.SerializeToUtf8Bytes(body, JsonContract.Options);
        try {
            using var request = new HttpRequestMessage(HttpMethod.Post, path) {
                Content = new ByteArrayContent(payload),
            };
            request.Headers.TryAddWithoutValidation("X-API-Key", settings.ApiKey);
            request.Headers.TryAddWithoutValidation("X-Consulta-Product", "autofill");
            request.Headers.TryAddWithoutValidation("X-Consulta-Project-ID", settings.ProjectId);
            request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            var bytes = await ReadLimitedAsync(response.Content, cancellationToken);
            if (bytes is null) return ForwardedResponse.Unavailable;
            try {
                using var document = JsonDocument.Parse(bytes);
                if (document.RootElement.ValueKind != JsonValueKind.Object) return ForwardedResponse.Unavailable;
                return new ForwardedResponse((int)response.StatusCode, document.RootElement.Clone());
            } catch (JsonException) {
                return ForwardedResponse.Unavailable;
            } finally {
                Array.Clear(bytes, 0, bytes.Length);
            }
        } catch (Exception) {
            // Não exponha detalhes de falha do upstream ao browser nem registre
            // QR, token, foto ou campos de documento neste caminho.
            return ForwardedResponse.Unavailable;
        } finally {
            Array.Clear(payload, 0, payload.Length);
        }
    }

    private static async Task<byte[]?> ReadLimitedAsync(HttpContent content, CancellationToken cancellationToken) {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        await using var output = new MemoryStream();
        var buffer = new byte[8192];
        try {
            int read;
            while ((read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken)) != 0) {
                if (output.Length + read > MaxUpstreamBytes) return null;
                await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            }
            return output.ToArray();
        } finally {
            Array.Clear(buffer, 0, buffer.Length);
        }
    }
}

public partial class Program { }
