# Changelog

All notable changes to OmaPihole. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - Unreleased

### Changed

- **Requires Omarchy 4.5 or newer.** On Omarchy 4.0, stay on `v0.2.0` (see the README).
- The blocked list shows what the Pi-hole blocked for this computer, and falls back to the whole network, saying so, when the Pi-hole sees this computer through a proxy or NAT.
- The palette is read as `Commons.Color`, every string is drawn as plain text, and animations follow `omarchy toggle animations`, as Omarchy's plugin guide asks.
- Settings are saved in one write that keeps the fields the setup form does not edit.
- The plugin's strings are in `i18n/en.json` and follow Setup > Language; numbers use the language's separator and digits. English only so far.

### Added

- A line in the panel when the Pi-hole has an update waiting, and a count of its warnings.
- `caFile`: trust the certificate authority that signed the Pi-hole's HTTPS certificate, instead of skipping verification with `allowInsecure`.
- `rightClick`: `pause` makes a right click pause for five minutes, or resume.
- `refreshSeconds: 0` turns timed polling off.
- Timed polls back off while the Pi-hole is rate-limiting.

### Fixed

- After a URL change, or when **Test connection** checked a draft URL, the saved session ID was sent to the other host. Sessions are now tied to their host, and **Test connection** uses a throwaway session.
- A valid saved session let **Test connection** pass with a wrong password file.
- The same blocked domain could be listed more than once.

### Security

- `curl` is limited to HTTP and HTTPS and to 1 MB per response, and a URL with any other scheme is refused.
- Blocked domains, history and error text from the Pi-hole are validated and bounded before they reach the panel.

## [0.2.0] - 2026-10-06

### Added

- **Allow** for a blocked domain, behind a confirming second click.
- Away-from-home state for a private-IP Pi-hole that is unreachable.

### Changed

- Setup and keyboard handling reworked; the panel opens with no pause chip selected.
- A 429 is a retryable failure, not a reason to show setup.

### Fixed

- Test connection checks the same endpoints the widget uses.
- The panel could stay open when the bar API was read-only.
- Popup text colors on a transparent bar, and muted text that was too faint to read.
- Responses from a previous URL could repaint the widget.

### Security

- The session ID is passed to `curl` on a pipe, not on its command line.
- Password and session files are read through one file descriptor.

## [0.1.0] - 2026-09-03

First release: blocking state, block rate and a pause countdown in the bar; a panel with the 24-hour sparkline, stats, pause chips and the last blocked domains; IPC for keybindings.

[0.3.0]: https://github.com/BVisagie/omarchy-omapihole/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/BVisagie/omarchy-omapihole/releases/tag/v0.2.0
[0.1.0]: https://github.com/BVisagie/omarchy-omapihole/commit/d083426
