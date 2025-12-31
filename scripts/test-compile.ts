#!/usr/bin/env bun
/**
 * Test script to verify bun-pty works in compiled Bun binaries.
 * 
 * This tests the fix for https://github.com/sursaone/bun-pty/issues/19
 * 
 * The fix uses a statically analyzable require() call with inline ternary
 * expressions, allowing Bun to bundle the correct native library at compile time.
 * 
 * Usage:
 *   bun run test:compile    # Run the compile test
 * 
 * Red-Green Testing (manual):
 *   1. git stash            # Stash the fix
 *   2. bun run build && bun run test:compile   # Should FAIL
 *   3. git stash pop        # Restore the fix  
 *   4. bun run build && bun run test:compile   # Should PASS
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const isWindows = process.platform === "win32";
const binaryExt = isWindows ? ".exe" : "";

// Get the path to bun-pty (this repo's root)
const bunPtyRoot = dirname(import.meta.dir);

// Create a unique temp directory for this test
const testDir = join(tmpdir(), `bun-pty-compile-test-${Date.now()}`);
const testFile = join(testDir, "test-app.ts");
const compiledBinary = join(testDir, `test-app${binaryExt}`);

// Generate the test app code with the correct path to bun-pty
function generateTestAppCode(bunPtyPath: string): string {
	// Normalize path for the import (use forward slashes)
	const normalizedPath = bunPtyPath.replace(/\\/g, "/");
	
	return `
import { spawn } from "${normalizedPath}/src/index.ts";

const isWindows = process.platform === "win32";
const shell = isWindows ? "cmd.exe" : "sh";
const shellArgs = isWindows ? ["/c", "echo Hello from compiled binary"] : ["-c", "echo Hello from compiled binary"];

async function main() {
	console.log("Starting PTY test in compiled binary...");
	console.log("Platform:", process.platform);
	console.log("Arch:", process.arch);
	
	try {
		const pty = spawn(shell, shellArgs, { name: "xterm" });
		console.log("PTY spawned with PID:", pty.pid);
		
		let output = "";
		let exited = false;
		
		pty.onData((data) => {
			output += data;
		});
		
		pty.onExit((event) => {
			console.log("PTY exited with code:", event.exitCode);
			exited = true;
		});
		
		// Wait for exit or timeout
		const start = Date.now();
		while (!exited && Date.now() - start < 5000) {
			await new Promise(r => setTimeout(r, 100));
		}
		
		if (output.includes("Hello from compiled binary")) {
			console.log("SUCCESS: PTY works in compiled binary!");
			console.log("Output received:", output.trim());
			process.exit(0);
		} else {
			console.error("FAILURE: Expected output not found");
			console.error("Output received:", output);
			process.exit(1);
		}
	} catch (error) {
		console.error("FAILURE: PTY spawn failed");
		console.error(error);
		process.exit(1);
	}
}

main();
`;
}

async function runCommand(cmd: string, args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn([cmd, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	
	return { stdout, stderr, exitCode };
}

async function cleanup() {
	try {
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true });
		}
	} catch (e) {
		// Ignore cleanup errors
	}
}

async function runTest(): Promise<boolean> {
	try {
		// Verify dist/index.js exists
		const distPath = join(bunPtyRoot, "dist", "index.js");
		if (!existsSync(distPath)) {
			console.error("ERROR: dist/index.js not found. Run 'bun run build' first.");
			return false;
		}
		
		// Create test directory
		mkdirSync(testDir, { recursive: true });
		
		// Generate and write test app with correct path
		const testAppCode = generateTestAppCode(bunPtyRoot);
		writeFileSync(testFile, testAppCode);
		console.log("Test file:", testFile);
		console.log("bun-pty path:", bunPtyRoot);
		
		// Compile the test app
		console.log("\nCompiling test binary...");
		const compileResult = await runCommand("bun", [
			"build",
			"--compile",
			testFile,
			"--outfile", compiledBinary,
		]);
		
		if (compileResult.exitCode !== 0) {
			console.error("Compilation failed!");
			console.error("stdout:", compileResult.stdout);
			console.error("stderr:", compileResult.stderr);
			return false;
		}
		
		console.log("Compiled:", compiledBinary);
		
		// Run the compiled binary from a DIFFERENT directory
		// This ensures it's using the embedded bunfs, not local files
		const runDir = tmpdir();
		console.log("\nRunning from:", runDir);
		console.log("(Different directory ensures bunfs is used)\n");
		
		const runResult = await runCommand(compiledBinary, [], runDir);
		
		console.log("--- Output ---");
		if (runResult.stdout) console.log(runResult.stdout);
		if (runResult.stderr) console.log("stderr:", runResult.stderr);
		console.log("--- End ---\n");
		
		if (runResult.exitCode === 0 && runResult.stdout.includes("SUCCESS")) {
			return true;
		} else {
			return false;
		}
	} catch (error) {
		console.error("Test error:", error);
		return false;
	}
}

async function main() {
	console.log("=".repeat(60));
	console.log("bun-pty Compile Test");
	console.log("https://github.com/sursaone/bun-pty/issues/19");
	console.log("=".repeat(60));
	
	const passed = await runTest();
	await cleanup();
	
	console.log("=".repeat(60));
	if (passed) {
		console.log("PASSED");
	} else {
		console.log("FAILED");
	}
	console.log("=".repeat(60));
	
	process.exit(passed ? 0 : 1);
}

main();
