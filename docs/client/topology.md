# 3Dトポロジー配置アルゴリズム設計

チャンネルを3D空間（X, Y, Z）に重なりを抑えつつ配置するための、事前計算アルゴリズムの設計である。この計算は初期化時、またはWeb Workerで一度だけ実行し、結果を `NodeBuffer` の初期値として格納する。

## 1. 配置の基本方針

### 単一ツリー・アプローチ

全体の中心である原点に、すべての島を束ねる `Grand Root`（大元のルートノード、灰色）が存在すると仮定し、全チャンネルを1本の巨大なツリーとして扱う。

### 階層ごとの役割

- `depth = 0`（Grand Root）
  - 空間の中心 `(0, 0, 0)` に配置する。
  - 色はニュートラルな灰色にする。
- `depth = 1`（Island Roots）
  - Grand Root の直接の子として、9つのルートチャンネルを大きく広げる。
  - 各島固有のテーマカラーを持たせる。
- `depth >= 2`（Child Nodes）
  - 各島の中で、さらに子・孫チャンネルが螺旋状に展開する。

### 共通アルゴリズム

すべての階層で共通の「黄金角（約137.5度）を用いた再帰的な螺旋配置アルゴリズム」を適用する。階層（`depth`）に応じたパラメータだけを調整することで、宇宙空間のような美しいクラスターを形成する。

## 2. 制御パラメータと自然な揺らぎ

深さ（`depth`）に応じて、親から子への距離と広がりの角度を調整する。さらに、リロードのたびに異なる有機的な形状を生成するため、配置にランダムな揺らぎ（ジッター）を導入する。

### `distance`

親から子への基本距離である。

- `depth === 0`（Grand Root → 島）
  - 最も長く取る。例として `1000` を使う。
- `depth >= 1`（島 → 子）
  - 深くなるにつれて短くする。
- 揺らぎ
  - 各ノードの実際の距離には、基本距離に対して ±10% 程度のランダムなノイズを掛け合わせる。

### `maxSpreadAngle`

子ノードが広がる円錐の角度である。

- `depth === 0`
  - ほぼ球状（180度 = `π`）に設定する。
- `depth >= 1`
  - 階層が深くなるほど角度を狭める。

### `randomAngleOffset`

親が子を配置し始める「最初の角度」である。これを親ごとにランダムな値（0〜`2π`）にすることで、リロードのたびに枝の伸びる方向が回転し、全体のシルエットが毎回変化する。

## 3. ツリー階層の3D展開

ある親ノードから「外側に向かうベクトル」を軸として、子ノードたちを螺旋状に配置する。黄金角と揺らぎを組み合わせることで、規則性と有機性を両立する。

### 擬似コード

```ts
// 黄金角 (ラジアン) = π * (3 - √5)
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * 再帰的にノードの3D座標を決定する
 * 最初の呼び出し: placeNodesRecursively(grandRootNode, new THREE.Vector3(0,0,0), new THREE.Vector3(0,1,0))
 * @param node 現在のノード
 * @param currentPos 現在のノードの3D座標 (Vector3)
 * @param outwardDir 原点から外へ向かう基準ベクトル (Vector3)
 */
function placeNodesRecursively(node: ChannelNode, currentPos: THREE.Vector3, outwardDir: THREE.Vector3) {

  // バッファ層に座標を保存
  nodeBuffer.setPosition(node.index, currentPos.x, currentPos.y, currentPos.z);

  const childrenCount = node.children.length;
  if (childrenCount === 0) return;

  // --- 階層(depth)に応じたパラメータの動的調整 ---
  let baseDistance: number;
  let maxSpreadAngle: number;

  if (node.depth === 0) {
    // Grand Root -> 9つの島への展開
    baseDistance = 1000;
    maxSpreadAngle = Math.PI * 0.9; // ほぼ全方位(球状)に展開
  } else {
    // 島内部での展開
    baseDistance = 300 * Math.pow(0.75, node.depth - 1);
    maxSpreadAngle = Math.PI * 0.8 * Math.pow(0.8, node.depth - 1);
  }

  // --- リロードのたびに形を変えるためのランダムオフセット ---
  // 親ごとに枝の開始角度をランダムに回転させる
  const randomAngleOffset = Math.random() * Math.PI * 2;

  // --- 子ノードの配置ループ ---
  for (let i = 0; i < childrenCount; i++) {
    const childIndex = node.children[i];
    const childNode = channelGraph.nodes[childIndex];

    // 1. Z軸上の分布割合 (1.0 = 中心軸, 0.0 = 外縁)
    const zDistribution = 1 - (i / (childrenCount - 1 || 1)) * (1 - Math.cos(maxSpreadAngle));

    // 2. 角度(アジマス角)の計算 (黄金角 + ランダムな開始角度)
    const theta = i * GOLDEN_ANGLE + randomAngleOffset;

    // 3. ローカル座標の計算 (outwardDirをZ軸とした場合の球面上の点)
    const radius = Math.sqrt(1 - zDistribution * zDistribution);
    const localX = Math.cos(theta) * radius;
    const localY = Math.sin(theta) * radius;
    const localZ = zDistribution;

    let localDir = new THREE.Vector3(localX, localY, localZ);

    // 4. ローカル方向ベクトルを、outwardDir が向く方向へ回転
    const defaultZ = new THREE.Vector3(0, 0, 1);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(defaultZ, outwardDir.clone().normalize());
    localDir.applyQuaternion(quaternion);

    // 5. 距離に自然な揺らぎ（±10%程度のジッター）を加える
    const jitteredDistance = baseDistance * (0.9 + Math.random() * 0.2);

    // 6. 最終的な子ノードの座標 = 親座標 + (方向 * 距離)
    const childPos = currentPos.clone().add(localDir.multiplyScalar(jitteredDistance));

    // 7. 新しい外側ベクトル（親から子へのベクトル）を計算し、再帰
    const newOutwardDir = childPos.clone().sub(currentPos).normalize();
    placeNodesRecursively(childNode, childPos, newOutwardDir);
  }
}
```

## 4. このアルゴリズムの利点
        
### 一期一会のビジュアル体験

親ごとに螺旋の開始角度（`randomAngleOffset`）をランダム化し、ノード間の距離に揺らぎ（`jitteredDistance`）を加えることで、黄金角の数学的な美しさを保ちながらも、リロードするたびに全く異なる有機的な星雲の形状が生成される。

### 完全な再帰構造によるコードのシンプル化

マクロ（島）とミクロ（枝）の配置ロジックを統合することで、コードがシンプルになり、メンテナンス性が向上する。

### 動的パラメータによる表現力

`depth` に応じたパラメータの調整だけで、「全体は大きく広がり、末端は小枝のように密集する」というフラクタルな宇宙の木構造が自然に形成される。
