import { $ } from "bun";

const mode = process.argv[2];

async function runParallel(tasks: { name: string; run: () => ReturnType<typeof $> }[]) {
    // Start all tasks concurrently, capturing their outputs
    const promises = tasks.map(task => {
        const promise = task.run().quiet();
        return { name: task.name, promise };
    });

    let failed = false;

    for (const { name, promise } of promises) {
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        let exitCode = 0;

        try {
            const res = await promise;
            stdout = Buffer.from(res.stdout);
            stderr = Buffer.from(res.stderr);
        } catch (error) {
            const error_ = error as { stdout?: Buffer; stderr?: Buffer; exitCode?: number };
            stdout = Buffer.from(error_.stdout || Buffer.alloc(0));
            stderr = Buffer.from(error_.stderr || Buffer.alloc(0));
            exitCode = error_.exitCode ?? 1;
            failed = true;
        }

        console.log(`\n========================================`);
        console.log(`[${name}] Output (Exit code: ${exitCode})`);
        console.log(`========================================`);
        if (stdout.length > 0) {
            process.stdout.write(stdout);
        }
        if (stderr.length > 0) {
            process.stderr.write(stderr);
        }
    }

    if (failed) {
        process.exit(1);
    }
}

if (mode === "check") {
    await runParallel([
        {
            name: "Linter",
            run: () => $`bun run --bun check:lint`,
        },
        {
            name: "Formatter",
            run: () => $`bun run check:format`,
        },
        {
            name: "Typecheck",
            run: () => $`bun run --bun check:type`,
        },
    ]);
} else if (mode === "fix") {
    // Fixes should be sequential to avoid write conflicts
    try {
        await $`bun run --bun check:lint:fix`;
        await $`bun run check:format:fix`;
    } catch (error) {
        console.error("Fix failed:", (error as Error).message || error);
        process.exit(1);
    }

    // After fixing, run read-only checks (test & typecheck) in parallel
    await runParallel([
        {
            name: "Typecheck",
            run: () => $`bun run --bun check:type`,
        },
    ]);
} else {
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
}
