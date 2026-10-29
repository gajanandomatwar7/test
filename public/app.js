(() => {
  const $ = (id) => document.getElementById(id);

  const sizesInput = $("sizes");
  const deleteAfterInput = $("deleteAfter");
  const startBtn = $("startBtn");
  const stopBtn = $("stopBtn");
  const planInfo = $("planInfo");
  const formError = $("formError");
  const healthPill = $("healthPill");
  const liveEyebrow = $("liveEyebrow");
  const liveTitle = $("liveTitle");
  const liveSub = $("liveSub");
  const liveTimer = $("liveTimer");
  const liveSpeed = $("liveSpeed");
  const liveBar = $("liveBar");
  const liveBytes = $("liveBytes");
  const liveParts = $("liveParts");
  const resultsBody = $("resultsBody");
  const runProgress = $("runProgress");
  const logEl = $("log");

  let state = null;
  let lastRowsKey = "";
  let planSeq = 0;
  let planTimer = null;
  let finishedTotalMs = null;

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => {
      const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
      return map[character];
    });

  function fmtBytes(bytes) {
    if (!Number.isFinite(bytes)) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    const rounded =
      value >= 100 || Number.isInteger(value) ? Math.round(value) : Number(value.toFixed(1));
    return `${rounded} ${units[unit]}`;
  }

  function fmtElapsed(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "0.000";
    if (ms < 60_000) return (ms / 1000).toFixed(3);
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function setError(message) {
    if (!message) {
      formError.hidden = true;
      formError.textContent = "";
      return;
    }
    formError.hidden = false;
    formError.textContent = message;
  }

  async function refreshPlan() {
    const seq = ++planSeq;
    try {
      const response = await fetch(`/api/plan?sizes=${encodeURIComponent(sizesInput.value)}`);
      const data = await response.json();
      if (seq !== planSeq) return;

      if (!data.ok) {
        planInfo.textContent = data.error;
        planInfo.classList.add("bad");
        return;
      }

      planInfo.classList.remove("bad");
      const labels = data.sizes.map((size) => size.label).join(", ");
      planInfo.textContent = `${labels} — ${data.sizes.length} sizes × ${data.attempts} attempts = ${data.totalUploads} uploads, ${data.bytesTotalLabel} total.`;
    } catch {
      planInfo.textContent = "Could not read the plan.";
    }
  }

  async function checkHealth() {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();
      if (data.ok) {
        healthPill.textContent = `reachable · ${data.latencyMs} ms`;
        healthPill.className = "pill good";
      } else {
        healthPill.textContent = "unreachable";
        healthPill.className = "pill bad";
        healthPill.title = data.error || "";
      }
    } catch (error) {
      healthPill.textContent = "unreachable";
      healthPill.className = "pill bad";
      healthPill.title = error.message;
    }
  }

  function addLog(entry) {
    const time = new Date(entry.at).toLocaleTimeString();
    const line = document.createElement("div");
    line.className = `log-line ${entry.level || "info"}`;
    line.innerHTML = `<span class="t">${escapeHtml(time)}</span><span class="m">${escapeHtml(entry.message)}</span>`;
    logEl.appendChild(line);

    while (logEl.childElementCount > 500) logEl.removeChild(logEl.firstElementChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function statusCell(row) {
    if (row.status === "ok") return '<span class="tag ok">OK</span>';
    if (row.status === "cancelled") return '<span class="tag warn">CANCELLED</span>';
    return `<span class="tag bad">FAILED</span><span class="err">${escapeHtml(row.error || "")}</span>`;
  }

  function renderRows() {
    const rows = state.results;
    const key = rows.map((row) => `${row.index}:${row.status}`).join("|");
    if (key === lastRowsKey) return;
    lastRowsKey = key;

    if (!rows.length) {
      resultsBody.innerHTML =
        '<tr class="empty"><td colspan="7">Results appear here as each upload finishes.</td></tr>';
      return;
    }

    resultsBody.innerHTML = rows
      .map(
        (row) => `<tr class="row-${row.status}">
          <td class="num">${row.index}</td>
          <td>${escapeHtml(row.sizeLabel)}</td>
          <td class="num">${row.attempt}/${row.attempts}</td>
          <td class="num duration">${(row.durationMs / 1000).toFixed(3)}</td>
          <td class="num">${
            Number.isFinite(row.throughputMBps) ? `${row.throughputMBps.toFixed(2)} MB/s` : "—"
          }</td>
          <td>${statusCell(row)}</td>
          <td class="key">${escapeHtml(row.key)}</td>
        </tr>`
      )
      .join("");
  }

  function renderLive() {
    if (!state) return;

    startBtn.disabled = state.running;
    stopBtn.disabled = !state.running;
    sizesInput.disabled = state.running;
    deleteAfterInput.disabled = state.running;

    const done = state.results.length;
    runProgress.textContent = state.totalUploads
      ? `${done}/${state.totalUploads} uploads · ${fmtBytes(state.bytesDone)} of ${fmtBytes(state.bytesTotal)}`
      : "No uploads yet";

    if (state.current) {
      const current = state.current;
      liveEyebrow.textContent = `Upload ${current.index} of ${state.totalUploads} · attempt ${current.attempt}/${current.attempts}`;
      liveTitle.textContent = current.sizeLabel;
      liveSub.textContent = current.key;
      const percent = current.totalBytes
        ? Math.min(100, (current.uploadedBytes / current.totalBytes) * 100)
        : 0;
      liveBar.style.width = `${percent.toFixed(1)}%`;
      liveBytes.textContent = `${fmtBytes(current.uploadedBytes)} of ${fmtBytes(current.totalBytes)} · ${percent.toFixed(1)}%`;
      liveParts.textContent =
        current.totalParts > 1 ? `part ${current.partNumber}/${current.totalParts}` : "single put";
      finishedTotalMs = null;
      return;
    }

    if (state.running) {
      liveEyebrow.textContent = "Running";
      liveTitle.textContent = "Preparing next upload…";
      liveSub.textContent = "Allocating the next payload and opening the connection.";
      liveBar.style.width = "0%";
      liveBytes.textContent = "—";
      liveParts.textContent = "";
      liveSpeed.textContent = "—";
      liveTimer.textContent = "0.000";
      return;
    }

    if (state.finishedAt) {
      const okCount = state.results.filter((row) => row.status === "ok").length;
      const speeds = state.results
        .filter((row) => row.status === "ok")
        .map((row) => row.throughputMBps);
      const average = speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : 0;

      liveEyebrow.textContent = state.cancelled ? "Cancelled" : state.error ? "Stopped" : "Finished";
      liveTitle.textContent = `${okCount} of ${state.results.length} uploads ok`;
      liveSub.textContent = `average ${average.toFixed(2)} MB/s · records appended to results.md`;
      liveBar.style.width = "100%";
      liveBytes.textContent = `${fmtBytes(state.bytesDone)} uploaded`;
      liveParts.textContent = "";
      liveSpeed.textContent = `${average.toFixed(1)} MB/s avg`;
      finishedTotalMs = new Date(state.finishedAt) - new Date(state.startedAt);
      liveTimer.textContent = fmtElapsed(finishedTotalMs);
      return;
    }

    liveEyebrow.textContent = "Idle";
    liveTitle.textContent = "Waiting to start";
    liveSub.textContent = "Press Start to begin uploading.";
    liveBar.style.width = "0%";
    liveBytes.textContent = "—";
    liveParts.textContent = "";
    liveSpeed.textContent = "—";
    liveTimer.textContent = "0.000";
  }

  function render() {
    renderLive();
    renderRows();
  }

  function tick() {
    if (!state) return;

    if (state.current) {
      const current = state.current;
      const elapsed = current.elapsedMs + Math.max(0, Date.now() - state.at);
      liveTimer.textContent = fmtElapsed(elapsed);
      const speed =
        elapsed > 0 ? current.uploadedBytes / 1e6 / Math.max(elapsed / 1000, 0.001) : 0;
      liveSpeed.textContent = `≈ ${speed.toFixed(1)} MB/s`;
    }
  }

  function connect() {
    const source = new EventSource("/api/stream");

    source.addEventListener("state", (event) => {
      state = JSON.parse(event.data);
      render();
    });

    source.addEventListener("log", (event) => addLog(JSON.parse(event.data)));

    source.onopen = () => {
      if (healthPill.classList.contains("bad")) checkHealth();
    };

    source.onerror = () => {
      healthPill.textContent = "reconnecting…";
      healthPill.className = "pill warn";
    };
  }

  startBtn.addEventListener("click", async () => {
    setError("");
    startBtn.disabled = true;
    try {
      const response = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sizes: sizesInput.value,
          deleteAfter: deleteAfterInput.checked,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setError(data.error || "Could not start the run.");
        startBtn.disabled = false;
      }
    } catch (error) {
      setError(error.message);
      startBtn.disabled = false;
    }
  });

  stopBtn.addEventListener("click", async () => {
    stopBtn.disabled = true;
    try {
      await fetch("/api/stop", { method: "POST" });
    } catch (error) {
      addLog({ at: new Date().toISOString(), level: "error", message: error.message });
    }
  });

  sizesInput.addEventListener("input", () => {
    setError("");
    clearTimeout(planTimer);
    planTimer = setTimeout(refreshPlan, 250);
  });

  $("clearLog").addEventListener("click", () => {
    logEl.innerHTML = "";
  });

  setInterval(tick, 80);
  refreshPlan();
  checkHealth();
  connect();
})();
