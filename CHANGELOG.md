# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-24

First stable release. Slacky is a Slack desktop client for Linux arm64 systems,
shipped as AppImage, deb and rpm packages.

### Added
- Multiple workspace support.
- Window focus when a Slack notification is clicked.
- Native handling of huddle pop-out windows.
- deb build target for arm64.
- Auto hide/show of the menu bar.
- Deep linking through the `slack://` protocol.

### Fixed
- Google SSO now completes inside Slacky instead of bouncing to an external browser (#56).
- Unsupported browser warnings caused by an outdated Chrome version in the user agent.

### Changed
- Replaced ESLint with oxlint, and added oxfmt for formatting (#58).
- Upgraded to Electron 42 and dropped `electron-better-web-request`.
- Removed the `(Slack)` suffix from user-agent headers and app URL loading.

## [0.0.10] - 2026-06-23

### Fixed
- Huddle pop-out windows open natively (#54).

## [0.0.9] - 2026-06-15

### Added
- Focus the window when a Slack notification is clicked (#49).

### Fixed
- Bumped the Chrome version in the user agent to clear the browser deprecation warning (#47).

### Changed
- Updated dependencies (Electron 42, ESLint 10) and dropped `electron-better-web-request` (#50).

## [0.0.8] - 2026-01-02

### Added
- deb build target for arm64 (#42).

### Changed
- Removed the `(Slack)` suffix from user-agent headers and app URL loading (#41).

## [0.0.7] - 2025-11-17

### Added
- Support for multiple workspaces (#23).

## [0.0.6] - 2025-07-18

### Fixed
- Unsupported browser issue (#36).

### Changed
- Upgraded dependencies (#29).
- Added the MIT LICENSE (#34).

## [0.0.5] - 2025-01-09

### Changed
- Upgraded dependencies (#21).

## [0.0.4] - 2024-05-26

### Added
- CircleCI configuration (#15).

## [0.0.3] - 2024-04-27

### Added
- Option to hide/show the menu bar automatically (#13).
- arm64 flatpak target (#6).

## [0.0.2] - 2024-01-14

### Added
- TypeScript support via swc (#3).
- ESLint setup and electron-builder configurations (#2).

### Fixed
- Icon path and dev script (#5).

## [0.0.1] - 2023-12-20

### Added
- Initial Electron app loading the Slack client, with electron-builder packaging (#1).

[1.0.0]: https://github.com/andirsun/Slacky/compare/v0.0.10...v1.0.0
[0.0.10]: https://github.com/andirsun/Slacky/compare/v0.0.9...v0.0.10
[0.0.9]: https://github.com/andirsun/Slacky/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/andirsun/Slacky/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/andirsun/Slacky/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/andirsun/Slacky/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/andirsun/Slacky/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/andirsun/Slacky/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/andirsun/Slacky/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/andirsun/Slacky/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/andirsun/Slacky/releases/tag/v0.0.1
