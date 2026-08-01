import '@testing-library/jest-dom/vitest'

// jsdom SHIPS a real WebSocket implementation that would open actual network
// connections from tests (the JobSocketProvider mounts in Shell, so Shell/App
// tests would dial the prod wss endpoint). Removing the global makes the whole
// suite WS-less by default — JobSocket's lazy globalThis.WebSocket guard turns
// that into "permanently unhealthy" (the tested polling fallback). WS tests
// opt back in with vi.stubGlobal('WebSocket', FakeWebSocket).
delete (globalThis as { WebSocket?: unknown }).WebSocket

// Worker needs no such deletion: jsdom ships no Worker global, so the suite is
// worker-less by default. Worker tests opt in via vi.stubGlobal('Worker', FakeWorker).
