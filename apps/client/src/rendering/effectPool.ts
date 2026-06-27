import {
    AdditiveBlending,
    BufferGeometry,
    Color,
    DoubleSide,
    Float32BufferAttribute,
    Line,
    LineBasicMaterial,
    Mesh,
    MeshBasicMaterial,
    RingGeometry,
    Scene,
    SphereGeometry,
    Vector3,
} from "three";

import type { ChannelGraph, ChannelNode, VisualEvent } from "../core/channelGraph";

interface TimedEffect {
    active: boolean;
    startedAt: number;
    duration: number;
    delay: number;
}

interface RippleEffect extends TimedEffect {
    mesh: Mesh<RingGeometry, MeshBasicMaterial>;
    baseScale: number;
}

interface BeamEffect extends TimedEffect {
    line: Line<BufferGeometry, LineBasicMaterial>;
    from: Vector3;
    to: Vector3;
}

interface PulseEffect extends TimedEffect {
    mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
    points: Vector3[];
}

const RIPPLE_COUNT = 48;
const BEAM_COUNT = 32;
const PULSE_COUNT = 20;
const BEAM_VERTEX_COUNT = 18;
const BEAM_TRAIL_PROGRESS = 0.24;

export class EffectPool {
    private readonly ripples: RippleEffect[];
    private readonly beams: BeamEffect[];
    private readonly pulses: PulseEffect[];

    constructor(
        private readonly scene: Scene,
        private readonly graph: ChannelGraph
    ) {
        this.ripples = Array.from({ length: RIPPLE_COUNT }, () => createRipple(scene));
        this.beams = Array.from({ length: BEAM_COUNT }, () => createBeam(scene));
        this.pulses = Array.from({ length: PULSE_COUNT }, () => createPulse(scene));
    }

    play(event: VisualEvent, now: number) {
        if (event.type === "message") {
            this.playMessage(event.channelId, now);
        } else {
            this.playMovement(event.fromId, event.toId, now);
        }
    }

    update(now: number) {
        this.updateRipples(now);
        this.updateBeams(now);
        this.updatePulses(now);
    }

    clear() {
        for (const ripple of this.ripples) {
            ripple.active = false;
            ripple.mesh.visible = false;
        }
        for (const beam of this.beams) {
            beam.active = false;
            beam.line.visible = false;
        }
        for (const pulse of this.pulses) {
            pulse.active = false;
            pulse.mesh.visible = false;
        }
    }

    dispose() {
        this.clear();
        for (const ripple of this.ripples) {
            this.scene.remove(ripple.mesh);
            ripple.mesh.geometry.dispose();
            ripple.mesh.material.dispose();
        }
        for (const beam of this.beams) {
            this.scene.remove(beam.line);
            beam.line.geometry.dispose();
            beam.line.material.dispose();
        }
        for (const pulse of this.pulses) {
            this.scene.remove(pulse.mesh);
            pulse.mesh.geometry.dispose();
            pulse.mesh.material.dispose();
        }
    }

    private playMessage(channelId: string, now: number) {
        const path = this.graph.path(channelId);
        if (path.length === 0) return;
        const points = path.map(nodePosition);
        const pulse = acquire(this.pulses);
        pulse.active = true;
        pulse.startedAt = now;
        pulse.duration = Math.max(420, points.length * 150);
        pulse.delay = 0;
        pulse.points = points;
        pulse.mesh.material.color.set(path.at(-1)?.color ?? "#ffffff");
        pulse.mesh.visible = true;

        [...path].reverse().forEach((node, index) => {
            const ripple = acquire(this.ripples);
            ripple.active = true;
            ripple.startedAt = now;
            ripple.duration = 720;
            ripple.delay = pulse.duration + index * 115;
            ripple.baseScale = node.depth <= 1 ? 7 : 4.5;
            ripple.mesh.position.copy(nodePosition(node));
            ripple.mesh.material.color.set(node.color);
            ripple.mesh.visible = false;
        });
    }

    private playMovement(fromId: string | undefined, toId: string, now: number) {
        if (!fromId) return;
        const from = this.graph.get(fromId);
        const to = this.graph.get(toId);
        if (!from || !to) return;
        const beam = acquire(this.beams);
        beam.from.set(from.x, from.y, from.z);
        beam.to.set(to.x, to.y, to.z);
        setBeamColors(beam, to.color);
        beam.active = true;
        beam.startedAt = now;
        beam.duration = Math.min(1000, Math.max(420, 360 + beam.from.distanceTo(beam.to) * 1.2));
        beam.delay = 0;
        beam.line.visible = true;
    }

