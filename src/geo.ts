import { sql, type Column } from 'drizzle-orm';
import type { LatLng } from './db/schema.js';

const RAIO_TERRA_KM = 6371;

const radianos = (graus: number) => (graus * Math.PI) / 180;

/** Distância em km entre dois pontos pela fórmula de haversine. */
export function distanciaEntre([lat1, lng1]: LatLng, [lat2, lng2]: LatLng): number {
  const dLat = radianos(lat2 - lat1);
  const dLng = radianos(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radianos(lat1)) * Math.cos(radianos(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.sqrt(a));
}

/** Soma dos trechos de um trajeto, arredondada em metros. */
export function distanciaTrajeto(pontos: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < pontos.length; i++) {
    total += distanciaEntre(pontos[i - 1]!, pontos[i]!);
  }
  return Math.round(total * 1000) / 1000;
}

/** Um grau de latitude tem ~111 km em qualquer ponto do globo. */
export const KM_POR_GRAU_LAT = 111.32;

/** Distância em km (haversine, no banco) entre o ponto dado e as colunas de latitude e longitude. */
export function distanciaSql(latitude: Column, longitude: Column, [lat, lng]: LatLng) {
  return sql<number>`2 * ${RAIO_TERRA_KM} * asin(sqrt(power(sin(radians(${latitude} - ${lat}::float8) / 2), 2) + cos(radians(${lat}::float8)) * cos(radians(${latitude})) * power(sin(radians(${longitude} - ${lng}::float8) / 2), 2)))`;
}
