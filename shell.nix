# Playwright's Chromium is a generic Linux build, so on NixOS nix-ld has to be
# told where its libraries are: `nix-shell --run "pnpm perf"`.
{
  pkgs ? import <nixpkgs> { },
}:
pkgs.mkShellNoCC {
  shellHook = ''
    export NIX_LD_LIBRARY_PATH=${
      pkgs.lib.makeLibraryPath (
        with pkgs;
        [
          alsa-lib
          at-spi2-core
          cairo
          cups
          dbus
          expat
          glib
          libgbm
          libglvnd
          libx11
          libxcb
          libxcomposite
          libxdamage
          libxext
          libxfixes
          libxkbcommon
          libxrandr
          nspr
          nss
          pango
          udev
        ]
      )
    }:$NIX_LD_LIBRARY_PATH
  '';
}
