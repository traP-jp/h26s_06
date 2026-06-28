import { describe, expect, test } from "bun:test";

import { ChannelGraph } from "../src/core/channelGraph";
import { NodeBuffer } from "../src/core/nodeBuffer";
import type { ChannelDictionary } from "../src/types/api";

function createGraph() {
    const channels: ChannelDictionary = {
        grand_root: {
            id: "grand_root",
            parentId: "",
            children: ["inactive"],
            depth: 0,
            islandId: -1,
        },
        inactive: {
            id: "inactive",
            parentId: "grand_root",
            children: [],
            depth: 1,
            islandId: 0,
        },
    };
    const graph = new ChannelGraph(channels);
    for (const node of graph.nodes) {
        node.isLayoutActive = true;
        node.visibilityAlpha = 1;
    }
    return graph;
}

describe("NodeBuffer active filter transition", () => {
    test("fades an inactive node out when switching to active display", () => {
        const graph = createGraph();
        const buffer = new NodeBuffer(graph.nodes.length);
        const inactive = graph.get("inactive")!;

        buffer.update(graph.nodes, 0, undefined, false);
        buffer.update(graph.nodes, 16, undefined, true);

        expect(buffer.filterVisibilityAt(inactive.index)).toBeGreaterThan(0);
        expect(buffer.filterVisibilityAt(inactive.index)).toBeLessThan(1);
    });

    test("fades an inactive node in when leaving active display", () => {
        const graph = createGraph();
        const buffer = new NodeBuffer(graph.nodes.length);
        const inactive = graph.get("inactive")!;

        buffer.update(graph.nodes, 0, undefined, true);
        buffer.update(graph.nodes, 16, undefined, false);

        expect(buffer.filterVisibilityAt(inactive.index)).toBeGreaterThan(0);
        expect(buffer.filterVisibilityAt(inactive.index)).toBeLessThan(1);
    });
});
