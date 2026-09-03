<?php

use App\Http\Controllers\ConsultaAutofillController;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth'])->prefix('api/consulta-autofill')->group(function () {
    Route::post('/session', [ConsultaAutofillController::class, 'session'])->middleware('throttle:20,1');
    Route::post('/decode', [ConsultaAutofillController::class, 'decode'])->middleware('throttle:60,1');
});
