# Changelog

## [1.5.0](https://github.com/eng618/obsidian-encrypted-folders/compare/1.4.0...1.5.0) (2026-05-24)


### Features

* Add prompt to reprocess and encrypt new plaintext files added to locked folders ([9ba7dfe](https://github.com/eng618/obsidian-encrypted-folders/commit/9ba7dfebb16ad785eae0e3d8899e0b75283e85ec))
* Add required confirmation input to RemovalModal before removing encryption from folders ([7488f33](https://github.com/eng618/obsidian-encrypted-folders/commit/7488f33e32d9d665401467b45e661c69961e5b6e))
* Processing enhancements ([#59](https://github.com/eng618/obsidian-encrypted-folders/issues/59)) ([99603e2](https://github.com/eng618/obsidian-encrypted-folders/commit/99603e2d8d59ff08b15c0f845f1e9ab3ca638766))

## [1.4.0](https://github.com/eng618/obsidian-encrypted-folders/compare/1.3.0...1.4.0) (2026-05-23)


### Features

* Automate versions.json updates via new workflow on release PRs and remove redundant logic from release.yml ([2511843](https://github.com/eng618/obsidian-encrypted-folders/commit/25118437b2b5108e4d2c34a09fa1a710445e0555))

## [1.3.0](https://github.com/eng618/obsidian-encrypted-folders/compare/1.2.0...1.3.0) (2026-05-23)


### Features

* Add visual lock/unlock indicators to folders in the file explorer and include supporting tests ([a68967b](https://github.com/eng618/obsidian-encrypted-folders/commit/a68967ba10a2f3ad5976cb3c1359782b51306f26))


### Bug Fixes

* Handle non-Error objects in removal failure notice to prevent runtime exceptions ([9b0bc19](https://github.com/eng618/obsidian-encrypted-folders/commit/9b0bc194f7a6e9ef8ffd4cd4867e3b8af1f150d4))

## [1.2.0](https://github.com/eng618/obsidian-encrypted-folders/compare/1.1.0...1.2.0) (2026-05-23)


### Features

* Add brute-force protection to password modal with configurable retry limits and exponential backoff ([af91e81](https://github.com/eng618/obsidian-encrypted-folders/commit/af91e81e39f830514449b5b7aded8fbf231248a6))
* Implement transactional folder encryption with automatic rollback on failure ([27cd9a7](https://github.com/eng618/obsidian-encrypted-folders/commit/27cd9a708fbc41ccc5d8169dea4eaaf8984ccc65))

## [1.1.0](https://github.com/eng618/obsidian-encrypted-folders/compare/1.0.0...1.1.0) (2026-03-10)


### Features

* Add folder context menu integration and enhance README content for encrypted folders ([1eae775](https://github.com/eng618/obsidian-encrypted-folders/commit/1eae7750d1e516a423646c3970bb64f76f1effb4))
* Add folder metadata migration and locking functionality ([e975e22](https://github.com/eng618/obsidian-encrypted-folders/commit/e975e2240b3f079c50b4e97ae533c47b3940d08b))
* Implement configurable auto-lock safeguards for unlocked folders ([fb4da49](https://github.com/eng618/obsidian-encrypted-folders/commit/fb4da498e70ff8debdaa1151be821162f824aed7))


### Bug Fixes

* Replace toArrayBuffer method with toBufferView for improved consistency ([bf9a326](https://github.com/eng618/obsidian-encrypted-folders/commit/bf9a3266486811b973078c50040b96c06a4fb6db))

## [1.0.0](https://github.com/eng618/obsidian-encrypted-folders/compare/0.0.1...1.0.0) (2026-03-07)


### Features

* Add "Buy Me A Coffee" links to README and a funding URL to manifest. ([4481c07](https://github.com/eng618/obsidian-encrypted-folders/commit/4481c0731ecba57de2c21d28a211ac67c1816e55))
* Add a `validate` script to `package.json` and a shell script to automate code quality checks including formatting, linting, type checking, building, and testing. ([8e6ef6d](https://github.com/eng618/obsidian-encrypted-folders/commit/8e6ef6d7cdcdd74a74c594fc94ed85510a614e5d))
* Add core services for file and folder encryption, password modal, settings tab, and a development plan. ([f49faa0](https://github.com/eng618/obsidian-encrypted-folders/commit/f49faa01fff5e3ad8e7d3e7ccce20846dbb82589))
* Add password visibility toggle to password fields in `PasswordModal` and `RemovalModal` via `UIUtils`. ([a7ceaf4](https://github.com/eng618/obsidian-encrypted-folders/commit/a7ceaf48d49f436a2508d0dd02384dfdd7ad31f4))
* Enhance folder encryption management with metadata migration and sync improvements ([534b4d4](https://github.com/eng618/obsidian-encrypted-folders/commit/534b4d48aaf782bc6ead7a2e1dd256ceb3e756db))
* Implement comprehensive testing, CI, detailed walkthrough, password strength validation, and folder lifecycle management. ([44fa77d](https://github.com/eng618/obsidian-encrypted-folders/commit/44fa77d60236e18e514cd7f7bdddacdb3d237b73))
* Implement functionality to permanently remove encryption from folders with a new confirmation modal. ([4981e05](https://github.com/eng618/obsidian-encrypted-folders/commit/4981e05b5496fa616ee487c460714fca053aac33))
* Implement master key wrapping, recovery key generation, and a dedicated recovery key modal. ([36209c5](https://github.com/eng618/obsidian-encrypted-folders/commit/36209c59f4350a4dfb3ca13d0c1ccaa85babc670))
* Implement secure file writing and recursive content encryption/decryption for encrypted folders. ([1023716](https://github.com/eng618/obsidian-encrypted-folders/commit/102371634fb7c501ce5afed8885a6dfa547faeb4))
* Introduce immediate folder locking, file shredding for encrypted files with a `.locked` extension, and enhanced encrypted folder detection. ([661f607](https://github.com/eng618/obsidian-encrypted-folders/commit/661f607f7e4ebb2f0443eb2ca0a9ddb5df1fdb47))
* Prevent nested encryption and introduce a dedicated modal for folder removal. ([c28dea6](https://github.com/eng618/obsidian-encrypted-folders/commit/c28dea66b95789dedd94d6265ba04cf6126c635a))
* Update project license from ISC-like to MIT and revise copyright information. ([34b78e1](https://github.com/eng618/obsidian-encrypted-folders/commit/34b78e1865ffdc982fd73ecde8374ade45628db8))


### Bug Fixes

* Show locked md when immediately locked on creation. ([6c80088](https://github.com/eng618/obsidian-encrypted-folders/commit/6c80088b36001f628c72d4f2d93542480bdd1578))
* Udpate yarn.lock ([b57c30f](https://github.com/eng618/obsidian-encrypted-folders/commit/b57c30fcb6cf64c137324c34f973a44188211770))
* Update plugin ID and enhance description for clarity ([432c7c3](https://github.com/eng618/obsidian-encrypted-folders/commit/432c7c392df7c24b07c9a4b4d88caf3f8826f775))

## 1.0.0 (2026-03-07)


### Features

* Add "Buy Me A Coffee" links to README and a funding URL to manifest. ([4481c07](https://github.com/eng618/obsidian-encrypted-folders/commit/4481c0731ecba57de2c21d28a211ac67c1816e55))
* Add a `validate` script to `package.json` and a shell script to automate code quality checks including formatting, linting, type checking, building, and testing. ([8e6ef6d](https://github.com/eng618/obsidian-encrypted-folders/commit/8e6ef6d7cdcdd74a74c594fc94ed85510a614e5d))
* Add core services for file and folder encryption, password modal, settings tab, and a development plan. ([f49faa0](https://github.com/eng618/obsidian-encrypted-folders/commit/f49faa01fff5e3ad8e7d3e7ccce20846dbb82589))
* Add password visibility toggle to password fields in `PasswordModal` and `RemovalModal` via `UIUtils`. ([a7ceaf4](https://github.com/eng618/obsidian-encrypted-folders/commit/a7ceaf48d49f436a2508d0dd02384dfdd7ad31f4))
* Enhance folder encryption management with metadata migration and sync improvements ([534b4d4](https://github.com/eng618/obsidian-encrypted-folders/commit/534b4d48aaf782bc6ead7a2e1dd256ceb3e756db))
* Implement comprehensive testing, CI, detailed walkthrough, password strength validation, and folder lifecycle management. ([44fa77d](https://github.com/eng618/obsidian-encrypted-folders/commit/44fa77d60236e18e514cd7f7bdddacdb3d237b73))
* Implement functionality to permanently remove encryption from folders with a new confirmation modal. ([4981e05](https://github.com/eng618/obsidian-encrypted-folders/commit/4981e05b5496fa616ee487c460714fca053aac33))
* Implement master key wrapping, recovery key generation, and a dedicated recovery key modal. ([36209c5](https://github.com/eng618/obsidian-encrypted-folders/commit/36209c59f4350a4dfb3ca13d0c1ccaa85babc670))
* Implement secure file writing and recursive content encryption/decryption for encrypted folders. ([1023716](https://github.com/eng618/obsidian-encrypted-folders/commit/102371634fb7c501ce5afed8885a6dfa547faeb4))
* Introduce immediate folder locking, file shredding for encrypted files with a `.locked` extension, and enhanced encrypted folder detection. ([661f607](https://github.com/eng618/obsidian-encrypted-folders/commit/661f607f7e4ebb2f0443eb2ca0a9ddb5df1fdb47))
* Prevent nested encryption and introduce a dedicated modal for folder removal. ([c28dea6](https://github.com/eng618/obsidian-encrypted-folders/commit/c28dea66b95789dedd94d6265ba04cf6126c635a))
* Update project license from ISC-like to MIT and revise copyright information. ([34b78e1](https://github.com/eng618/obsidian-encrypted-folders/commit/34b78e1865ffdc982fd73ecde8374ade45628db8))


### Bug Fixes

* Show locked md when immediately locked on creation. ([6c80088](https://github.com/eng618/obsidian-encrypted-folders/commit/6c80088b36001f628c72d4f2d93542480bdd1578))
* Udpate yarn.lock ([b57c30f](https://github.com/eng618/obsidian-encrypted-folders/commit/b57c30fcb6cf64c137324c34f973a44188211770))
* Update plugin ID and enhance description for clarity ([432c7c3](https://github.com/eng618/obsidian-encrypted-folders/commit/432c7c392df7c24b07c9a4b4d88caf3f8826f775))

## Changelog
