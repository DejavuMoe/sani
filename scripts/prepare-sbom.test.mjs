import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSBOM } from './prepare-sbom.mjs';

function fixture(type = 'DEPENDENCY_OF') {
  return {
    SPDXID: 'SPDXRef-DOCUMENT',
    packages: [
      { SPDXID: 'project', name: 'example', versionInfo: '1.0.0' },
      { SPDXID: 'direct', name: '@example/library', versionInfo: '2.3.4' },
      { SPDXID: 'indirect', name: 'helper', versionInfo: '3.0.0-beta.1' },
    ],
    relationships: [
      { spdxElementId: 'SPDXRef-DOCUMENT', relatedSpdxElement: 'project', relationshipType: 'DESCRIBES' },
      { spdxElementId: 'direct', relatedSpdxElement: 'project', relationshipType: type },
      { spdxElementId: 'indirect', relatedSpdxElement: 'direct', relationshipType: 'DEPENDENCY_OF' },
    ],
  };
}

for (const type of ['DEPENDENCY_OF', 'DEV_DEPENDENCY_OF', 'OPTIONAL_DEPENDENCY_OF']) {
  test(`preserves ${type} and adds correctly directed transitive edges`, () => {
    const result = prepareSBOM(fixture(type));
    assert.deepEqual(result.relationships.slice(3), [
      { spdxElementId: 'SPDXRef-RootPackage', relatedSpdxElement: 'direct', relationshipType: 'DEPENDS_ON' },
      { spdxElementId: 'direct', relatedSpdxElement: 'indirect', relationshipType: 'DEPENDS_ON' },
    ]);
    assert.equal(result.relationships[1].relationshipType, type);
    assert.equal(result.packages[1].versionInfo, '2.3.4');
    assert.equal(result.relationships[0].relatedSpdxElement, result.packages[0].SPDXID);
  });
}

test('pnpm forward edges and a normalized root remain unchanged', () => {
  const sbom = prepareSBOM(fixture());
  sbom.relationships = sbom.relationships.filter(r => !r.relationshipType.endsWith('DEPENDENCY_OF'));
  assert.deepEqual(prepareSBOM(structuredClone(sbom)), sbom);
});

for (const [name, mutate] of [
  ['catalog placeholder', s => { s.packages[1].versionInfo = 'catalog:'; }],
  ['unresolved range', s => { s.packages[1].versionInfo = '^2.3.4'; }],
  ['missing root', s => { s.relationships.shift(); }],
  ['duplicate ID', s => { s.packages[1].SPDXID = 'project'; }],
  ['dangling edge', s => { s.relationships[1].spdxElementId = 'absent'; }],
]) {
  test(`rejects ${name}`, () => {
    const sbom = fixture();
    mutate(sbom);
    assert.throws(() => prepareSBOM(sbom));
  });
}
