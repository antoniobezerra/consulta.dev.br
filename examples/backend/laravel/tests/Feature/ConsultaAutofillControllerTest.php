<?php

namespace Tests\Feature;

use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ConsultaAutofillControllerTest extends TestCase
{
    public function test_it_rejects_an_unexpected_origin_without_contacting_the_upstream(): void
    {
        Http::fake();

        $this->withHeader('Origin', 'https://attacker.example')
            ->postJson('/api/consulta-autofill/session', [
                'protocol_version' => 1,
                'document_type' => 'auto',
            ])
            ->assertForbidden()
            ->assertHeader('Cache-Control', 'no-store')
            ->assertJsonPath('error.code', 'INVALID_ORIGIN');

        Http::assertNothingSent();
    }

    public function test_it_rejects_a_browser_controlled_decode_field_without_contacting_the_upstream(): void
    {
        Http::fake();

        $this->withHeader('Origin', 'https://partner.example')
            ->postJson('/api/consulta-autofill/decode', [
                'protocol_version' => 1,
                'session_token' => str_repeat('a', 32),
                'payload_base64' => 'QUJDRA==',
                'include_photo' => false,
                'project_id' => 'pub_browser_controlled',
            ])
            ->assertBadRequest()
            ->assertHeader('Cache-Control', 'no-store')
            ->assertJsonPath('error.code', 'INVALID_REQUEST');

        Http::assertNothingSent();
    }

    public function test_it_forwards_only_the_server_configured_headers_and_origin(): void
    {
        Http::fake([
            'https://consulta.example/api/v1/autofill/sessions' => Http::response([
                'success' => true,
                'request_id' => 'req_synthetic',
                'data' => [],
            ], 201),
        ]);

        $this->withHeader('Origin', 'https://partner.example')
            ->postJson('/api/consulta-autofill/session', [
                'protocol_version' => 1,
                'document_type' => 'cnh-e',
            ])
            ->assertCreated()
            ->assertHeader('Cache-Control', 'no-store')
            ->assertJsonPath('success', true);

        Http::assertSent(static function (ClientRequest $request): bool {
            return $request->url() === 'https://consulta.example/api/v1/autofill/sessions'
                && $request->hasHeader('X-API-Key', 'test_server_key')
                && $request->hasHeader('X-Consulta-Product', 'autofill')
                && $request->hasHeader('X-Consulta-Project-ID', 'pub_test_project')
                && $request['protocol_version'] === 1
                && $request['document_type'] === 'cnh-e'
                && $request['partner_origin'] === 'https://partner.example';
        });
    }
}
