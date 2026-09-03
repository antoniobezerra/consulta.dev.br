<?php

return [
    'api_base_url' => rtrim(env('CONSULTA_API_BASE_URL', 'https://consulta.dev.br'), '/'),
    'api_key' => env('CONSULTA_API_KEY'),
    'project_id' => env('CONSULTA_PROJECT_ID'),
    'partner_origin' => env('CONSULTA_PARTNER_ORIGIN'),
];
