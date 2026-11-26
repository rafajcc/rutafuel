import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { slugify, titleCaseProvince, uniqueSlug } from '../scripts/lib/slug.js';

describe('nombres y slugs', () => {
  it('transforma las denominaciones oficiales de provincia', () => {
    assert.equal(titleCaseProvince('PALMAS (LAS)'), 'Las Palmas');
    assert.equal(titleCaseProvince('CORUÑA (A)'), 'A Coruña');
    assert.equal(titleCaseProvince('RIOJA (LA)'), 'La Rioja');
    assert.equal(titleCaseProvince('SANTA CRUZ DE TENERIFE'), 'Santa Cruz de Tenerife');
    assert.equal(titleCaseProvince('CASTELLÓN / CASTELLÓ'), 'Castellón / Castelló');
  });

  it('genera slugs sin acentos ni caracteres especiales', () => {
    assert.equal(slugify('San Cristóbal de La Laguna'), 'san-cristobal-de-la-laguna');
    assert.equal(slugify('A Coruña'), 'a-coruna');
    assert.equal(slugify('Santa Cruz de Tenerife'), 'santa-cruz-de-tenerife');
  });

  it('añade el identificador para garantizar unicidad', () => {
    assert.equal(uniqueSlug('Lugo', '27'), 'lugo-27');
    assert.equal(uniqueSlug('---', '1'), 'sin-nombre-1');
  });
});
