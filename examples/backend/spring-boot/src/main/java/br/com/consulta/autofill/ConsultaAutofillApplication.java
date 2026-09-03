package br.com.consulta.autofill;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(PartnerBridgeProperties.class)
public class ConsultaAutofillApplication {
  public static void main(String[] args) {
    SpringApplication.run(ConsultaAutofillApplication.class, args);
  }
}
