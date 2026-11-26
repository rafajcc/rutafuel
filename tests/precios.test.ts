import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_PRICE, MIN_PRICE, parseFuelPrice, parseSpanishNumber } from '../scripts/lib/gasolineras.js';

describe('conversión de precios', () => {
  it('interpreta el separador decimal español', () => {
    assert.equal(parseSpanishNumber('1,399'), 1.399);
    assert.equal(parseSpanishNumber('0,899'), 0.899);
  });

  it('acepta también el separador inglés y millares', () => {
    assert.equal(parseSpanishNumber('1.399'), 1.399);
    assert.equal(parseSpanishNumber('1.234,567'), 1234.567);
  });

  it('devuelve null para vacíos y formatos no numéricos', () => {
    assert.equal(parseSpanishNumber(''), null);
    assert.equal(parseSpanishNumber('   '), null);
    assert.equal(parseSpanishNumber('abc'), null);
  });

  it('distingue precio ausente de precio cero', () => {
    assert.deepEqual(parseFuelPrice(''), { price: null, status: 'empty' });
    assert.deepEqual(parseFuelPrice(null), { price: null, status: 'empty' });
    assert.deepEqual(parseFuelPrice('0'), { price: null, status: 'out-of-range' });
  });

  it('detecta formatos inválidos y rangos fuera de lo razonable', () => {
    assert.deepEqual(parseFuelPrice('1,399'), { price: 1.399, status: 'ok' });
    assert.deepEqual(parseFuelPrice('xxx'), { price: null, status: 'invalid-format' });
    assert.equal(parseFuelPrice('9,999').status, 'out-of-range');
    assert.equal(parseFuelPrice(String(MIN_PRICE)).status, 'ok');
    assert.equal(parseFuelPrice(String(MAX_PRICE)).status, 'ok');
  });
});
