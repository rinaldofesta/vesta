// Jest config for Vesta. Uses the jest-expo preset so source files transform
// the same way Metro does. Tests live in __tests__ folders next to the code.
module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*.test.{ts,tsx}"],
};
