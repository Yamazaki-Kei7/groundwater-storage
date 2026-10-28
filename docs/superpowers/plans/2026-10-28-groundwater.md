# Groundwater WebGIS Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 公式地下水貯留量の月別変化を3Dで閲覧できるWebGISをGitHub Pagesで公開する。

**Architecture:** NetCDFを事前変換し、月別および地点時系列のgzip Float32データとして配信する。MapLibre地図とdeck.gl柱をSvelteコンポーネントで接続する。

**Tech Stack:** SvelteKit 3 / Svelte 5 / Tailwind CSS / MapLibre GL JS / deck.gl / Python.

**Spec:** docs/superpowers/specs/2026-10-28-groundwater-design.md

## Global Constraints

- TypeScriptでany、unknown、不要なclassを使わない。
- 実データの提供期間を表示し、欠測を0や補間値として扱わない。
- GitHub Pagesのサブパスと静的配信に対応。
- 秘密情報を含めない。

## Review Focus

- 欠測月・欠測セルで前の月の値が残らないこと。
- 素早い月移動によって古いリクエストが表示を上書きしないこと。
- 経度0～360と-180～180、緯度方向の対応。
- 取得失敗・未導入・WebGL失敗のとき操作可能な説明があること。
- 時系列グラフで欠測を線で結ばず、柱高と符号を混同しないこと。

## Task 1: データ処理と静的アプリ基盤

Files: package.json, vite.config.ts, svelte.config.js, src/lib/data.ts, src/lib/data.test.ts, scripts/prepare_data.py, scripts/test_prepare_data.py.

Interface: Manifestで年月・格子情報を提供。decodeFrame(buffer, cellCount)で偏差と不確実性を復元。loadFrameとloadSeriesはAbortSignalを受ける。

- [ ] バイナリ長・欠測・符号・経度正規化を検査するテストを書き、失敗を確認。
- [ ] SvelteKit 3静的出力、Tailwind Vite統合、型検査・テストコマンドを構成。
- [ ] Python変換とTypeScript復元を実装。元データと照合可能なマニフェストを出力。
- [ ] テストと型検査を実行し、結果を記録してコミット。

## Task 2: 地図・時系列UI

Files: src/routes/+page.svelte, src/lib/components/GroundwaterMap.svelte, src/lib/components/TimeSeries.svelte, src/app.css.

Interface: GroundwaterMapはcells/frame/height/flatを受け取り、選択セルのインデックスを通知。TimeSeriesは年月と値・不確実性の配列を受け取る。

- [ ] 欠測で線を分割するchartPathsのテストを書き、失敗を確認。
- [ ] 地図・柱・地点選択・月別再生・プリセット・CSV出力・エラー表示を実装。
- [ ] テスト・型検査・本番ビルドを実行。実ブラウザーで表示と操作を確認。
- [ ] コミット。

## Task 3: 実データ導入・公開

Files: .github/workflows/deploy.yml, README.md, static/data/*.

- [ ] CDS設定が利用可能になったら公式データを取得し、SHA256を記録して変換。
- [ ] 原本と出力のセル値・時刻・欠測・不確実性を照合。
- [ ] GitHubリポジトリとPagesを設定し、Actionsでデプロイ。
- [ ] 独立レビュー、全テスト・型検査・ビルドを実施。
- [ ] 公開URLで3D・時系列・データロードを確認。
