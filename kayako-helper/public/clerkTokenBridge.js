(async () => {
    try {
        // Wait for Clerk to be present (max 2 s)
        const ready = Date.now() + 2000;
        while (!(window.Clerk && window.Clerk.session && window.Clerk.session.getToken) && Date.now() < ready) {
            await new Promise(r => setTimeout(r, 50));
        }

        const jwt = await window.Clerk?.session?.getToken?.();
        if (!jwt) return;

        // Broadcast to the content-script world
        window.postMessage({ source: "kh-clerk", jwt }, "*");
    } catch (err) {
        console.warn("[Ephor] Clerk JWT bridge failed:", err);
    }
})();