    private updateRipples(now: number) {
        for (const ripple of this.ripples) {
            if (!ripple.active) continue;
            const progress = (now - ripple.startedAt - ripple.delay) / ripple.duration;
            if (progress < 0) continue;
            if (progress >= 1) {
                ripple.active = false;
                ripple.mesh.visible = false;
                continue;
            }
            ripple.mesh.visible = true;
            const scale = ripple.baseScale * (0.25 + progress * 2.8);
            ripple.mesh.scale.setScalar(scale);
            ripple.mesh.material.opacity = (1 - progress) * 0.72;
        }
    }

    private updateBeams(now: number) {
        for (const beam of this.beams) {
            if (!beam.active) continue;
            const progress = (now - beam.startedAt - beam.delay) / beam.duration;
            if (progress >= 1) {
                beam.active = false;
                beam.line.visible = false;
                continue;
            }
            const travel = Math.max(0, progress) * (1 + BEAM_TRAIL_PROGRESS);
            const head = Math.min(1, travel);
            const tail = Math.max(0, travel - BEAM_TRAIL_PROGRESS);
            const position = beam.line.geometry.getAttribute("position");
            for (let index = 0; index < BEAM_VERTEX_COUNT; index += 1) {
                const ratio = index / (BEAM_VERTEX_COUNT - 1);
                const point = tail + (head - tail) * ratio;
                position.setXYZ(
                    index,
                    beam.from.x + (beam.to.x - beam.from.x) * point,
                    beam.from.y + (beam.to.y - beam.from.y) * point,
                    beam.from.z + (beam.to.z - beam.from.z) * point
                );
            }
            position.needsUpdate = true;
            const fadeIn = Math.min(1, progress / 0.08);
            const fadeOut = Math.min(1, (1 - progress) / 0.12);
            beam.line.material.opacity = Math.min(fadeIn, fadeOut);
        }
    }

    private updatePulses(now: number) {
        for (const pulse of this.pulses) {
            if (!pulse.active) continue;
            const progress = (now - pulse.startedAt - pulse.delay) / pulse.duration;
            if (progress >= 1) {
                pulse.active = false;
                pulse.mesh.visible = false;
                continue;
            }
            setPositionAlongPath(pulse.mesh.position, pulse.points, Math.max(0, progress));
            pulse.mesh.material.opacity = Math.sin(Math.max(0, progress) * Math.PI);
        }
    }
}

function createRipple(scene: Scene): RippleEffect {
    const mesh = new Mesh(
        new RingGeometry(0.78, 1, 32),
        new MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            blending: AdditiveBlending,
            depthWrite: false,
            side: DoubleSide,
            toneMapped: false,
        })
    );
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, active: false, startedAt: 0, duration: 0, delay: 0, baseScale: 1 };
}

function createBeam(scene: Scene): BeamEffect {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
        "position",
        new Float32BufferAttribute(new Float32Array(BEAM_VERTEX_COUNT * 3), 3)
    );
    geometry.setAttribute(
        "color",
        new Float32BufferAttribute(new Float32Array(BEAM_VERTEX_COUNT * 3), 3)
    );
    const line = new Line(
        geometry,
        new LineBasicMaterial({
            color: new Color("#ffffff"),
            vertexColors: true,
            transparent: true,
            opacity: 0,
            blending: AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
        })
    );
    line.visible = false;
    scene.add(line);
    return {
        line,
        from: new Vector3(),
        to: new Vector3(),
        active: false,
        startedAt: 0,
        duration: 0,
        delay: 0,
    };
}

function createPulse(scene: Scene): PulseEffect {
    const mesh = new Mesh(
        new SphereGeometry(2.2, 8, 6),
        new MeshBasicMaterial({
            color: new Color("#ffffff"),
            transparent: true,
            opacity: 0,
            blending: AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
        })
    );
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, points: [], active: false, startedAt: 0, duration: 0, delay: 0 };
}

function acquire<T extends TimedEffect>(pool: T[]) {
    return pool.find(effect => !effect.active) ?? pool[0]!;
}

function setBeamColors(beam: BeamEffect, hex: string) {
    const color = new Color(hex);
    const colors = beam.line.geometry.getAttribute("color");
    for (let index = 0; index < BEAM_VERTEX_COUNT; index += 1) {
        const intensity = (index / (BEAM_VERTEX_COUNT - 1)) ** 2;
        colors.setXYZ(index, color.r * intensity, color.g * intensity, color.b * intensity);
    }
    colors.needsUpdate = true;
}

function nodePosition(node: ChannelNode) {
    return new Vector3(node.x, node.y, node.z);
}

function setPositionAlongPath(target: Vector3, points: Vector3[], progress: number) {
    if (points.length === 0) return;
    if (points.length === 1) {
        target.copy(points[0]!);
        return;
    }
    const scaled = progress * (points.length - 1);
    const index = Math.min(points.length - 2, Math.floor(scaled));
    target.lerpVectors(points[index]!, points[index + 1]!, scaled - index);
}
