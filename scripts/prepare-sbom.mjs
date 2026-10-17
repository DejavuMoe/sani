import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

export function prepareSBOM(sbom) {
  assert.ok(sbom.packages.length > 1, 'SBOM must include resolved dependencies');
  const roots = sbom.relationships.filter(r => r.relationshipType === 'DESCRIBES');
  assert.equal(roots.length, 1, 'SBOM must describe one project');
  const root = roots[0].relatedSpdxElement;
  const ids = new Set(sbom.packages.map(p => p.SPDXID));
  assert.equal(ids.size, sbom.packages.length, 'Duplicate package IDs');
  assert.ok(ids.has(root), 'Missing project package');
  for (const pkg of sbom.packages) {
    assert.match(pkg.versionInfo, /^\d+\.\d+\.\d+(?:[-+].*)?$/, `${pkg.name}: unresolved version`);
    if (pkg.SPDXID === root) pkg.SPDXID = 'SPDXRef-RootPackage';
  }
  const dependencies = [];
  for (const relation of sbom.relationships) {
    for (const key of ['spdxElementId', 'relatedSpdxElement']) {
      assert.ok(relation[key] === sbom.SPDXID || ids.has(relation[key]), 'Dangling SPDX relationship');
      if (relation[key] === root) relation[key] = 'SPDXRef-RootPackage';
    }
    // npm emits reverse edges; the submission action reads only DEPENDS_ON.
    if (['DEPENDENCY_OF', 'DEV_DEPENDENCY_OF', 'OPTIONAL_DEPENDENCY_OF'].includes(relation.relationshipType)) {
      dependencies.push({ spdxElementId: relation.relatedSpdxElement,
        relatedSpdxElement: relation.spdxElementId, relationshipType: 'DEPENDS_ON' });
    }
  }
  sbom.relationships.push(...dependencies);
  assert.ok(sbom.relationships.some(r => r.relationshipType === 'DEPENDS_ON'), 'No dependency edges');
  return sbom;
}

if (import.meta.main) {
  const path = process.argv[2];
  const sbom = prepareSBOM(JSON.parse(readFileSync(path, 'utf8')));
  writeFileSync(path, JSON.stringify(sbom));
  console.log(`Validated ${sbom.packages.length} packages and ${sbom.relationships.length} relationships`);
}
