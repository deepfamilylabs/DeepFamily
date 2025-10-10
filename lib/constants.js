/**
 * Shared constants used across the project
 * This file has no dependencies to avoid circular imports and Hardhat context issues
 */

/**
 * Standard demo root person data used across all scripts
 * Ensures consistent hash generation for the root node
 */
const DEMO_ROOT_PERSON = {
  fullName: "DemoRoot",
  passphrase: "",
  isBirthBC: false,
  birthYear: 1970,
  birthMonth: 1,
  birthDay: 1,
  gender: 1,
};

module.exports = {
  DEMO_ROOT_PERSON,
};
