<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

import GalaxyCanvas from "./components/GalaxyCanvas.vue";
import { useAppState } from "./composables/useAppState";
import { ChannelGraph } from "./core/channelGraph";
import { calculateChannelLayout } from "./services/channelLayout";
import { EventStream } from "./services/eventStream";
import { audioManager } from "./audio/audioManager";

let stream: EventStream | undefined;
let pendingGraph: ChannelGraph | undefined;
let layoutGeneration = 0;
let mounted = false;
let backgroundTimer: ReturnType<typeof setInterval> | undefined;
let backgroundUpdatedAt = 0;

const {
    graph,
    connection,
    status,
    selectedId,
    activeOnly,
    eventCount,
    lastEvent,
    updatedAt,
    renderError,
    selected,
    connectionLabel,
    recordTrigger,
} = useAppState();

// audio settings
const muted = ref<boolean>(audioManager.muted);
const masterVolume = ref<number>(audioManager.masterVolume);
const bgmVolume = ref<number>(audioManager.bgmVolume);
const postVolume = ref<number>(audioManager.postVolume);
const moveVolume = ref<number>(audioManager.moveVolume);

// settings drawer
const settingsOpen = ref<boolean>(false);

function handleVisibilityChange(): void {
    if (document.hidden) {
        graph.value?.clearVisualEvents();
        backgroundUpdatedAt = performance.now();

        backgroundTimer = setInterval(() => {
            const now = performance.now();
            graph.value?.update((now - backgroundUpdatedAt) / 1000);
            backgroundUpdatedAt = now;
        }, 1000);

        return;
    }

    if (backgroundTimer) clearInterval(backgroundTimer);
    backgroundTimer = undefined;
    graph.value?.clearVisualEvents();
    graph.value?.requestSyncSnap();
}

function reloadPage(): void {
    window.location.reload();
}

function unlockAudio(): void {
    audioManager.unlock();
}

function openSettings(): void {
    audioManager.unlock({ startBgm: false });
    settingsOpen.value = true;
}

function closeSettings(): void {
    settingsOpen.value = false;
}

function changeMuted(event: Event): void {
    const target = event.target as HTMLInputElement;
    muted.value = target.checked;
    audioManager.setMuted(muted.value);
}

function changeMasterVolume(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = Number(target.value);

    masterVolume.value = value;
    audioManager.setMasterVolume(value);
}

function changeBgmVolume(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = Number(target.value);

    bgmVolume.value = value;
    audioManager.setBgmVolume(value);
}

function changePostVolume(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = Number(target.value);

    postVolume.value = value;
    audioManager.setPostVolume(value);
}

function changeMoveVolume(event: Event): void {
    const target = event.target as HTMLInputElement;
    const value = Number(target.value);

    moveVolume.value = value;
    audioManager.setMoveVolume(value);
}

function resetAudioSettings(): void {
    audioManager.resetSettings();

    muted.value = audioManager.muted;
    masterVolume.value = audioManager.masterVolume;
    bgmVolume.value = audioManager.bgmVolume;
    postVolume.value = audioManager.postVolume;
    moveVolume.value = audioManager.moveVolume;
}

function onPost(): void {
    audioManager.unlock({ startBgm: false });
    audioManager.playPost();
}

function onMove(): void {
    audioManager.unlock({ startBgm: false });
    audioManager.playMove();
}

