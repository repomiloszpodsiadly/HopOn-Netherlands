package com.hopon.catalog;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class CatalogConfiguration {

    @Bean
    CatalogProvenanceValidator catalogProvenanceValidator() {
        return new CatalogProvenanceValidator();
    }

    @Bean
    CatalogSnapshot catalogSnapshot(CatalogSnapshotLoader loader) {
        return loader.snapshot();
    }
}
