{
  description = "Spatial-Analytical Knowledge OS";

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
        in
        {
          default = pkgs.mkShell {
            nativeBuildInputs = with pkgs; [
              pkg-config
              gobject-introspection
              rustToolchain        # replaces cargo + rustc + rustfmt + clippy
              cargo-tauri
              nodejs
              typescript
              protobuf
            ];

            buildInputs = with pkgs; [
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
            ];

            shellHook = ''
              export LD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath (with pkgs; [
                webkitgtk_4_1
                gtk3
                cairo
                gdk-pixbuf
                glib
                dbus
                openssl
              ])}:$LD_LIBRARY_PATH
            '';
          };
        }
      );
    };
}
