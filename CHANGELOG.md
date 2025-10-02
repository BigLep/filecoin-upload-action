## [1.0.10](https://github.com/SgtPooki/filecoin-upload-action/compare/v1.0.9...v1.0.10) (2025-10-02)

### Bug Fixes

* display car file size ([d0b874d](https://github.com/SgtPooki/filecoin-upload-action/commit/d0b874d4db5bb18fc4cff4789947ecd0c5ddd9d8))

## [1.0.9](https://github.com/SgtPooki/filecoin-upload-action/compare/v1.0.8...v1.0.9) (2025-10-02)

### Bug Fixes

* car download link and balance display correctly ([e74ddd7](https://github.com/SgtPooki/filecoin-upload-action/commit/e74ddd720dfe72b906de2e77c0b7332299a4f8c1))

## [1.0.8](https://github.com/SgtPooki/filecoin-upload-action/compare/v1.0.7...v1.0.8) (2025-10-02)

### Bug Fixes

* normalize context/metadata usage ([d615cc3](https://github.com/SgtPooki/filecoin-upload-action/commit/d615cc3cffdf0f8d65d8a444022e3f006e71e5ed))

## [1.0.7](https://github.com/SgtPooki/filecoin-upload-action/compare/v1.0.6...v1.0.7) (2025-10-02)

### Bug Fixes

* use build run id for artifact in upload flow ([556d7b6](https://github.com/SgtPooki/filecoin-upload-action/commit/556d7b697d15cfaa9f2db0e5cf2a1de209214303))

## [1.0.6](https://github.com/SgtPooki/filecoin-upload-action/compare/v1.0.5...v1.0.6) (2025-10-02)

### Bug Fixes

* common artifact name resolution ([e5e2f41](https://github.com/SgtPooki/filecoin-upload-action/commit/e5e2f41b0cf4ccb07446d1eeca8407fe408d2aaf))

## [1.0.5](https://github.com/SgtPooki/filecoin-upload-action/compare/v1.0.4...v1.0.5) (2025-10-02)

### Bug Fixes

* pr comment and action summary display relevant info ([#6](https://github.com/SgtPooki/filecoin-upload-action/issues/6)) ([1cc2b76](https://github.com/SgtPooki/filecoin-upload-action/commit/1cc2b7676349fefee971f29ce3cfdd73d562e7d5))

## [1.0.4](https://github.com/SgtPooki/filecoin-upload-action/compare/v1.0.3...v1.0.4) (2025-10-02)

### Bug Fixes

* fork PRs build artifacts in base repo ([132f21f](https://github.com/SgtPooki/filecoin-upload-action/commit/132f21fa191ed50c603b989c782776fe79462c1c))

## [1.0.3](https://github.com/SgtPooki/filecoin-upload-action/compare/v1.0.2...v1.0.3) (2025-10-02)

### Bug Fixes

* cap spend via maxBalance, remove minBalance ([#5](https://github.com/SgtPooki/filecoin-upload-action/issues/5)) ([808d623](https://github.com/SgtPooki/filecoin-upload-action/commit/808d623645c72bd92054ac19e8587bcf8c4cee55))

## [1.0.2](https://github.com/SgtPooki/filecoin-upload-action/compare/v1.0.1...v1.0.2) (2025-10-02)

### Bug Fixes

* regular prs are not flagged as fork prs ([a7bef0e](https://github.com/SgtPooki/filecoin-upload-action/commit/a7bef0e091b5fcb817783fc3660a49b20d52c9f4))

## [1.0.1](https://github.com/SgtPooki/filecoin-upload-action/compare/v1.0.0...v1.0.1) (2025-10-02)

### Bug Fixes

* temporarily disable fork prs ([#4](https://github.com/SgtPooki/filecoin-upload-action/issues/4)) ([a06530a](https://github.com/SgtPooki/filecoin-upload-action/commit/a06530a087514d63bc13cb312c4b1239bade5e85))

## 1.0.0 (2025-10-02)

### ⚠ BREAKING CHANGES

* encourage two-workflow pattern

### Features

* encourage two-workflow pattern ([321d949](https://github.com/SgtPooki/filecoin-upload-action/commit/321d949005ad0df0ab26c76a9f0644d0399dee88))
* initial pass ([56c3695](https://github.com/SgtPooki/filecoin-upload-action/commit/56c3695cf8e36f308ab474ce770c668ed6f1a8c0))
* move logic to js, lint, typecheck ([#3](https://github.com/SgtPooki/filecoin-upload-action/issues/3)) ([04754f9](https://github.com/SgtPooki/filecoin-upload-action/commit/04754f9cfe83b1e888d527132d9c8df925506a9b))

### Bug Fixes

* add annotations back ([641a2bf](https://github.com/SgtPooki/filecoin-upload-action/commit/641a2bf866d4ad0c47c98c0ddefaffdd4e628500))
* add versioning and semantic release ([b89a89e](https://github.com/SgtPooki/filecoin-upload-action/commit/b89a89eadbc6d83be9ad5cea7468d5fa908c4177))
* build context path ([5604ff0](https://github.com/SgtPooki/filecoin-upload-action/commit/5604ff0a49598ab27f525fef7bdca00388c75379))
* build/upload context sharing ([cf5bfdb](https://github.com/SgtPooki/filecoin-upload-action/commit/cf5bfdb1c01a1360e3a4926c8309d0227623ccad))
* car upload ([692f89e](https://github.com/SgtPooki/filecoin-upload-action/commit/692f89eb03ebb42dc055cfb459c33fbf45681398))
* cleanup calls to run.mjs ([6178c46](https://github.com/SgtPooki/filecoin-upload-action/commit/6178c46a0d86911cb908e18ce39134cfb2e77534))
* continue on artifact download error ([ac1fd16](https://github.com/SgtPooki/filecoin-upload-action/commit/ac1fd168dea9a642a30ed7d8e6764f8015f9c7fe))
* downloading artifact during upload ([4a10928](https://github.com/SgtPooki/filecoin-upload-action/commit/4a10928a9400103ff2a82db6af9b7ede7b36d4a9))
* downloading artifact during upload step ([5cabda4](https://github.com/SgtPooki/filecoin-upload-action/commit/5cabda49f7c499094ba1bcb0975d527533c46492))
* downloading artifact during upload step ([29362f0](https://github.com/SgtPooki/filecoin-upload-action/commit/29362f025b573d0083d2d2042d17fc06a214f886))
* example should include push to main trigger ([b338b7c](https://github.com/SgtPooki/filecoin-upload-action/commit/b338b7cc2718b3bf9b288b57abb35604aaac0a4d))
* final upload summary after pr ([ebceaca](https://github.com/SgtPooki/filecoin-upload-action/commit/ebceacab5a0197ae9d5f802e8543c6025d6aaa04))
* first-use helpers ([#2](https://github.com/SgtPooki/filecoin-upload-action/issues/2)) ([c3ec1d0](https://github.com/SgtPooki/filecoin-upload-action/commit/c3ec1d02ba6504eec5fca2b11dd9979013c605ad))
* fix manual upload run ([3502fa4](https://github.com/SgtPooki/filecoin-upload-action/commit/3502fa4607ac3a91ae06d87c94cd3f383e80a7b0))
* glob path for car ([1ebb0a1](https://github.com/SgtPooki/filecoin-upload-action/commit/1ebb0a18ea19ffcf90c3969bd960e2bc39347677))
* grant proper permissions ([a795084](https://github.com/SgtPooki/filecoin-upload-action/commit/a795084a3dfd2a8237e490286c1d5492a58b5623))
* invalid time error ([6b25a7c](https://github.com/SgtPooki/filecoin-upload-action/commit/6b25a7cbd4686acefbcb6274946d45f4d52ea659))
* normalized context usage ([e6f1749](https://github.com/SgtPooki/filecoin-upload-action/commit/e6f17491a9319c2fc75159ed8a2a274fa864a01b))
* prior artifact checking ([d36cf11](https://github.com/SgtPooki/filecoin-upload-action/commit/d36cf117de63f516d1393f416c3bd5f99bda98a0))
* remove metadata artifact error message on main branch push ([00e0e58](https://github.com/SgtPooki/filecoin-upload-action/commit/00e0e58e2dd1d8ac7a56c332efcd786c5ea6ee13))
* should checkout proper sha when ran from main ([6ec5fe6](https://github.com/SgtPooki/filecoin-upload-action/commit/6ec5fe64145a7456293f169ca5df0c5d4db0ded0))
* simplify where build context is saved & read ([ead6a76](https://github.com/SgtPooki/filecoin-upload-action/commit/ead6a76e7ad964597ca0a68b37559f634af47d3b))
* update package-lock.json, consumers get prod deps only ([09c5017](https://github.com/SgtPooki/filecoin-upload-action/commit/09c5017ff32e76d66067c2c871e0e1195078b8bf))
* upload flow can determine buildRunId ([54ab050](https://github.com/SgtPooki/filecoin-upload-action/commit/54ab050166dc0e7f525bb9070d35596ac62ed587))
* use github action path for cwd ([c3018b1](https://github.com/SgtPooki/filecoin-upload-action/commit/c3018b13bb7fb18fc6d06e8767f5387da11e7f74))
* walletPrivateKey input for run.mjs ([6980e31](https://github.com/SgtPooki/filecoin-upload-action/commit/6980e31e4a697eba9999adf4a87427898edc0ae5))
* walletPrivateKey passing to synapse ([8da2f2e](https://github.com/SgtPooki/filecoin-upload-action/commit/8da2f2e7ccd2e44a7f9199d5777f7d4fb284cb52))

# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.
