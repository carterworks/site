export default {
  globs: ["src/**/*.ts"],
  exclude: ["src/**/*.test.ts", "src/test/**"],
  packagejson: false,
  plugins: [
    {
      // The analyzer lists #private members too, which no consumer can reach.
      name: "omit-private-members",
      packageLinkPhase({ customElementsManifest }) {
        for (const { declarations = [] } of customElementsManifest.modules) {
          for (const declaration of declarations) {
            declaration.members &&= declaration.members.filter(
              ({ name }) => !name.startsWith("#"),
            );
          }
        }
      },
    },
  ],
};
