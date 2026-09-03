<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Http;

class ConsultaAutofillController extends Controller
{
    public function session(Request $request): JsonResponse
    {
        if ($response = $this->assertOrigin($request)) {
            return $response;
        }

        if ($response = $this->assertOnly($request, ['protocol_version', 'document_type'])) {
            return $response;
        }
        $input = $request->validate([
            'protocol_version' => ['required', 'integer', 'in:1'],
            'document_type' => ['required', 'string', 'in:auto,cnh-e,crlv-e'],
        ]);

        return $this->forward('/api/v1/autofill/sessions', [
            ...$input,
            'partner_origin' => config('consulta-autofill.partner_origin'),
        ]);
    }

    public function decode(Request $request): JsonResponse
    {
        if ($response = $this->assertOrigin($request)) {
            return $response;
        }

        if ($response = $this->assertOnly($request, ['protocol_version', 'session_token', 'payload_base64', 'include_photo'])) {
            return $response;
        }
        $input = $request->validate([
            'protocol_version' => ['required', 'integer', 'in:1'],
            'session_token' => ['required', 'string', 'min:32', 'max:4096'],
            'payload_base64' => ['required', 'string', 'min:4', 'max:1000000', 'regex:/^[A-Za-z0-9+\/]+={0,2}$/'],
            'include_photo' => ['required', 'boolean'],
        ]);

        return $this->forward('/api/v1/autofill/decode', $input);
    }

    public function metrics(Request $request): JsonResponse
    {
        if ($response = $this->assertOrigin($request)) {
            return $response;
        }

        if ($response = $this->assertOnly($request, ['protocol_version', 'session_token', 'event'])) {
            return $response;
        }
        $input = $request->validate([
            'protocol_version' => ['required', 'integer', 'in:1'],
            'session_token' => ['required', 'string', 'min:32', 'max:4096'],
            'event' => ['required', 'string', 'in:opened,camera_requested,camera_granted,camera_denied,qr_found,decoded,confirmed,filled,closed,error'],
        ]);

        return $this->forward('/api/v1/autofill/metrics', $input);
    }

    private function assertOrigin(Request $request): ?JsonResponse
    {
        $origin = $request->header('Origin');
        if ($origin !== config('consulta-autofill.partner_origin')) {
            return $this->error('INVALID_ORIGIN', 'Origem não autorizada.', 403);
        }
        return null;
    }

    private function assertOnly(Request $request, array $allowed): ?JsonResponse
    {
        if (array_diff(array_keys($request->all()), $allowed)) {
            return $this->error('INVALID_REQUEST', 'Requisição Autofill inválida.');
        }
        return null;
    }

    private function forward(string $path, array $body): JsonResponse
    {
        try {
            $response = Http::acceptJson()
                ->asJson()
                ->timeout(10)
                ->withHeaders([
                    'X-API-Key' => config('consulta-autofill.api_key'),
                    'X-Consulta-Product' => 'autofill',
                    'X-Consulta-Project-ID' => config('consulta-autofill.project_id'),
                ])
                ->post(config('consulta-autofill.api_base_url').$path, $body);

            return response()->json(
                $response->json() ?: $this->errorBody('UPSTREAM_UNAVAILABLE', 'Serviço temporariamente indisponível.'),
                $response->json() ? $response->status() : 503,
                ['Cache-Control' => 'no-store'],
            );
        } catch (ConnectionException) {
            return $this->error('UPSTREAM_UNAVAILABLE', 'Serviço temporariamente indisponível.', 503);
        }
    }

    private function error(string $code, string $message, int $status = 400): JsonResponse
    {
        return response()->json($this->errorBody($code, $message, $status >= 500), $status, ['Cache-Control' => 'no-store']);
    }

    private function errorBody(string $code, string $message, bool $retryable = true): array
    {
        return ['success' => false, 'error' => ['code' => $code, 'message' => $message, 'retryable' => $retryable], 'request_id' => 'partner_local'];
    }
}
