package br.com.consulta.autofill;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class PartnerBridgeSecurityConfiguration {
  /**
   * Fail closed until the partner registers an implementation that reads its
   * authenticated principal and enforces the registration/RBAC permission.
   */
  @Bean
  @ConditionalOnMissingBean
  PartnerAccessPolicy partnerAccessPolicy() {
    return request -> false;
  }
}
