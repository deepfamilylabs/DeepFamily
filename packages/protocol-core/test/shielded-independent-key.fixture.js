// Public, synthetic recovery vector. These values are not user credentials.
export const independentKeyVector = Object.freeze({
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
    "0x4465657046616d696c793a496e646570656e64656e744b65794964656e7469747950617373776f72643a76310020205061207373c3a92020",
  salt: "0x7dbd17b0c2c3502f504014c9b790b531",
  independentKeyIdentitySecret: "0x6da1d85bf4ec586e83c38c8f90a5acc2088b66287932de1efba14171a2c9a732",
  independentKeyRoot: "0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  boundRoot: "0xac8e920630832a56d499599759944f0fa32175b3755ebce01e3256264da9cd00",
  ownerSecret: 10400222934374357632422407323519977969270195870498123820584356687811761232329n,
  ownerCommitment: 11538469256616061637085443976916945838848915430916707446353062605779991594628n,
  hpkeIkm: "0x13de50f45eb52a98f3443ab41eb8042d2c56ce69610a2fdf16d85e27bbc64ebf",
  viewPublicKey: "0xf13c574b5ab44a4c3dea58c6fa6576ef2a61c19bd294437f8c99027b3311a60c",
  keyFingerprint: "0x37af1368eb551aef95979a52296217d53e66c81eb42fb5619624c76f43d72956",
});
