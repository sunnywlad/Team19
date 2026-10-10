// Les deux fonctions d'exécution d'ajv dont le code généré a besoin, réécrites
// sans dépendance. Recopiées en tête de src/generated/validators.js par
// gen-validators.mjs : pas de require() dans un module du navigateur.
function __equal(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!__equal(a[i], b[i])) return false;
      return true;
    }
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const k of keys) if (!Object.prototype.hasOwnProperty.call(b, k) || !__equal(a[k], b[k])) return false;
    return true;
  }
  return a !== a && b !== b;
}
function __ucs2length(str) {
  let length = 0;
  for (const _ of str) length++;
  return length;
}
