// Public, synthetic recovery vector. These values are not user credentials.
export const fundsVector = Object.freeze({
  identity: {
    fullName: "  Ａlice\u00a0e\u0301  ",
    gender: 255,
    birthYear: 65_535,
    birthMonth: 12,
    birthDay: 31,
    isBirthBC: true,
  },
  rawPassphrase: "  Pa\u00a0ss\u0065\u0301  ",
  normalizedName: "Alice é",
  normalizedPassphrase: "  Pa ssé  ",
  identityBytes: "0x0008416c69636520c3a9ff01ffff0c1f",
  passwordBytes:
    "0x4465657046616d696c793a46756e64734964656e7469747950617373776f72643a76310020205061207373c3a92020",
  salt: "0x2ee93be1b4b72cad7ac4e7bba0f03971",
  fundsIdentitySecret: "0xa835452d2b036a74fb0bfa73d7e10e3c516b1ec59760fac283f33d69b6fd4f43",
  assetRoot: "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  boundRoot: "0x32bd9786950f1768fe0d6422a1c8d491e59fcdb706960a355659b6665277172b",
  ownerSecret: 10427067817047264739375061634765270854070477586908251981454477667657234876144n,
  ownerCommitment: 13257167545851383886859378700073274345156193578009534038394940180468538553429n,
  hpkeIkm: "0x18ced215e851625532292ece63e834c0a17a5ff102cc8218b17a3a101aee2004",
  viewPublicKey: "0x6414dcbbf49f55a1b4e81ee7243833b1f8436cddbf20acf5e704d14d698cf251",
  fundsFingerprint: "0xbfd67d827c92d7eedd88c3eac9ba9467c91d70eba41520073364b1af9afa7626",
});
