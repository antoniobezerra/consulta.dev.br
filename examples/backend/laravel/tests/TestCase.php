<?php

namespace Tests;

use App\Http\Controllers\ConsultaAutofillController;
use Orchestra\Testbench\TestCase as Orchestra;

abstract class TestCase extends Orchestra
{
    protected $loadEnvironmentVariables = false;

    protected function defineEnvironment($app): void
    {
        $app['config']->set([
            'consulta-autofill.api_base_url' => 'https://consulta.example',
            'consulta-autofill.api_key' => 'test_server_key',
            'consulta-autofill.project_id' => 'pub_test_project',
            'consulta-autofill.partner_origin' => 'https://partner.example',
        ]);
    }

    protected function defineRoutes($router): void
    {
        // The production route file adds the partner's auth and throttle
        // middleware. This fixture focuses on the bridge controller contract.
        $router->post('/api/consulta-autofill/session', [ConsultaAutofillController::class, 'session']);
        $router->post('/api/consulta-autofill/decode', [ConsultaAutofillController::class, 'decode']);
    }
}
