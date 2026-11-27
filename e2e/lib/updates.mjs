// The test app runs unpackaged, so its updater is always "managed". These stand in for the main
// process's update status push by writing straight into the renderer's query cache.

/** Finds the QueryClient on the React tree under #root and sets the update status it holds. */
export const setUpdateStatus = async (page, status) => {
  const found = await page.ev(`(() => {
    const root = document.getElementById("root");
    const key = Object.keys(root).find((k) => k.startsWith("__reactContainer$"));
    const stack = [root[key]];
    while (stack.length) {
      const fiber = stack.pop();
      const client = fiber.memoizedProps?.client;
      if (client && typeof client.setQueryData === "function") {
        client.setQueryData(["update", "status"], ${JSON.stringify(status)});
        return true;
      }
      if (fiber.sibling) stack.push(fiber.sibling);
      if (fiber.child) stack.push(fiber.child);
    }
    return false;
  })()`);
  if (!found) throw new Error("couldn't find the QueryClient to set the update status");
};

export const UPDATE_VERSION = "9.9.9";

export const updateReady = ({ restartBlocked = false } = {}) => ({ currentVersion: "0.0.0", phase: { kind: "ready", version: UPDATE_VERSION }, checkedAt: null, restartBlocked });

export const updateManaged = () => ({ currentVersion: "0.0.0", phase: { kind: "managed" }, checkedAt: null, restartBlocked: false });

export const UPDATE_INDICATOR = `document.querySelector("[data-update-indicator]")`;
export const RESTART_BUTTON = `[...document.querySelectorAll("[data-update-section] button")].find((b) => b.textContent.trim() === "Restart to update")`;
