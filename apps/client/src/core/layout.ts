import {
    forceCollide,
    forceLink,
    forceManyBody,
    forceSimulation,
    forceX,
    forceY,
    forceZ,
} from "d3-force-3d";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force-3d";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const POSITION_COMPONENTS = 3;

export interface LayoutNode {
    index: number;
    parentIndex: number;
    children: number[];
    depth: number;
    islandId: number;
}

interface ForceNode extends SimulationNodeDatum {
    id: number;
    depth: number;
    islandId: number;
}

interface ForceLinkDatum extends SimulationLinkDatum<ForceNode> {
    desiredDistance: number;
}

export function calculateLayout(nodes: LayoutNode[]) {
    const positions = new Float32Array(nodes.length * POSITION_COMPONENTS);
    if (nodes.length === 0) return positions;

    const subtreeSizes = calculateSubtreeSizes(nodes);
    const grandRoot = nodes.find(node => node.parentIndex < 0) ?? nodes[0]!;
    const roots = grandRoot.children
        .map(index => nodes[index])
        .filter((node): node is LayoutNode => node !== undefined);

    placeIslandRoots(roots, subtreeSizes, positions);
    placeDescendants(nodes, roots, subtreeSizes, positions);
    runForceSimulation(nodes, roots, positions);
    return positions;
}

function calculateSubtreeSizes(nodes: LayoutNode[]) {
    const sizes = new Uint32Array(nodes.length);
    sizes.fill(1);
    const ordered = [...nodes].sort((left, right) => right.depth - left.depth);
    for (const node of ordered) {
        if (node.parentIndex >= 0) {
            sizes[node.parentIndex] = (sizes[node.parentIndex] ?? 1) + (sizes[node.index] ?? 1);
        }
    }
    return sizes;
}

function placeIslandRoots(roots: LayoutNode[], subtreeSizes: Uint32Array, positions: Float32Array) {
    const clusterRadii = roots.map(root => 46 + Math.sqrt(subtreeSizes[root.index] ?? 1) * 5.2);
    const circumference = clusterRadii.reduce((total, radius) => total + radius * 2 + 36, 0);
    const ringRadius = Math.max(150, circumference / (Math.PI * 2));
    let angleCursor = -0.45;
    roots.forEach((root, index) => {
        const clusterRadius = clusterRadii[index] ?? 46;
        const angularSpan = (clusterRadius * 2 + 36) / ringRadius;
        const angle = angleCursor + angularSpan / 2;
        const radialJitter = (index % 2) * Math.min(45, clusterRadius * 0.18);
        setPosition(
            positions,
            root.index,
            Math.cos(angle) * (ringRadius + radialJitter),
            Math.sin(angle) * (ringRadius + radialJitter) * 0.82,
            Math.sin(angle * 1.7) * Math.min(95, clusterRadius * 0.55)
        );
        angleCursor += angularSpan;
    });
}

function placeDescendants(
    nodes: LayoutNode[],
    roots: LayoutNode[],
    subtreeSizes: Uint32Array,
    positions: Float32Array
) {
    const queue = [...roots];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const parent = queue[cursor];
        if (!parent || parent.children.length === 0) continue;
        const parentPosition = readPosition(positions, parent.index);
        const count = parent.children.length;
        const depthScale = Math.max(0.42, 0.82 ** Math.max(0, parent.depth - 1));
        const spread = (34 + Math.sqrt(count) * 10) * depthScale;

        parent.children.forEach((childIndex, siblingIndex) => {
            const child = nodes[childIndex];
            if (!child) return;
            const angle =
                siblingIndex * GOLDEN_ANGLE + parent.index * 0.731 + child.islandId * 0.37;
            const diskRadius =
                spread *
                Math.sqrt((siblingIndex + 0.72) / Math.max(1, count)) *
                (0.86 + deterministicNoise(child.index) * 0.28);
            const subtreeLift = Math.log2(subtreeSizes[child.index] ?? 1) * 1.8;
            setPosition(
                positions,
                child.index,
                parentPosition.x + Math.cos(angle) * diskRadius,
                parentPosition.y + Math.sin(angle) * diskRadius * 0.82,
                parentPosition.z +
                    Math.sin(angle * 1.43 + child.depth) * diskRadius * 0.34 +
                    subtreeLift
            );
            queue.push(child);
        });
    }
}

