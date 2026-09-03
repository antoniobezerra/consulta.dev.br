package br.com.consulta.autofill;

import jakarta.servlet.http.HttpServletRequest;

/**
 * Adapter to the partner application's established server-side identity and
 * RBAC layer. The bridge must never authorize from browser-controlled data.
 */
@FunctionalInterface
public interface PartnerAccessPolicy {
  boolean hasAutofillAccess(HttpServletRequest request);
}
