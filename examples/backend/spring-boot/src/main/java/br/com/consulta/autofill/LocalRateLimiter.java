package br.com.consulta.autofill;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
class LocalRateLimiter {
  private final Map<String, ArrayDeque<Instant>> windows = new HashMap<>();

  synchronized boolean allow(String key, int limit) {
    Instant cutoff = Instant.now().minus(Duration.ofMinutes(1));
    ArrayDeque<Instant> window = windows.computeIfAbsent(key, ignored -> new ArrayDeque<>());
    while (!window.isEmpty() && window.peekFirst().isBefore(cutoff)) window.removeFirst();
    if (window.size() >= limit) return false;
    window.addLast(Instant.now());
    return true;
  }
}
