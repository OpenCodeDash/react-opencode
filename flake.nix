{
  description = "react-opencode dev shell (node + chromium for playwright e2e)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.nodejs_24 # includes npm
        ];
        # NixOS chromium is fully linked against the store, so playwright
        # can launch it without system libraries.
        CHROMIUM_PATH = "${pkgs.chromium}/bin/chromium";
        shellHook = ''
          export CHROMIUM_PATH
          echo "react-opencode dev shell"
          echo "  node:    $(node --version)"
          echo "  chromium: $CHROMIUM_PATH"
          echo "run:       npm run test:e2e"
        '';
      };
    };
}
