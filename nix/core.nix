{
  lib,
  rustPlatform,
  pkg-config,
  cmake,
  sqlcipher,
  libsecret,
  dbus,
}:

rustPlatform.buildRustPackage {
  pname = "nuvo-core";
  version = (lib.importJSON ../package.json).version;

  src = ../core;

  cargoLock.lockFile = ../core/Cargo.lock;
  buildAndTestSubdir = "crates/server";

  nativeBuildInputs = [
    pkg-config
    cmake
  ];

  buildInputs = [
    sqlcipher
    libsecret
    dbus
  ];

  # aws-lc-sys: build from source using cmake without panicking on system AWS-LC
  preBuild = "unset AWS_LC_SYS_USE_SYSTEM;";

  # Nuvo tests include heavy integration checks (speech models, FFT, 3000px images);
  # skip during release packaging
  doCheck = false;

  meta = with lib; {
    description = "Backend core server for Nuvo music player";
    homepage = "https://nuvo.quest";
    license = licenses.agpl3Plus;
    mainProgram = "nuvo-core";
  };
}
