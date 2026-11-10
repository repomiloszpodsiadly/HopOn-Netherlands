package com.hopon.catalog;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class CatalogConfiguration {

    @Bean
    CatalogSnapshot catalogSnapshot(CatalogSnapshotLoader loader) {
        return loader.snapshot();
    }
}
