// Synthetic stand-in for a TV player script, written for tests; not YouTube code
var nuvoPlayer = (function () {
  var config = { signatureTimestamp: 20123, variant: "synthetic" };
  function transformN(value) {
    return value.split("").reverse().join("") + "Q";
  }
  function transformSig(value) {
    return value.slice(2) + value.slice(0, 2);
  }
  return { config: config, n: transformN, sig: transformSig };
})();
