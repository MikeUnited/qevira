/** @type {import("lint-staged").Configuration} */
const lintStagedConfig = {
  "*": [() => "eslint .", () => "npx prisma validate"],
};

export default lintStagedConfig;
