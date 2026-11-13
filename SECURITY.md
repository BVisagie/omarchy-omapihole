# Security

OmaPihole runs inside `omarchy-shell` with your user permissions and handles your Pi-hole's app password and session ID, so security reports are welcome.

## Reporting a vulnerability

Please report it privately through GitHub: on this repository, open **Security → Report a vulnerability**. Don't open a public issue for it.

Say what an attacker can do, and how to reproduce it.

## Supported versions

Only the latest release gets fixes. `v0.2.0` stays available for Omarchy 4.0, but it is not patched.

## Scope

In scope:

- How the helper (`scripts/omapihole`) reads the password file, stores the session, and talks to the Pi-hole.
- Text from the Pi-hole reaching the panel or the bar.
- Anything that sends the password or session ID somewhere other than the configured Pi-hole.

Out of scope: Pi-hole itself (report to [Pi-hole](https://github.com/pi-hole/pi-hole/security)), and Omarchy's shell (report to [Omarchy](https://github.com/basecamp/omarchy)).
