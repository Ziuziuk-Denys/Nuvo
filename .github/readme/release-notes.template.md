<picture><source media="(prefers-color-scheme: dark)" srcset="{{repo}}/raw/{{tag}}/.github/readme/release-dark.png"><img src="{{repo}}/raw/{{tag}}/.github/readme/release-light.png" width="100%" alt="Nuvo. {{tagline}}"></picture>

{{changes}}

## Install

| System | Download |
|---|---|
{{install}}

### Encrypted edition

The same Nuvo with the library and the audio cache encrypted on disk, under a key kept in the system keyring. Switching editions keeps your likes, playlists, lyrics and settings.

| System | Download |
|---|---|
{{install_encrypted}}

On Linux, the encrypted edition keeps its key in a Secret Service keyring such as GNOME Keyring or KWallet; the standard edition uses the keyring only for the accounts you connect. Full steps: [the install guide]({{site}}/docs/install).

## Unsigned builds

{{unsigned}}

## Check your download

Compare the file with `SHA256SUMS`, or ask GitHub which workflow built it:

```sh
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify FILE --repo {{slug}}
```

{{more}}
