import { expect } from "chai";

export const expectRegularFileWithPosixMode = (stats, expectedMode) => {
  expect(stats.isFile()).to.equal(true);
  // Windows exposes synthetic mode bits here, not a security-equivalent ACL.
  if (process.platform !== "win32") {
    expect(stats.mode & 0o777).to.equal(expectedMode);
  }
};
