<picture><source media="(prefers-color-scheme: dark)" srcset="{{repo}}/raw/{{tag}}/.github/readme/release-dark.png"><img src="{{repo}}/raw/{{tag}}/.github/readme/release-light.png" width="100%" alt="Nuvo. {{tagline}}"></picture>

{{changes}}

## Install

| System | Download |
|---|---|
{{install}}

You need a Secret Service keyring such as GNOME Keyring or KWallet. Full steps: [the install guide]({{site}}/docs/install).

## Unsigned builds

{{unsigned}}

## Check your download

Compare the file with `SHA256SUMS`, or ask GitHub which workflow built it:

```sh
sha256sum -c SHA256SUMS --ignore-missing
gh attestation verify FILE --repo {{slug}}
```
