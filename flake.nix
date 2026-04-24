{
  description = "Humanist";

  inputs = {
    nixpkgs.url     = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    rust-overlay.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, rust-overlay }:
    let
      supportedSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
    in
    {
      devShells = forAllSystems (system:
        let
          overlays = [ (import rust-overlay) ];
          pkgs = import nixpkgs { inherit system overlays; };
          # Always use the current stable Rust — no version pin
          rustToolchain = pkgs.rust-bin.stable.latest.default.override {
            extensions = [ "rust-src" "rustfmt" "clippy" ];
          };
          commonNativeBuildInputs = with pkgs; [
            pkg-config
            gobject-introspection
            rustToolchain
            cargo-tauri
            nodejs
            typescript
            protobuf
          ];
          commonBuildInputs = with pkgs; [
            at-spi2-atk
            atkmm
            cairo
            gdk-pixbuf
            glib
            gtk3
            harfbuzz
            librsvg
            libsoup_3
            pango
            webkitgtk_4_1
            openssl
            gst_all_1.gstreamer
            gst_all_1.gst-plugins-base
            gst_all_1.gst-plugins-good
            gst_all_1.gst-plugins-bad
            gst_all_1.gst-plugins-ugly
          ];
          commonShellHook = ''
            export LD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath (with pkgs; [
              webkitgtk_4_1
              gtk3
              cairo
              gdk-pixbuf
              glib
              dbus
              openssl
              gst_all_1.gstreamer
              gst_all_1.gst-plugins-base
            ])}:$LD_LIBRARY_PATH
          '';
        in
        {
          default = pkgs.mkShell {
            nativeBuildInputs = commonNativeBuildInputs ++ (with pkgs; [
              bash
              coreutils
              findutils
              xdg-utils
            ]);
            buildInputs = commonBuildInputs;
            shellHook = commonShellHook;
          };

          appimage = (pkgs.buildFHSEnv {
            name = "spatial-os-appimage";
            targetPkgs = pkgs: commonNativeBuildInputs ++ commonBuildInputs ++ (with pkgs; [
              bash
              coreutils
              findutils
              xdg-utils
            ]);
            runScript = "bash";
            profile = commonShellHook;
          }).env;
        }
      );
    };
}
