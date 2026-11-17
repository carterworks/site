export default {
  globs: ["src/pixel-backdrop/element.ts", "src/emulated-canvas/element.ts"],
  packagejson: false,
  plugins: [
    {
      // The analyzer lists #private members too, which no consumer can reach,
      // and modules in the order the file system returns them, which differs
      // between machines.
      name: "tidy",
      packageLinkPhase({ customElementsManifest }) {
        customElementsManifest.modules.sort((a, b) =>
          a.path.localeCompare(b.path),
        );
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
