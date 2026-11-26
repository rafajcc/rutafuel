import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RIPREE_HEADERS,
  decodeRipree,
  normalizeConnectorType,
  normalizeRipree,
  parseRipreeCsv,
  parseRipreeDate,
  unwrapExcelValue,
} from '../scripts/lib/ripree.js';

function row(overrides: Partial<Record<number, string>> = {}): string[] {
  const values = Array.from({ length: RIPREE_HEADERS.length }, () => '');
  values[0] = 'Comunitat Valenciana';
  values[1] = 'Alicante/Alacant';
  values[2] = 'Alacant/Alicante';
  values[3] = '="38.3466000"';
  values[4] = '="-0.5229500"';
  values[5] = 'Centro de carga Alicante';
  values[6] = 'Carrer Riu Turia 16';
  values[7] = '="03006"';
  values[8] = 'EN LA CALLE';
  values[9] = ' 24/7';
  values[10] = ' 24/7';
  values[11] = 'ENDESA X WAY, S.L.';
  values[12] = 'ES*ESX';
  values[14] = 'INST-1';
  values[15] = 'POINT-1';
  values[16] = 'NODISPONIBLE';
  values[17] = '';
  values[20] = 'ES*ESX*E1';
  values[21] = 'CON-1';
  values[22] = 'IEC_62196_T2_COMBO';
  values[23] = 'DC';
  values[24] = 'Cable';
  values[25] = '350,00 kW';
  values[26] = '500 V';
  values[27] = '100,00 A';
  values[28] = '21/11/2023 11:56:08';
  for (const [index, value] of Object.entries(overrides)) values[Number(index)] = value ?? '';
  return values;
}

function csv(rows: string[][]): string {
  return [RIPREE_HEADERS.join(';'), ...rows.map((fields) => fields.join(';'))].join('\r\n') + '\r\n';
}

describe('RIPREE: descodificación y CSV', () => {
  it('descodifica UTF-16LE, UTF-8 con BOM y sin BOM', () => {
    const text = csv([row()]);
    assert.equal(decodeRipree(Buffer.from(text, 'utf16le')), text);
    assert.equal(decodeRipree(Buffer.from(`\uFEFF${text}`, 'utf8')), text);
    assert.equal(decodeRipree(Buffer.from(text, 'utf8')), text);
  });

  it('respeta comillas, punto y coma y saltos de línea dentro de un campo', () => {
    const special = row({ 6: '"Calle 1; Polígono\\" Norte\nPlanta 2"' });
    const parsed = parseRipreeCsv(csv([special]));
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0]?.length, RIPREE_HEADERS.length);
    assert.equal(parsed.rows[0]?.[6], 'Calle 1; Polígono" Norte\nPlanta 2');
  });

  it('descarta y cuenta filas con un número de campos distinto', () => {
    const parsed = parseRipreeCsv(csv([row(), ['INST-2', 'sólo dos campos']]));
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.malformedRows, 1);
    assert.match(parsed.warnings[0] ?? '', /1 filas con número de campos/);
  });

  it('rechaza una cabecera que no sea la verificada en la descarga real', () => {
    assert.throws(() => parseRipreeCsv('A;B;C\r\n1;2;3'), /cabecera inesperada/);
  });

  it('interpreta fórmulas Excel y fechas con hora de un dígito', () => {
    assert.equal(unwrapExcelValue('="38.3466000"'), '38.3466000');
    assert.equal(unwrapExcelValue('=07011'), '07011');
    assert.equal(unwrapExcelValue('=NULL'), undefined);
    assert.equal(unwrapExcelValue('=DESCONOCIDO'), undefined);
    assert.deepEqual(parseRipreeDate('23/04/2025 9:35:26'), {
      iso: '2025-04-23T09:35:26',
      raw: '23/04/2025 9:35:26',
    });
    assert.equal(parseRipreeDate('no-fecha'), null);
  });
});