onMounted(() => {
    mounted = true;
    document.addEventListener("visibilitychange", handleVisibilityChange);

    stream = new EventStream({
        demo: new URLSearchParams(location.search).get("demo") !== "0",

        onState(nextState, message) {
            connection.value = nextState;
            status.value = message;
        },

        async onInit(channels) {
            const generation = ++layoutGeneration;
            const nextGraph = new ChannelGraph(channels);

            pendingGraph = nextGraph;
            status.value = `${nextGraph.nodes.length.toLocaleString()}チャンネルを配置中`;

            nextGraph.updateVisibility(selectedId.value);

            const positions = await calculateChannelLayout(nextGraph.nodes);

            if (!mounted || generation !== layoutGeneration) return;

            nextGraph.applyLayout(positions, true);
            graph.value = nextGraph;
            pendingGraph = undefined;
            connection.value = "open";
            status.value = "デモストリーム受信中";
        },

        onTrigger(trigger) {
            (pendingGraph ?? graph.value)?.applyTrigger(trigger);
            recordTrigger(trigger);
        },

        onSync(payload) {
            (pendingGraph ?? graph.value)?.sync(payload.deltas);
            updatedAt.value = new Date(payload.ts * 1000).toLocaleTimeString(
                "ja-JP",
            );

            if (graph.value) {
                const changed = graph.value.updateVisibility(selectedId.value);

                if (changed) {
                    const generation = ++layoutGeneration;

                    calculateChannelLayout(graph.value.nodes).then(
                        positions => {
                            if (generation === layoutGeneration) {
                                graph.value?.applyLayout(positions);
                            }
                        },
                    );
                }
            }
        },

        onMalformedEvent(eventName) {
            status.value = `${eventName} イベントを解釈できませんでした`;
        },
    });

    stream.connect();
});

const focusId = ref<string | undefined>();

watch(selectedId, newId => {
    if (!graph.value) {
        focusId.value = newId;
        return;
    }

    const changed = graph.value.updateVisibility(newId);
    focusId.value = newId;

    if (changed) {
        const generation = ++layoutGeneration;

        calculateChannelLayout(graph.value.nodes).then(positions => {
            if (generation === layoutGeneration) {
                graph.value?.applyLayout(positions);
            }
        });
    }
});

onBeforeUnmount(() => {
    mounted = false;
    layoutGeneration += 1;
    stream?.disconnect();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    if (backgroundTimer) clearInterval(backgroundTimer);
});
</script>

