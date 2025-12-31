import { expect, test, afterEach } from "bun:test";
import { Terminal } from "./terminal";
import type { IExitEvent } from "./interfaces";

// Windows-specific integration tests
// Only run on Windows platform
const isWindows = process.platform === "win32";

if (!isWindows) {
	test.skip("Windows tests", () => {
		console.log("Skipping Windows tests on non-Windows platform.");
	});
	process.exit(0);
}

// Keep track of terminals created so they can be cleaned up
const terminals: Terminal[] = [];

afterEach(() => {
	// Clean up any terminals created during tests
	for (const term of terminals) {
		try {
			term.kill();
		} catch (e) {
			// Ignore errors during cleanup
		}
	}
	terminals.length = 0;
});

test("Terminal can spawn cmd.exe", () => {
	const terminal = new Terminal("cmd.exe", ["/c", "echo test"]);
	terminals.push(terminal);
	
	expect(terminal.pid).toBeGreaterThan(0);
});

test("Terminal can spawn PowerShell", () => {
	const terminal = new Terminal("powershell.exe", ["-Command", "Write-Output 'test'"]);
	terminals.push(terminal);
	
	expect(terminal.pid).toBeGreaterThan(0);
});

test("Terminal receives output from cmd.exe", async () => {
	let dataReceived = "";
	let hasExited = false;
	
	const terminal = new Terminal("cmd.exe", ["/c", "echo Hello from Windows PTY"]);
	terminals.push(terminal);
	
	terminal.onData((data) => {
		console.log("[TEST] Received data:", data);
		dataReceived += data;
	});
	
	terminal.onExit(() => {
		console.log("[TEST] Process exited");
		hasExited = true;
	});
	
	// Wait for process to exit or timeout
	const timeout = 5000; // 5 second timeout (Windows can be slower)
	const start = Date.now();
	
	while (!hasExited && Date.now() - start < timeout) {
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	
	// Allow a short delay for any buffered output to be processed
	await new Promise(resolve => setTimeout(resolve, 200));
	
	expect(dataReceived).toContain("Hello from Windows PTY");
});

test("Terminal receives output from PowerShell", async () => {
	let dataReceived = "";
	let hasExited = false;
	
	const terminal = new Terminal("powershell.exe", ["-Command", "Write-Output 'Hello from PowerShell'"]);
	terminals.push(terminal);
	
	terminal.onData((data) => {
		console.log("[TEST] Received data:", data);
		dataReceived += data;
	});
	
	terminal.onExit(() => {
		console.log("[TEST] Process exited");
		hasExited = true;
	});
	
	// Wait for process to exit or timeout
	const timeout = 10000; // 10 second timeout (PowerShell startup can be slow)
	const start = Date.now();
	
	while (!hasExited && Date.now() - start < timeout) {
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	
	// Allow a short delay for any buffered output to be processed
	await new Promise(resolve => setTimeout(resolve, 200));
	
	expect(dataReceived).toContain("Hello from PowerShell");
});

test("Terminal can run interactive cmd.exe session", async () => {
	let dataReceived = "";
	let hasExited = false;
	
	const terminal = new Terminal("cmd.exe");
	terminals.push(terminal);
	
	terminal.onData((data) => {
		console.log("[TEST] Received data:", data);
		dataReceived += data;
	});
	
	terminal.onExit(() => {
		console.log("[TEST] Process exited");
		hasExited = true;
	});
	
	// Give cmd.exe time to start and show prompt
	await new Promise(resolve => setTimeout(resolve, 500));
	
	// Send a command
	terminal.write("echo Interactive Test\r\n");
	await new Promise(resolve => setTimeout(resolve, 500));
	
	// Exit the shell
	terminal.write("exit\r\n");
	
	// Wait for process to exit or timeout
	const timeout = 5000;
	const start = Date.now();
	
	while (!hasExited && Date.now() - start < timeout) {
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	
	// Allow a short delay for any buffered output to be processed
	await new Promise(resolve => setTimeout(resolve, 200));
	
	expect(dataReceived).toContain("Interactive Test");
});

test("Terminal handles Windows paths with spaces", async () => {
	let dataReceived = "";
	let hasExited = false;
	
	// Test echoing a path with spaces (common on Windows)
	const terminal = new Terminal("cmd.exe", ["/c", "echo C:\\Program Files\\Test App"]);
	terminals.push(terminal);
	
	terminal.onData((data) => {
		console.log("[TEST] Received data:", data);
		dataReceived += data;
	});
	
	terminal.onExit(() => {
		console.log("[TEST] Process exited");
		hasExited = true;
	});
	
	// Wait for process to exit or timeout
	const timeout = 5000;
	const start = Date.now();
	
	while (!hasExited && Date.now() - start < timeout) {
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	
	// Allow a short delay for any buffered output to be processed
	await new Promise(resolve => setTimeout(resolve, 200));
	
	expect(dataReceived).toContain("Program Files");
});

test("Terminal can resize on Windows", async () => {
	const terminal = new Terminal("cmd.exe", ["/c", "timeout /t 2 /nobreak >nul"]);
	terminals.push(terminal);
	
	// Should not throw
	terminal.resize(120, 40);
	
	expect(terminal.cols).toBe(120);
	expect(terminal.rows).toBe(40);
	
	// Kill early to clean up
	terminal.kill();
});

test("Terminal can kill cmd.exe process", async () => {
	const terminal = new Terminal("cmd.exe", ["/c", "timeout /t 30 /nobreak >nul"]);
	terminals.push(terminal);
	
	let exitEvent: IExitEvent | null = null;
	terminal.onExit((event) => {
		console.log("[TEST] Process exited with event:", event);
		exitEvent = event;
	});
	
	// Give it a moment to start
	await new Promise(resolve => setTimeout(resolve, 200));
	
	// Kill the process
	terminal.kill();
	
	// Wait for exit event
	const timeout = 5000;
	const start = Date.now();
	
	while (!exitEvent && Date.now() - start < timeout) {
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	
	expect(exitEvent).not.toBeNull();
});

test("Terminal retrieves correct process ID on Windows", () => {
	const terminal = new Terminal("cmd.exe", ["/c", "timeout /t 5 /nobreak >nul"]);
	terminals.push(terminal);
	
	const pid = terminal.pid;
	console.log("[TEST] Process ID:", pid);
	expect(pid).toBeGreaterThan(0);
	
	// Clean up
	terminal.kill();
});

test("Terminal detects non-zero exit codes on Windows", async () => {
	let exitEvent: IExitEvent | null = null;
	
	// Run a command that exits with code 1
	const terminal = new Terminal("cmd.exe", ["/c", "exit 1"]);
	terminals.push(terminal);
	
	terminal.onExit((event) => {
		console.log("[TEST] Process exited with event:", event);
		exitEvent = event;
	});
	
	// Wait for exit event
	const timeout = 5000;
	const start = Date.now();
	
	while (!exitEvent && Date.now() - start < timeout) {
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	
	expect(exitEvent).not.toBeNull();
	const event = exitEvent!;
	expect(event.exitCode).toBe(1);
});

test("Terminal passes environment variables on Windows", async () => {
	let dataReceived = "";
	let hasExited = false;
	
	const terminal = new Terminal("cmd.exe", ["/c", "echo %TEST_VAR%"], {
		name: "xterm",
		env: {
			TEST_VAR: "HelloFromEnv"
		}
	});
	terminals.push(terminal);
	
	terminal.onData((data) => {
		console.log("[TEST] Received data:", data);
		dataReceived += data;
	});
	
	terminal.onExit(() => {
		console.log("[TEST] Process exited");
		hasExited = true;
	});
	
	// Wait for process to exit or timeout
	const timeout = 5000;
	const start = Date.now();
	
	while (!hasExited && Date.now() - start < timeout) {
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	
	// Allow a short delay for any buffered output to be processed
	await new Promise(resolve => setTimeout(resolve, 200));
	
	expect(dataReceived).toContain("HelloFromEnv");
});
