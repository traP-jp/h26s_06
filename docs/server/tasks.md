# タスク【バックエンド】


## プロジェクト基盤の構築と外部連携

まずは外部システム（traQ）からリアルタイムにデータを受け取り、メモリ上に静的なツリー構造を作り上げる土台のフェーズです。

* 1: 環境変数（traQのAPIトークン、ポート番号など）のロード機構の実装。


### traQ APIクライアントの構築
* 2: 起動時にtraQ APIを叩き、全チャンネル情報（約7000件）を取得する処理の実装。
* 3: WebSocketに接続し、`MessageCreated`（投稿）などのリアルタイムイベントを受信するリスナーの構築。


### Grand Rootツリーの初期構築とJSONキャッシュ
* 4: 取得したチャンネル情報を `GrandRootID` を頂点とする単一のフラットマップ構造にマッピング。
* 5: 構築完了後、フロントエンドへ渡すための `init` ペイロードを一度だけJSONシリアライズし、メモリ上に `[]byte` としてキャッシュする処理の実装。

```json
event: init
data: {
  "channels": {
    "grand_root": { "id": "grand_root", "parentId": "", "children": ["root_ch_1", "root_ch_2"] },
    "root_ch_1": { "id": "root_ch_1", "parentId": "grand_root", "children": ["sub_ch_10"] }
  }
}

```


### `StateManager` の実装
* 6: `channels` マップと `users` マップ、および全体を保護する `sync.RWMutex` の組み込み。


### ユーザー状態と「移動検知」ロジックの構築
* 7: traQからのイベントを解析し、ユーザーの現在の閲覧チャンネルとメモリ上の `CurrentChannel` を比較する処理の実装。
* 8: 変化があった場合にのみ、「どこからどこへ移動したか（`from`, `to`）」の差分データを抽出して内部キューに送るロジックの完成。

```go
// システム全体の根となる仮想ID
const GrandRootID = "grand_root"

// Channel: 各チャンネルの静的情報と動的スコアを管理
type Channel struct {
	ID            string
	ParentID      string   // 最上位ノードは GrandRootID を指す
	Children      []string // 子チャンネルIDのリスト
	Score         float64  // バックエンド側が持つ「正解の盛り上がり度」
	LastSyncScore float64  // 前回フロントへ送信した時点のスコア
	LastSyncTime  time.Time// 前回フロントへ送信した時刻
}

// UserState: ユーザーの現在位置を管理（ビームのアニメーション計算用）
type UserState struct {
	UserID         string
	CurrentChannel string    // 現在閲覧中のチャンネルID
	LastUpdated    time.Time // 最終更新日時
}

// StateManager: システム全体の状態をスレッドセーフに管理
type StateManager struct {
	mu       sync.RWMutex
	channels map[string]*Channel
	users    map[string]*UserState
}

```


### ボット除外フィルターの適用
* 9: 投稿イベントがボットによるものか判定し、不要な処理をスキップする軽量なフィルタリングの実装。

### 監視対象の運用
* 10: 認証した人が閲覧してるチャンネルと閲覧している人を取得する
* 11: 上で監視していないチャンネルのうち、盛り上がり度の上位を確率が高いように、いくつかを監視対象にする
* 12: 前回監視対象に入ってから時間が経てば経つほど、監視対象に入れる確率を高くする

##  SSE配信エンジンとリソース保護

構築したインメモリ状態を、最大700人のクライアントへリアルタイムかつ安全にストリーミングするフェーズです。

### セマフォ制御付きSSEハンドラーの実装
* 13: `text/event-stream` のエンドポイント作成。
* 14: 150MBのメモリスパイクを防ぐため、`maxConcurrentInits`（例: 10）を設定したチャネルによるセマフォ制御を導入し、キャッシュ済み `init` JSONを安全に書き込む処理の実装。


### クライアント接続プールとブロードキャスターの実装
* 15: 接続中の全クライアントのGoチャネルを管理するプールの作成。
* 16: 切断検知時にリソースを安全に解放するリーク防止機構の実装。


### インパルス（`trigger`）配信の統合
* 17: フェーズ2で構築した「投稿」と「移動」のイベント発生時に、最小限のペイロード（`msg`, `mov`）を即座にシリアライズして全クライアントへブロードキャストする処理の連携。

```json
event: trigger
data: {"type": "msg", "ch": "sub_ch_10"}

```

**移動 (ChannelWatched) 時:**

```json
event: trigger
data: {"type": "mov", "usr": "user_hash_123", "from": "sub_ch_10", "to": "sub_ch_11"}

```



##  確率的同期ロジックとパフォーマンス最適化

システムの整合性を保つためのスコア同期アルゴリズムと、非機能要件（150MB・60fpsの支援）を満たすための最終調整フェーズです。

### 確率的同期タスク（Ticker）の実装
* 18: 30秒ごとに動作する `time.Ticker` ループの作成。
* 19: 乱数判定をクリアしたチャンネルのみを抽出し、`sync` ペイロードとして配信するロジックの完成。

* * 30秒ごとのTicker処理において、各チャンネルが `sync` ペイロードに含まれる確率 $P$ を以下の数式で算出する。

$$P = \min\left(1.0, \alpha \times |\Delta S| + \beta \times \Delta T\right)$$

* * $\Delta S$: 前回同期時からのスコア変化量 (`math.Abs(Score - LastSyncScore)`)
* * $\Delta T$: 前回同期時からの経過時間（秒）
* * $\alpha, \beta$: 確率を調整する重み係数

```go
func generateSyncPayload() {
	now := time.Now()
	deltas := make(map[string]float64)

	for _, ch := range sm.channels {
		deltaS := math.Abs(ch.Score - ch.LastSyncScore)
		deltaT := now.Sub(ch.LastSyncTime).Seconds()

		prob := (alpha * deltaS) + (beta * deltaT)

		if rand.Float64() < prob {
			deltas[ch.ID] = ch.Score
			ch.LastSyncScore = ch.Score
			ch.LastSyncTime = now
		}
	}
	// deltas を送信キューへ投入
}

```

### スコア加算・自律減衰ロジックの仮実装
* 20: バックエンド側で正解となるスコアを加算・時間減衰させる数式を組み込み、同期データに「動き」を持たせる（※具体的な数式は別途定義）。


### メモリプロファイリング（pprof）と限界負荷試験
* 21: `net/http/pprof` を組み込み、ダミーの700クライアントを接続させ、秒間数十件のイベントを強制発生させる高負荷テストの実施。
* 22: ヒープメモリの消費が150MB以内に収まっていることを確認し、必要に応じてGCパラメータやバッファサイズの微調整を行う。