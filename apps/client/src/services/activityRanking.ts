import { type ChannelNode, isActiveChannelNode } from "../core/channelGraph";

export interface ActivityChannel {
    id: string;
    name: string;
    heat: number;
    color: string;
}

export function rankActivityChannels(nodes: readonly ChannelNode[]): ActivityChannel[] {
    return nodes
        .filter(node => node.id !== "grand_root" && isActiveChannelNode(node))
        .toSorted(
            (left, right) =>
                right.relativeScore - left.relativeScore ||
                right.currentScore - left.currentScore ||
                left.name.localeCompare(right.name, undefined, {
                    numeric: true,
                    sensitivity: "base",
                })
        )
        .map(node => ({
            id: node.id,
            name: node.name,
            heat: Math.round(Math.min(1, Math.max(0, node.relativeScore)) * 100),
            color: node.color,
        }));
}