function runForceSimulation(nodes: LayoutNode[], roots: LayoutNode[], positions: Float32Array) {
    const simulationTicks = Math.max(
        12,
        Math.min(80, Math.round(900 / Math.sqrt(Math.max(1, nodes.length))))
    );
    const islandCenters = new Map(
        roots.map(root => [root.islandId, readPosition(positions, root.index)])
    );
    const forceNodes: ForceNode[] = nodes.map(node => {
        const position = readPosition(positions, node.index);
        const isGrandRoot = node.parentIndex < 0;
        return {
            id: node.index,
            depth: node.depth,
            islandId: node.islandId,
            x: position.x,
            y: position.y,
            z: position.z,
            fx: isGrandRoot ? 0 : null,
            fy: isGrandRoot ? 0 : null,
            fz: isGrandRoot ? 0 : null,
        };
    });
    const links: ForceLinkDatum[] = nodes.flatMap(node =>
        node.children.map(childIndex => {
            const source = readPosition(positions, node.index);
            const target = readPosition(positions, childIndex);
            return {
                source: node.index,
                target: childIndex,
                desiredDistance:
                    node.parentIndex < 0
                        ? Math.hypot(target.x - source.x, target.y - source.y, target.z - source.z)
                        : Math.max(8, 26 * 0.8 ** Math.max(0, node.depth - 1)),
            };
        })
    );

    const centerFor = (node: ForceNode) => islandCenters.get(node.islandId) ?? { x: 0, y: 0, z: 0 };
    const islandStrength = (node: ForceNode) => (node.depth <= 1 ? 0.24 : 0.028);

    const simulation = forceSimulation(forceNodes, 3)
        .force(
            "link",
            forceLink<ForceNode, ForceLinkDatum>(links)
                .id(node => node.id)
                .distance(link => link.desiredDistance)
                .strength(link => ((link.source as ForceNode).depth === 0 ? 0.9 : 0.52))
                .iterations(1)
        )
        .force(
            "charge",
            forceManyBody<ForceNode>()
                .strength(node => (node.depth <= 1 ? -150 : node.depth === 2 ? -38 : -9))
                .distanceMax(130)
                .theta(1.1)
        )
        .force(
            "collide",
            forceCollide<ForceNode>()
                .radius(node => (node.depth <= 1 ? 11 : node.depth === 2 ? 5.5 : 2.4))
                .strength(0.88)
                .iterations(1)
        )
        .force("island-x", forceX<ForceNode>(node => centerFor(node).x).strength(islandStrength))
        .force("island-y", forceY<ForceNode>(node => centerFor(node).y).strength(islandStrength))
        .force("island-z", forceZ<ForceNode>(node => centerFor(node).z).strength(islandStrength))
        .alpha(1)
        .alphaDecay(1 - 0.001 ** (1 / simulationTicks))
        .velocityDecay(0.38)
        .stop();

    simulation.tick(simulationTicks);
    for (const node of forceNodes) {
        setPosition(positions, node.id, node.x ?? 0, node.y ?? 0, node.z ?? 0);
    }
}

function deterministicNoise(index: number) {
    const value = Math.sin(index * 12.9898 + 78.233) * 43_758.5453;
    return value - Math.floor(value);
}

function setPosition(positions: Float32Array, index: number, x: number, y: number, z: number) {
    const offset = index * POSITION_COMPONENTS;
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
}

function readPosition(positions: Float32Array, index: number) {
    const offset = index * POSITION_COMPONENTS;
    return {
        x: positions[offset] ?? 0,
        y: positions[offset + 1] ?? 0,
        z: positions[offset + 2] ?? 0,
    };
}