describe('RIPREE: normalización', () => {
  it('agrupa conectores por instalación y conserva procedencia y auditoría', () => {
    const second = row({
      15: 'POINT-2',
      20: 'ES*ESX*E2',
      22: 'IEC_62196_T2',
      23: 'AC_3_PHASE',
      24: 'Socket',
      25: '22,00 kW',
      28: '25/11/2023 10:00:00',
    });
    const result = normalizeRipree(parseRipreeCsv(csv([row(), second])), {
      fetchedAt: '2026-11-26T15:00:00.000Z',
      sourceUrl: 'https://energia.test/export',
    });

    assert.equal(result.stations.length, 1);
    assert.equal(result.discarded.length, 0);
    assert.equal(result.malformedRows, 0);
    const station = result.stations[0]!;
    assert.equal(station.id, 'RIPREE-INST-1');
    assert.equal(station.officialId, 'INST-1');
    assert.equal(station.lat, 38.3466);
    assert.equal(station.lon, -0.52295);
    assert.equal(station.pointCount, 2);
    assert.deepEqual(station.connectors.map((connector) => connector.type), ['CCS2', 'TYPE2']);
    assert.equal(station.connectors[0]?.rawType, 'IEC_62196_T2_COMBO');
    assert.equal(station.connectors[0]?.powerKw, 350);
    assert.equal(station.maxPowerKw, 350);
    assert.equal(station.status, 'unknown');
    assert.equal(station.accessibility, 'unknown');
    assert.equal(station.updatedAt, '2023-11-25T10:00:00');
    assert.deepEqual(station.sources, [
      {
        source: 'RIPREE',
        id: 'INST-1',
        url: 'https://energia.test/export',
        fetchedAt: '2026-11-26T15:00:00.000Z',
      },
    ]);
    assert.equal(station.raw.ripree?.puntos.length, 2);
    assert.equal(station.provinceId, 'alicante-alacant');
    assert.match(station.municipalitySlug, /^alacant-alicante-/);
    assert.equal(result.latestUpdatedAt, '2023-11-25T10:00:00');
  });

  it('publica estado operativo y acceso público cuando la fuente lo afirma', () => {
    const result = normalizeRipree(
      parseRipreeCsv(csv([row({ 16: 'SI', 17: 'OPERATIVO' })])),
    );
    assert.equal(result.stations[0]?.status, 'operational');
    assert.equal(result.stations[0]?.accessibility, 'yes');
    assert.equal(result.warnings.length, 0);
  });

  it('descarta filas sin instalación o con coordenadas inválidas', () => {
    const noId = row({ 14: '' });
    const badCoordinates = row({ 4: '="200.0000000"', 14: 'INST-2' });
    const result = normalizeRipree(parseRipreeCsv(csv([noId, badCoordinates])));
    assert.equal(result.stations.length, 0);
    assert.equal(result.withoutCoordinates, 1);
    assert.deepEqual(result.discarded.map((item) => item.reason), ['missing-id', 'invalid-coordinates']);
  });

  it('reconoce todos los conectores observados y deduplica avisos equivalentes', () => {
    assert.equal(normalizeConnectorType('IEC_60309_2_single_16'), 'IEC60309_1P16');
    assert.equal(normalizeConnectorType('IEC_60309_2_three_32'), 'IEC60309_3P32');
    assert.equal(normalizeConnectorType('DOMESTIC_L'), 'DOMESTIC_L');
    assert.equal(normalizeConnectorType('NUEVO_TIPO'), 'UNKNOWN');

    const unusual = [row({ 22: 'NUEVO_TIPO' }), row({ 14: 'INST-2', 22: 'NUEVO_TIPO' })];
    const result = normalizeRipree(parseRipreeCsv(csv(unusual)));
    assert.equal(result.warnings.filter((warning) => warning.includes('NUEVO_TIPO')).length, 1);
  });
});
