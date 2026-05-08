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
      forAllSystems    = nixpkgs.lib.genAttrs supportedSystems;

      mkPkgs = system: import nixpkgs {
        inherit system;
        overlays = [ (import rust-overlay) ];
      };

      mkRustToolchain = pkgs: pkgs.rust-bin.stable.latest.default.override {
        extensions = [ "rust-src" "rustfmt" "clippy" ];
      };

      mkBuildInputs = pkgs: with pkgs; [
        at-spi2-atk atkmm cairo gdk-pixbuf glib gtk3 harfbuzz
        librsvg libsoup_3 pango webkitgtk_4_1 openssl
        gst_all_1.gstreamer gst_all_1.gst-plugins-base
        gst_all_1.gst-plugins-good gst_all_1.gst-plugins-bad
        gst_all_1.gst-plugins-ugly
      ];

      mkNativeBuildInputs = pkgs: with pkgs; [
        pkg-config gobject-introspection (mkRustToolchain pkgs)
        cargo-tauri nodejs typescript protobuf
      ];
    in
    {
      # ── Installable package ────────────────────────────────────────────────
      packages = forAllSystems (system:
        let
          pkgs = mkPkgs system;

          # Build the Vite frontend separately so Cargo's sandbox can use it.
          # On first run, replace the npmDepsHash with the one reported in the
          # error: run `nix build` and copy the hash from the output.
          frontend = pkgs.buildNpmPackage {
            pname       = "humanist-frontend";
            version     = "0.1.0";
            src         = ./os_gui;
            npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
            installPhase = ''
              mkdir -p $out
              cp -r dist/. $out/
            '';
          };
        in
        {
          default = pkgs.rustPlatform.buildRustPackage {
            pname   = "humanist";
            version = "0.1.0";
            src     = ./.;
            cargoLock.lockFile = ./Cargo.lock;

            nativeBuildInputs = (mkNativeBuildInputs pkgs) ++ [ pkgs.wrapGAppsHook ];
            buildInputs       = mkBuildInputs pkgs;

            preBuild = ''
              mkdir -p os_gui/dist
              cp -r ${frontend}/. os_gui/dist/
            '';

            buildPhase = ''
              runHook preBuild
              cd os_gui
              cargo tauri build --bundles none
              cd ..
              runHook postBuild
            '';

            installPhase = ''
              install -Dm755 target/release/os_gui $out/bin/humanist
            '';

            doCheck = false;
          };
        }
      );

      # ── nix run ───────────────────────────────────────────────────────────
      apps = forAllSystems (system: {
        default = {
          type    = "app";
          program = "${self.packages.${system}.default}/bin/humanist";
        };
      });

      # ── Development shells ────────────────────────────────────────────────
      devShells = forAllSystems (system:
        let
          pkgs                    = mkPkgs system;
          commonNativeBuildInputs = (mkNativeBuildInputs pkgs) ++ (with pkgs; [
            bash coreutils findutils xdg-utils
          ]);
          commonBuildInputs = mkBuildInputs pkgs;
          commonShellHook   = ''
            export LD_LIBRARY_PATH=${pkgs.lib.makeLibraryPath (with pkgs; [
              webkitgtk_4_1 gtk3 cairo gdk-pixbuf glib dbus openssl
              gst_all_1.gstreamer gst_all_1.gst-plugins-base
            ])}:$LD_LIBRARY_PATH
          '';
        in
        {
          default = pkgs.mkShell {
            nativeBuildInputs = commonNativeBuildInputs;
            buildInputs       = commonBuildInputs;
            shellHook         = commonShellHook;
          };

          appimage = (pkgs.buildFHSEnv {
            name       = "humanist-appimage";
            targetPkgs = pkgs: commonNativeBuildInputs ++ commonBuildInputs ++ (with pkgs; [
              bash coreutils findutils xdg-utils
            ]);
            runScript = "bash";
            profile   = commonShellHook;
          }).env;
        }
      );
    };
}
