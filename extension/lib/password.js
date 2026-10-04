// Password generator for new ATS accounts. Shared by the background worker (importScripts) and
// the test pages. Workday requires upper, lower, digit and special characters; iCIMS portals
// vary. 20 characters drawing every class clears all rules seen. Symbols skip quotes,
// backslashes, angle brackets and spaces, which some ATS password fields reject or mangle.
(function (root) {
  const SETS = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!@#$%^&*-_=+?'];

  // Uniform in [0, n): rejection sampling avoids modulo bias.
  function randomIndex(n) {
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % n;
  }

  root.filloGeneratePassword = function (length = 20) {
    const all = SETS.join('');
    const chars = SETS.map((set) => set[randomIndex(set.length)]);
    while (chars.length < length) chars.push(all[randomIndex(all.length)]);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomIndex(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  };
})(typeof self !== 'undefined' ? self : globalThis);
