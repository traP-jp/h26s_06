## Tools

### ローカル実行

```bash
bun dev
```

### モックサーバー

- `?demo=1` を付与してアクセスすると、traQ に接続せず、テスト用のデータを利用できる。

####　起動

```bash
bun mock:up
```

#### 停止

```bash
bun mock:down
```

### Cloud Run

production image は `$PORT` (default `5173`) で `dist` を配信する。
Cloud Run では `/api` を `http://localhost:8080` に転送する。
`GCLOUD_BACKEND_PROXY=false` を設定すると、この転送を無効化できる。
