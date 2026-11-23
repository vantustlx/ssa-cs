
{ pkgs ? import <nixpkgs> {} }:

let
  libraries = with pkgs; [
    glib
    nss
    nspr
    atk
    cups
    gtk3
    libdrm
    mesa
    expat
    xorg.libxcb
    xorg.libX11
    xorg.libXcomposite
    xorg.libXdamage
    xorg.libXext
    xorg.libXfixes
    xorg.libXrandr
    libxkbcommon
    pango
    cairo
    alsa-lib
    dbus
  ];
in
pkgs.mkShell {
  packages = with pkgs; [
    electron
  ] ++ libraries;

  LD_LIBRARY_PATH =
    pkgs.lib.makeLibraryPath libraries
    + ":/nix/store/knm96d081dl0mhbbdbmi2gwqj2sn0jbh-mesa-libgbm-26.1.3/lib";
}
