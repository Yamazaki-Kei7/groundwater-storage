# Groundwater Atlas

衛星重力観測に基づく地下水貯留量の変化を、地球儀と地点時系列で探索する日本語WebGISです。

- 公開サイト: https://Yamazaki-Kei7.github.io/groundwater-storage/
- SvelteKit 3 / Svelte 5 / Tailwind CSS 4 / MapLibre GL JS 6 / deck.gl 9
- ドラッグで地球儀を回転、スクロール・ピンチで拡大縮小
- 世界・日本・インド・北米・欧州・アマゾンの表示、球面上のデータの3D柱/2D表示切替、高さ調整
- 月別再生、欠測の表示、地点選択、提供された不確実性、時系列・CSV出力

## データの意味

[Copernicus C3Sの公式地下水データ](https://cds.climate.copernicus.eu/datasets/satellite-groundwater-storage?tab=overview) v1.0を使用しています。2026年10月28日の取得時点の提供期間は **2002年4月〜2023年9月**。258暦月のうち225観測月・33欠測月、59,018陸域格子です。現在までの未提供値を推定・補間していません。

数値は **2003〜2022年平均に対する地下水貯留量の偏差（mm相当水高）** です。絶対的な地下水量、水位、地中深度ではありません。青は正、橙は負、柱の高さは偏差の絶対値を誇張して示します。格子間隔0.5°に対し、実効空間解像度は約250〜300 kmです。

不確実性は製品の `gwsc_uncertainty` をそのまま表示します。グラフの破線は値±提供された不確実性で、特定の信頼水準を意味しません。欠測はNaN・グラフの空白・CSVの空欄として扱います。全期間共通の色尺度は絶対値の98パーセンタイルを50 mm単位で切り上げ、範囲外は端色に飽和します。

出典: Copernicus Climate Change Service (C3S) / ECMWF / GFZ, *C3S Globally Gridded Groundwater Storage Change*, v1.0. DOI: [10.5880/GFZ.C3S_GWSC_v1.0](https://doi.org/10.5880/GFZ.C3S_GWSC_v1.0)。データ利用条件は [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。原本からFloat32配列への変換・並べ替え・gzip圧縮を行っています。詳しくは[公式製品ガイド](https://confluence.ecmwf.int/x/sA0nJw)をご覧ください。

背景地図は [OpenFreeMap](https://openfreemap.org/) / OpenMapTiles / OpenStreetMap。背景地図へのアクセスには外部通信を使用します。

## ローカル実行

Node.js 22以上を使用します。

```sh
npm ci
npm run dev
```

http://127.0.0.1:5173/ を開きます。変換済みデータを同梱しているため、閲覧にCDS認証は不要です。WebGL2とDecompressionStreamに対応する現行ブラウザーが必要です。

```sh
npm test
npm run check
BASE_PATH=/groundwater-storage npm run build
BASE_PATH=/groundwater-storage npm run preview
```

GitHub Pagesのサブパスは `BASE_PATH` で設定します。SvelteKit 3の設定は `vite.config.ts` 内の `sveltekit()` オプションにあります。`svelte.config.js` は不要です。

## 公式データの再取得・変換

Python 3.13以上を推奨します。CDSの利用規約への同意と、公式手順による認証設定が必要です。`.cdsapirc` をプロジェクト直下に置くとダウンロードスクリプトが読み込みます。このファイルはGit管理対象外で、`static/` に置かないでください。

```sh
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements.txt
.venv/bin/python scripts/download_data.py
.venv/bin/python scripts/prepare_data.py data-source/C3S_GWSC_GLOBAL_MONTHLY_200204_202309_v1.0.nc
.venv/bin/python scripts/validate_data.py data-source/C3S_GWSC_GLOBAL_MONTHLY_200204_202309_v1.0.nc
.venv/bin/python -m unittest discover -s scripts -p 'test_*.py'
```

新バージョンへの更新時は `scripts/download_data.py` のCDSリクエストを公式API例に合わせ、取得したファイル名で変換・検証してください。来歴とSHA256は `static/data/manifest.json` に保存します。

- `cells.json`: 原本の配列順に対応した緯度・経度（経度は−180〜180°）
- `frames/YYYY-MM.bin.gz`: 月別。全格子の偏差、その後に不確実性
- `series/N.bin.gz`: 256格子ずつ。格子×全暦月の偏差、その後に不確実性
- バイナリ: little-endian Float32、欠測はNaN。各ファイルをgzip圧縮
- 全データ約184 MiB。ブラウザーは選んだ月と地点のファイルだけ取得

独立した `validate_data.py` は、全座標・全月・全格子の両変数を原本と照合し、月別と地点別の双方がFloat32精度で完全一致することを検査します。原本NetCDFと認証情報は公開しません。

## GitHub Pages

リポジトリの Settings → Pages → Source を **GitHub Actions** に設定します。`main` へのpushで `.github/workflows/deploy.yml` がPythonテスト、TypeScriptテスト、型検査、本番ビルドを実行し、`build/` を公開します。CDSキーをActionsに登録する必要はありません。
