// Public, synthetic recovery vector. These values are not user credentials.
// Argon2id output cross-checked with Node native crypto; text preparation is trim-only.
export const independentKeyVector = Object.freeze({
  identity: {
    fullName: "  Ａlice é  ",
    gender: 255,
    birthYear: 65535,
    birthMonth: 12,
    birthDay: 31,
    isBirthBC: true,
  },
  rawPassphrase: "  Pa ssé  ",
  normalizedName: "Ａlice é",
  normalizedPassphrase: "Pa ssé",
  identityBytes: "0x000cefbca16c696365c2a065cc81ff01ffff0c1f",
  passwordBytes:
    "0x4465657046616d696c793a496e646570656e64656e744b65794964656e7469747950617373776f72643a7631005061c2a0737365cc81",
  salt: "0x47885bb9f40a0fdca2fa59f115117e6d",
  independentKeyIdentitySecret:
    "0x68adae8bc70be5d2e700ee86cd7f234f7ab651f5525bed5b91d2b88d16ddb3f7",
  independentKeyRoot: "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  boundRoot: "0x48e288de56721ffc8a320478e59ee70b69995d379a0069982c43a62223c42120",
  ownerSecret: 13032573960527683083322876190357354579941001250157198378196810523411060752049n,
  ownerCommitment: 9087875439824714602639874093449419199012081998104793072616791118288838787545n,
  hpkeIkm: "0x5534c65cb581a5dc62c1d2228d70eb654c9c17664de3b8e2e141167bc66a4690",
  viewPublicKey: "0xbd551ffcbccacb58b55d31f832ba44e1f1603944b8fa4abc9a7d5e7ea3ea1a5b",
  keyFingerprint: "0xbe35d3bd6cd116a312c405ba0af523d6607a8828494e54de55fc4c029967258a",
});
