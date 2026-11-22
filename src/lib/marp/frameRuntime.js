(function frameRuntime() {
  const session = document.documentElement.dataset.session;
  let generation = 0;
  let current = -1;
  let slides = [];
  const send = (type, values = {}) => parent.postMessage({ channel: "maca-marp", session, generation, type, ...values }, "*");
  const go = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= slides.length) return;
    current = index;
    window.scrollTo(0, slides[index].offsetTop);
    send("slide", { index });
  };
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (event.source !== parent || !message || typeof message !== "object" || Object.keys(message).length > 9 ||
        message.channel !== "maca-marp" || message.session !== session || !Number.isSafeInteger(message.generation)) return;
    if (message.type === "hello") { send("ready"); return; }
    if (message.type === "render" && message.generation > generation && typeof message.html === "string" &&
        typeof message.css === "string" && message.html.length + message.css.length <= 32 * 1024 * 1024) {
      generation = message.generation;
      document.getElementById("theme").textContent = message.css;
      document.getElementById("deck").innerHTML = message.html;
      slides = [...document.querySelectorAll("article[data-slide-index]")];
      go(Math.max(0, Math.min(slides.length - 1, Number.isInteger(message.index) ? message.index : 0)));
      send("rendered");
    } else if (message.type === "go" && message.generation === generation) go(message.index);
  });
  let scheduled = false;
  window.addEventListener("scroll", () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      let index = 0;
      slides.forEach((slide, candidate) => { if (slide.getBoundingClientRect().top <= innerHeight * 0.35) index = candidate; });
      if (scrollY > 0 && scrollY + innerHeight >= document.documentElement.scrollHeight - 2) index = slides.length - 1;
      if (index !== current) { current = index; send("slide", { index }); }
    });
  }, { passive: true });
  document.addEventListener("click", (event) => {
    const link = event.target?.closest?.("a");
    if (!link) return;
    event.preventDefault();
    const href = link.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      let id;
      try { id = decodeURIComponent(href.slice(1)); } catch { return; }
      const target = document.getElementById(id)?.closest("article[data-slide-index]");
      if (target) go(slides.indexOf(target));
    } else if (href.length <= 4096) send("link", { href });
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "PageDown" || event.key === "PageUp") {
      event.preventDefault();
      go(current + (event.key === "PageDown" ? 1 : -1));
    }
  });
  send("ready");
})();
