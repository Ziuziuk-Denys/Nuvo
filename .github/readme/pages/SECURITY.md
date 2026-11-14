{{head}}

# Security policy

## Report privately

Email hello@nuvo.quest with "Nuvo security" in the subject. Do not open a public issue or pull request for a vulnerability.

Include the version (Settings, Application, About), your system and its version, the steps to reproduce, and what an attacker gains. I reply within a week. I will tell you when a fix ships and credit you if you want.

## In scope

- The background service `nuvo-core`: its local API, authentication, the encrypted database, the encrypted audio cache, the recovery phrase.
- The app window: its bridge to the service, window and permission policy, content security policy, link and file handling, the custom CSS and theme file checks, the tools it downloads and how it checks them.
- Anything that leaks the master key, library contents or listening history to another user, process or host.

## Out of scope

- Attacks that need an already compromised account or root on the machine. Nuvo cannot protect an unlocked keyring from code running as you.
- Weaknesses in YouTube, SoundCloud, yt-dlp, ffmpeg or other services Nuvo talks to. Report those to their maintainers.
- Denial of service by a user against their own machine.
- Missing hardening that has no demonstrated effect.

## Supported versions

Only the latest release gets fixes.

{{nav}}
