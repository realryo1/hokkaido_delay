プロジェクトの概要・構成・仕様はREADME.mdを参照。ここには作業時のルールだけを書く。

全般
・文節に半角スペースを入れないこと。
・ドキュメント、コード、ユーザーの返答や希望の食い違いを見つけたら、どれかに寄せず、すべて挙げ、判断を待つ。
・pushしない。ユーザーがF5（.vscode/launch.jsonのDeploy）でまとめてpushする。
・サイト名や説明文を変えたら、website/index.htmlのtitle/metaも直す。

姉妹プロジェクト（sm27calendar）との関係
・リポジトリは分ける。sm27calendarのファイルを参照・読み込みしない（リンクは可）。デプロイはsm27calendarの.vscode/launch.jsonから一括でも行うので、tools/deploy-pages.mjsの場所と使い方を変えたら向こうも直す。
・デザインはsm27calendarとそろえる。website/base.cssの値を変えるときは、sm27calendarのwebsite/style.cssも同じにするよう、ユーザーに伝える。
・sm27calendarのofficial/（著作物）をこのリポジトリに持ち込まない。使ってよいのはカラーパレットと事実のみ。
・localStorageなどのキーはhokkaido-delay-で始める（同じrealryo1.github.ioのオリジンでカレンダーと共有されるため）。

運行情報（website/・worker/）
・実装と進捗はdocument/delayProgress.mdに書き、進めたら更新する。
・手元の確認でも事業者サイトから連続で取得しない。
・Cronの間隔を変えたらworker/src/index.jsのINTERVAL_MINも合わせる。
・ServiceWorkerやオフライン用のキャッシュは使わない（現時点ではキャッシュ禁止）。
