const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const findPageTarget = async ({ port, isAlive }) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (!isAlive()) throw new Error("The app exited before its window opened.");
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page;
    } catch {}
    await sleep(150);
  }
  throw new Error(`No app window on the debugging port ${port} after 20s.`);
};

/** One page of the app over the Chrome DevTools Protocol, with real mouse and keyboard input. */
export const connectPage = async ({ port, isAlive }) => {
  const target = await findPageTarget({ port, isAlive });
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, fail) => {
    ws.addEventListener("open", done, { once: true });
    ws.addEventListener("error", () => fail(new Error("Couldn't connect to the app window.")), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.fail(new Error(`${waiter.method}: ${msg.error.message}`));
    else waiter.done(msg.result);
  });

  const call = (method, params = {}) =>
    new Promise((done, fail) => {
      const id = ++nextId;
      pending.set(id, { done, fail, method });
      ws.send(JSON.stringify({ id, method, params }));
    });

  /** Evaluates an expression in the page and returns its value (awaiting promises). */
  const ev = async (expression) => {
    const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`In page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n  while evaluating: ${expression.slice(0, 200)}`);
    return r.result?.value;
  };

  /** Polls an expression until it's truthy and returns its value. */
  const waitFor = async (expression, { timeout = 5000, message } = {}) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const value = await ev(expression).catch(() => undefined);
      if (value) return value;
      if (Date.now() > deadline) throw new Error(message ?? `Timed out waiting for: ${expression}`);
      await sleep(50);
    }
  };

  /** The centre of the first element matching a selector, or of the element an expression returns. */
  const rectOf = async (selectorOrExpr) => {
    const el = selectorOrExpr.startsWith("js:") ? selectorOrExpr.slice(3) : `document.querySelector(${JSON.stringify(selectorOrExpr)})`;
    const r = await ev(`(() => { const el = ${el}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
    if (!r) throw new Error(`No element for ${selectorOrExpr}`);
    return r;
  };

  /** Waits until an element has stopped moving (a panel finished sliding in, say). */
  const waitStill = async (selectorOrExpr, { timeout = 3000 } = {}) => {
    const deadline = Date.now() + timeout;
    let last = null;
    for (;;) {
      const r = await rectOf(selectorOrExpr).catch(() => null);
      const key = r && `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
      if (key && key === last) return r;
      if (Date.now() > deadline) throw new Error(`${selectorOrExpr} never stopped moving`);
      last = key;
      await sleep(100);
    }
  };

  const mouse = (type, x, y, extra = {}) => call("Input.dispatchMouseEvent", { type, x, y, button: "left", ...extra });
  const move = (x, y) => mouse("mouseMoved", x, y, { button: "none" });
  /** A click held for a moment, as a hand does; a press and release in the same frame hides timing bugs. */
  const clickAt = async (x, y, { hold = 80 } = {}) => {
    await move(x, y);
    await mouse("mousePressed", x, y, { clickCount: 1, buttons: 1 });
    await sleep(hold);
    await mouse("mouseReleased", x, y, { clickCount: 1 });
  };
  const click = async (selectorOrExpr) => {
    const r = await rectOf(selectorOrExpr);
    await clickAt(r.cx, r.cy);
  };
  /** Presses at `from`, moves in steps with the button held, and optionally releases at `to`. */
  const drag = async ({ from, to, steps = 10, release = true }) => {
    await move(from.x, from.y);
    await mouse("mousePressed", from.x, from.y, { clickCount: 1, buttons: 1 });
    for (let i = 1; i <= steps; i++) {
      await mouse("mouseMoved", from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps, { buttons: 1 });
      await sleep(16);
    }
    if (release) await mouse("mouseReleased", to.x, to.y, { clickCount: 1 });
  };
  const wheel = (x, y, deltaY) => call("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });

  const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  /**
   * A real key press. `key` is KeyboardEvent.key, `code` the physical key. Synthetic keys don't run
   * the browser's editing shortcuts, so pass those as `commands` (e.g. ["selectAll"] with Ctrl+A).
   */
  const press = async (key, { code = key, shift = false, ctrl = false, commands } = {}) => {
    const modifiers = (shift ? MODIFIERS.shift : 0) | (ctrl ? MODIFIERS.ctrl : 0);
    const text = key.length === 1 && !ctrl ? key : undefined;
    await call("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, text, unmodifiedText: text, commands });
    await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers });
    await sleep(60);
  };
  const type = (text) => call("Input.insertText", { text });

  const viewport = (width, height) => call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });

  /** Navigates within the app's hash router and waits for the route to render. */
  const go = async (hash, readyExpr) => {
    await ev(`location.hash = ${JSON.stringify(hash)}`);
    if (readyExpr) await waitFor(readyExpr, { timeout: 8000 });
  };

  await call("Runtime.enable");
  return { call, ev, waitFor, waitStill, rectOf, mouse, move, click, clickAt, drag, wheel, press, type, viewport, go, sleep, errors, close: () => ws.close() };
};
