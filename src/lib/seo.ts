/** Datos estructurados Schema.org. Sólo se publican campos presentes en el dataset. */

export interface SeoCrumb {
  name: string;
  url?: string;
}

export interface SeoStation {
  id: string;
  name?: string;
  address?: string;
  postalCode?: string;
  locality?: string;
  municipality: string;
  province: string;
  lat: number;
  lon: number;
  prices: Record<string, number | null>;
}

export function breadcrumbSchema(crumbs: SeoCrumb[], siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      ...(crumb.url ? { item: new URL(crumb.url, siteUrl).toString() } : {}),
    })),
  };
}

export interface SeoChargingStation {
  id: string;
  name?: string;
  address?: string;
  municipality?: string;
  province?: string;
  postalCode?: string;
  operator?: string;
  lat: number;
  lon: number;
  maxPowerKw: number | null;
  connectors: Array<{ type: string }>;
}

/** Datos estructurados de recarga: sin disponibilidad ni estado inferido. */
export function chargingStationListSchema(stations: SeoChargingStation[], siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: stations.length,
    itemListElement: stations.map((station, index) => {
      const address =
        station.address || station.municipality || station.province
          ? {
              '@type': 'PostalAddress',
              ...(station.address ? { streetAddress: station.address } : {}),
              ...(station.municipality ? { addressLocality: station.municipality } : {}),
              ...(station.province ? { addressRegion: station.province } : {}),
              ...(station.postalCode ? { postalCode: station.postalCode } : {}),
              addressCountry: 'ES',
            }
          : undefined;
      const details = [
        station.maxPowerKw === null ? null : `Potencia máxima: ${station.maxPowerKw} kW`,
        station.connectors.length > 0
          ? `Conectores: ${station.connectors.map((connector) => connector.type).join(', ')}`
          : null,
      ].filter((detail): detail is string => detail !== null);

      return {
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'ElectricVehicleChargingStation',
          '@id': `${siteUrl.replace(/\/$/, '')}#cargador-${station.id}`,
          name: station.name ?? `Punto de recarga ${station.id}`,
          ...(address ? { address } : {}),
          geo: { '@type': 'GeoCoordinates', latitude: station.lat, longitude: station.lon },
          ...(details.length > 0 ? { description: details.join(' · ') } : {}),
          ...(station.operator
            ? { operatedBy: { '@type': 'Organization', name: station.operator } }
            : {}),
        },
      };
    }),
  };
}

export function gasStationListSchema(
  stations: SeoStation[],
  siteUrl: string,
  fuelKey: string,
  fuelLabel: string,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    numberOfItems: stations.length,
    itemListElement: stations.map((station, index) => {
      const price = station.prices[fuelKey] ?? null;
      return {
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'GasStation',
          '@id': `${siteUrl.replace(/\/$/, '')}#estacion-${station.id}`,
          name: station.name ?? `Estación de servicio ${station.id}`,
          address: {
            '@type': 'PostalAddress',
            streetAddress: station.address ?? station.locality ?? station.municipality,
            addressLocality: station.municipality,
            addressRegion: station.province,
            ...(station.postalCode ? { postalCode: station.postalCode } : {}),
            addressCountry: 'ES',
          },
          geo: { '@type': 'GeoCoordinates', latitude: station.lat, longitude: station.lon },
          ...(price !== null
            ? {
                makesOffer: {
                  '@type': 'Offer',
                  price,
                  priceCurrency: 'EUR',
                  description: `Precio orientativo de ${fuelLabel}`,
                },
              }
            : {}),
        },
      };
    }),
  };
}
