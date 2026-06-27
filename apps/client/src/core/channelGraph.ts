import type { ChannelDictionary, TriggerPayload } from "../types/api";

const PALETTE = [
    "#00bfff",
    "#655cff",
    "#ec3fa5",
    "#ff633c",
    "#f4b400",
    "#20c878",
    "#168cff",
    "#a33ce8",
    "#e8f0ff",
];
export interface ChannelNode {
    index: number;
    id: string;
    name: string;
    parentId: string | null;
    children: number[];
    islandId: number;
    depth: number;
    currentScore: number;
    targetScore: number;
    x: number;
    y: number;
    z: number;
    color: string;
}

export type VisualEvent =
    | { type: "message"; channelId: string }
    | { type: "movement"; fromId?: string; toId: string };

export class ChannelGraph {
    readonly nodes: ChannelNode[];
    private readonly nodeMap = new Map<string, number>();
    private readonly visualEvents: VisualEvent[] = [];
    private snapNextSync = false;

    constructor(channels: ChannelDictionary) {
        const ordered = orderChannels(channels);
        this.nodes = ordered.map((channel, index) => {
            this.nodeMap.set(channel.id, index);
            return {
                index,
                id: channel.id,
                name: channel.name || channel.id,
                parentId: channel.parentId || null,
                children: [],
                islandId: channel.islandId ?? -1,
                depth: channel.depth ?? 0,
                currentScore: 0,
                targetScore: 0,
                x: 0,
                y: 0,
                z: 0,
                color:
                    channel.id === "grand_root"
                        ? "#ffffff"
                        : PALETTE[Math.max(0, channel.islandId ?? 0) % PALETTE.length]!,
            };
        });

        for (const channel of ordered) {
            const node = this.get(channel.id);
            if (!node) continue;
            node.children = channel.children
                ?.map(id => this.nodeMap.get(id))
                .filter((index): index is number => index !== undefined);
        }
    }

    get(id: string) {
        const index = this.nodeMap.get(id);
        return index === undefined ? undefined : this.nodes[index];
    }

    path(id: string) {
        const result: ChannelNode[] = [];
        let node = this.get(id);
        while (node) {
            result.unshift(node);
            node = node.parentId ? this.get(node.parentId) : undefined;
        }
        return result;
    }

    applyTrigger(trigger: TriggerPayload) {
        const id = trigger.type === "msg" ? trigger.ch : trigger.to;
        this.enqueueVisualEvent(
            trigger.type === "msg"
                ? { type: "message", channelId: trigger.ch }
                : { type: "movement", fromId: trigger.from, toId: trigger.to }
        );
        let node = this.get(id);
        let heat = trigger.type === "msg" ? 46 : 11;
        while (node) {
            node.currentScore = Math.min(100, node.currentScore + heat);
            node.targetScore = Math.max(node.targetScore, node.currentScore * 0.62);
            heat *= 0.45;
            node = node.parentId ? this.get(node.parentId) : undefined;
        }
    }

    sync(deltas: Record<string, number>) {
        for (const [id, score] of Object.entries(deltas)) {
            const node = this.get(id);
            if (!node) continue;
            node.targetScore = score;
            if (this.snapNextSync) node.currentScore = score;
        }
        this.snapNextSync = false;
    }

    requestSyncSnap() {
        this.snapNextSync = true;
    }

    takeVisualEvents() {
        return this.visualEvents.splice(0);
    }

    clearVisualEvents() {
        this.visualEvents.length = 0;
    }

    applyLayout(positions: Float32Array) {
        if (positions.length !== this.nodes.length * 3) {
            throw new Error("Layout position count does not match channel count");
        }
        for (const node of this.nodes) {
            const offset = node.index * 3;
            node.x = positions[offset] ?? 0;
            node.y = positions[offset + 1] ?? 0;
            node.z = positions[offset + 2] ?? 0;
        }
    }

    update(deltaSeconds: number) {
        const decay = Math.exp(-deltaSeconds / 24);
        const blend = 1 - Math.exp(-deltaSeconds * 3.5);
        for (const node of this.nodes) {
            node.currentScore *= decay;
            node.currentScore += (node.targetScore - node.currentScore) * blend;
            node.targetScore *= decay;
            if (node.currentScore < 0.01) node.currentScore = 0;
        }
    }

    private enqueueVisualEvent(event: VisualEvent) {
        if (this.visualEvents.length >= 128) this.visualEvents.shift();
        this.visualEvents.push(event);
    }
}

function orderChannels(channels: ChannelDictionary) {
    const ordered: import("../types/api").InitChannel[] = [];
    const visited = new Set<string>();
    const visit = (id: string) => {
        const channel = channels[id];
        if (!channel || visited.has(id)) return;
        visited.add(id);
        ordered.push(channel);
        channel.children.forEach(visit);
    };
    visit("grand_root");
    Object.keys(channels).forEach(visit);
    return ordered;
}
