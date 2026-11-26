import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidCoordinate } from '../scripts/lib/gasolineras.js';

describe('validación de coordenadas', () => {
  it('acepta Península, Canarias y Ceuta', () => {
    assert.equal(isValidCoordinate(36.184, -5.492), true);
    assert.equal(isValidCoordinate(28.490056, -16.349528), true);
    assert.equal(isValidCoordinate(35.889, -5.304), true);
  });

  it('rechaza el origen (0,0) y valores fuera de España', () => {
    assert.equal(isValidCoordinate(0, 0), false);
    assert.equal(isValidCoordinate(-8.659472, 42.037472), false);
    assert.equal(isValidCoordinate(45, 0), false);
    assert.equal(isValidCoordinate(40, -20), false);
  });

  it('rechaza valores no finitos', () => {
    assert.equal(isValidCoordinate(Number.NaN, -3.7), false);
    assert.equal(isValidCoordinate(40, Number.POSITIVE_INFINITY), false);
  });
});
