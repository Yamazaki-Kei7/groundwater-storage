# 地下水貯留量WebGIS：調査記録

確認日：2026-10-28。初期調査と実装時の確認記録。

## 依頼された成果物

- GRACE / GRACE-FOに基づく地下水貯留量変化の3D WebGIS。
- MapLibre GL JS、deck.gl、SvelteKit 3、Tailwind CSSを使用。
- 2002年から提供元の最新月までの月別時系列を閲覧可能にする。
- GitHub Pagesで公開し、公開URLで動作を検証する。
- TypeScriptのany / unknown型と不要なclass定義を使用しない。
- ライブラリーの利用方法はContext7 MCPで確認する。

## 公式データの確認結果

対象：`satellite-groundwater-storage`、製品バージョンv1.0。

- カタログ公開・更新日：2026-10-27。
- 現在の提供期間：2002年4月～2023年9月。現在月までのデータは未提供。
- 変数：`gwsc`、`gwsc_uncertainty`。単位はいずれもmm。
- 値は2003年1月～2022年12月の平均に対する偏差。
- グリッドは0.5°、座標はセル中心。720経度×360緯度。
- 数値を持つ陸域セルは59,018。海域等はNaN。Greenland・Antarcticaは対象外。
- 名目グリッド間隔と実効空間解像度は異なる。実効解像度は約250～300 kmであり、細かいセルを独立した局地観測として説明しない。
- 全期間のNetCDF-4は約187.8 MB、ZIPで配布。
- ファイル名：`C3S_GWSC_GLOBAL_MONTHLY_200204_202309_v1.0.nc`。
- 配列次元：`(time, lat, lon)`。timeは`days since 2002-04-01`、standard calendar。
- 欠損値：NaNおよび`-9.e+33`。0と区別する。
- ライセンス：CC-BY-4.0。出典、製品バージョン、加工内容を表示する。
- 年次更新予定。ガイドではv2.0を2027年初め、2026年9月までの拡張として予定している。将来予定を取得済みデータと扱わない。

欠測月（公式Overviewより）：

| 年 | 月 |
| --- | --- |
| 2002 | 06, 07 |
| 2003 | 06 |
| 2011 | 01, 06 |
| 2012 | 05, 10 |
| 2013 | 03, 08, 09 |
| 2014 | 02, 07, 12 |
| 2015 | 06, 10, 11 |
| 2016 | 04, 09, 10 |
| 2017 | 02, 07, 08, 09, 10, 11, 12 |
| 2018 | 01, 02, 03, 04, 05, 08, 09 |

実際の変換時はNetCDFのtimeと有効値から観測月を確認し、欠測月を補間で埋めない。

CDSリクエストのフォーム定義：

```json
{
  "variable": ["gravity_based_groundwater_storage_change"],
  "version": ["v1_0"]
}
```

年・月の選択項目はなく、全期間を取得する形式。CDSの無料登録・ログインとライセンスの確認が必要。APIキー等の秘密情報はリポジトリや公開サイトに含めない。

## 環境確認

- 作業開始時のリポジトリは空で、コミット・remoteともになし。
- npm registryの`@sveltejs/kit` latestは3.1.0。要求されたメジャー3を利用可能。
- GitHub CLIはネットワーク許可後、Yamazaki-Kei7として認証済みであることを確認。
- ユーザーがプロジェクト直下に`.cdsapirc`を配置。Git管理対象外にし、内容を表示せずCDS APIで使用した。
- CDSライセンス同意後に取得成功。59,018格子・225観測月・258暦月を実データで確認。
- 原本SHA256：`8d8295dd65c99d5e18ab3f03fb49e0ff7fb285103c357d8528d95ee311e182ad`。
- GitHubリポジトリとPagesのActions公開設定を作成。公開の検証結果は検証記録に追記する。
- 公式ガイドのGFZ DOI `10.5880/GFZ.C3S_GWSC_v1.0`は確認時404。取得済みと扱わない。

## 承認された構成

GitHub Pagesの静的配信に合わせ、NetCDFを事前変換して月別に読み込む。MapLibre上にdeck.glで3D柱を重ね、増加を青、減少を橙、絶対値を柱の高さで表示。高さの誇張を明示する。月別スライダーと再生、セル選択による全期間グラフ、不確実性、欠測表示を組み合わせる。

選択地点の値も広域推定値として説明する。初期範囲は世界、地域プリセットで移動可能にする。細かいUIは実装時に決定する。

ユーザー回答：「この構成で進め、細部は任せる」。背景地図はAPIキー不要のOpenFreeMapを使用。MapLibre 6ではVite用のworker URLを明示し、SvelteKit 3ではVite内でadapter/base pathを設定した。

## 完了を証明するための確認項目

1. 公式実データを取得し、出典・バージョン・ハッシュを記録。
2. NetCDFと変換結果の座標、符号、値、不確実性、欠損、月数を照合。
3. SvelteKitメジャー3と必要ライブラリーの利用を確認。
4. 3D表示、月移動、再生、地点グラフ、欠測表示、スマートフォン表示を実ブラウザーで確認。
5. 型検査・適切な数値処理テスト・本番ビルドを実施。
6. GitHub Pagesサブパスでデータとアセットが正常に取得できることを確認。
7. GitHub Actionsの成功と公開URLでの動作を確認。

## 参照

- [CDS Overview](https://cds.climate.copernicus.eu/datasets/satellite-groundwater-storage?tab=overview)
- [カタログAPI](https://cds.climate.copernicus.eu/api/catalogue/v1/collections/satellite-groundwater-storage)
- [ECMWF告知](https://forum.ecmwf.int/t/new-dataset-published-in-cds-groundwater-storage-change-data-from-2002-to-present-derived-from-satellite-gravimetry-observations/15458)
- [公式製品ガイド](https://confluence.ecmwf.int/x/sA0nJw)
- [CDSダウンロード](https://cds.climate.copernicus.eu/datasets/satellite-groundwater-storage?tab=download)
- [SvelteKit静的アダプター](https://svelte.dev/docs/kit/adapter-static)（Context7 MCPで確認）
- [deck.gl ColumnLayer](https://deck.gl/docs/api-reference/layers/column-layer)（Context7 MCPで確認）