<template>
    <main class="app-shell" @pointerdown.capture.once="unlockAudio">
        <button
            type="button"
            class="settingsButton"
            :aria-expanded="settingsOpen"
            aria-label="音声設定を開く"
            @click.stop="openSettings"
        >
            ⚙
        </button>

        <Transition name="settings-fade">
            <div
                v-if="settingsOpen"
                class="settingsBackdrop"
                @click="closeSettings"
            />
        </Transition>

        <Transition name="settings-slide">
            <aside
                v-if="settingsOpen"
                class="settingsDrawer"
                role="dialog"
                aria-modal="true"
                aria-label="音声設定"
                @pointerdown.stop
                @wheel.stop
                @click.stop
            >
                <header class="settingsHeader">
                    <div>
                        <p class="eyebrow">settings</p>
                        <h2>Sound</h2>
                    </div>

                    <button
                        type="button"
                        class="settingsClose"
                        aria-label="設定を閉じる"
                        @click="closeSettings"
                    >
                        ×
                    </button>
                </header>

                <section class="settingsGroup">
                    <label class="settingsToggle">
                        <input
                            type="checkbox"
                            :checked="muted"
                            @change="changeMuted"
                        />
                        <span>ミュート</span>
                    </label>
                </section>

                <section class="settingsGroup">
                    <h3>音量</h3>

                    <div class="volumeControl">
                        <div class="volumeLabel">
                            <label for="master-volume">全体音量</label>
                            <output>
                                {{ Math.round(masterVolume * 100) }}%
                            </output>
                        </div>
                        <input
                            id="master-volume"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            :value="masterVolume"
                            @input="changeMasterVolume"
                        />
                    </div>

                    <div class="volumeControl">
                        <div class="volumeLabel">
                            <label for="bgm-volume">BGM</label>
                            <output>
                                {{ Math.round(bgmVolume * 100) }}%
                            </output>
                        </div>
                        <input
                            id="bgm-volume"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            :value="bgmVolume"
                            @input="changeBgmVolume"
                        />
                    </div>

                    <div class="volumeControl">
                        <div class="volumeLabel">
                            <label for="post-volume">投稿音</label>
                            <output>
                                {{ Math.round(postVolume * 100) }}%
                            </output>
                        </div>
                        <input
                            id="post-volume"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            :value="postVolume"
                            @input="changePostVolume"
                        />
                    </div>

                    <div class="volumeControl">
                        <div class="volumeLabel">
                            <label for="move-volume">移動音</label>
                            <output>
                                {{ Math.round(moveVolume * 100) }}%
                            </output>
                        </div>
                        <input
                            id="move-volume"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            :value="moveVolume"
                            @input="changeMoveVolume"
                        />
                    </div>

                    <button
                        type="button"
                        class="resetSettingsButton"
                        @click="resetAudioSettings"
                    >
                        初期値に戻す
                    </button>
                </section>

                <section class="settingsGroup">
                    <h3>テスト再生</h3>
                    <div class="soundTestButtons">
                        <button type="button" @click="onPost">
                            投稿音
                        </button>
                        <button type="button" @click="onMove">
                            移動音
                        </button>
                    </div>
                </section>
            </aside>
        </Transition>

        <GalaxyCanvas
            v-if="graph"
            :graph="graph"
            :selected-id="selectedId"
            :focus-id="focusId"
            :active-only="activeOnly"
            @select="selectedId = $event"
            @render-error="renderError = $event"
        />

        <div v-else class="loading">
            <span class="loading__orbit" />
            <p>CHANNEL UNIVERSE を構築中</p>
        </div>

        <div v-if="renderError" class="render-error ui-panel">
            <p class="eyebrow">RENDERER ERROR</p>
            <strong>{{ renderError }}</strong>
            <button @click="reloadPage">再読み込み</button>
        </div>

        <header class="topbar ui-panel">
            <div>
                <p class="eyebrow">traQ ACTIVITY OBSERVATORY</p>
                <h1>Channel Universe</h1>
            </div>
            <div class="connection" :data-state="connection">
                <span class="connection__dot" />
                <div>
                    <strong>{{ connectionLabel }}</strong>
                    <small>{{ status }}</small>
                </div>
            </div>
        </header>

        <aside class="metrics ui-panel">
            <p class="eyebrow">STREAM OVERVIEW</p>
            <dl>
                <div>
                    <dt>CHANNELS</dt>
                    <dd>{{ graph?.nodes.length ?? "—" }}</dd>
                </div>
                <div>
                    <dt>IMPULSES</dt>
                    <dd>{{ eventCount }}</dd>
                </div>
            </dl>
            <div class="latest">
                <span>LAST SIGNAL</span>
                <strong>{{ lastEvent }}</strong>
                <time>{{ updatedAt || "—" }}</time>
            </div>
        </aside>

        <div class="display-controls ui-panel">
            <p class="eyebrow">DISPLAY</p>
            <button
                :class="{ active: !activeOnly }"
                @click="activeOnly = false"
            >
                ALL
            </button>
            <button
                :class="{ active: activeOnly }"
                @click="activeOnly = true"
            >
                ACTIVE
            </button>
        </div>

        <aside v-if="selected" class="details ui-panel">
            <button class="details__close" @click="selectedId = undefined">
                ×
            </button>
            <p class="eyebrow">SELECTED CHANNEL</p>
            <h2>{{ selected.name }}</h2>
            <p class="details__path">{{ selected.path }}</p>
            <dl>
                <div>
                    <dt>ACTIVITY</dt>
                    <dd>{{ selected.currentScore.toFixed(1) }}</dd>
                </div>
                <div>
                    <dt>DEPTH</dt>
                    <dd>{{ selected.depth }}</dd>
                </div>
                <div>
                    <dt>CHILDREN</dt>
                    <dd>{{ selected.children.length }}</dd>
                </div>
            </dl>
        </aside>

        <footer class="hint">
            <span>DRAG</span> 移動
            <span>SCROLL</span> 拡大・縮小
            <span>CLICK</span> 詳細
        </footer>
    </main>
</template>