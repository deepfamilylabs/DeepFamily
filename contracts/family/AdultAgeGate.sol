// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library AdultAgeGate {
  error InvalidBirthYear();
  error MustBeAdult();

  uint256 private constant MINIMUM_MINT_AGE = 18;
  uint256 private constant SECONDS_PER_DAY = 24 * 60 * 60;
  int256 private constant OFFSET19700101 = 2440588;

  function enforceAdult(
    bool isBirthBC,
    uint16 birthYear,
    uint8 birthMonth,
    uint8 birthDay
  ) external view {
    if (isBirthBC || birthYear == 0) return;

    (uint256 currentYear, uint256 currentMonth, uint256 currentDay) = _timestampToDate(
      block.timestamp
    );

    if (birthYear > currentYear) revert InvalidBirthYear();

    uint256 ageYears = currentYear - uint256(birthYear);
    if (ageYears > MINIMUM_MINT_AGE) return;
    if (ageYears < MINIMUM_MINT_AGE) revert MustBeAdult();

    if (birthMonth == 0) return;
    if (currentMonth < birthMonth) revert MustBeAdult();
    if (currentMonth > birthMonth) return;

    if (birthDay != 0 && currentDay < uint256(birthDay)) revert MustBeAdult();
  }

  function _timestampToDate(
    uint256 timestamp
  ) private pure returns (uint256 year, uint256 month, uint256 day) {
    uint256 daysSinceEpoch = timestamp / SECONDS_PER_DAY;
    int256 dayCount = int256(daysSinceEpoch);

    int256 dateOffset = dayCount + 68569 + OFFSET19700101;
    int256 n = (4 * dateOffset) / 146097;
    dateOffset = dateOffset - (146097 * n + 3) / 4;
    int256 yearValue = (4000 * (dateOffset + 1)) / 1461001;
    dateOffset = dateOffset - (1461 * yearValue) / 4 + 31;
    int256 monthValue = (80 * dateOffset) / 2447;
    int256 dayValue = dateOffset - (2447 * monthValue) / 80;
    dateOffset = monthValue / 11;
    monthValue = monthValue + 2 - 12 * dateOffset;
    yearValue = 100 * (n - 49) + yearValue + dateOffset;

    return (uint256(yearValue), uint256(monthValue), uint256(dayValue));
  }
}
